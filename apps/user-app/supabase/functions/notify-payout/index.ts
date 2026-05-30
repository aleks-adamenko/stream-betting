// notify-payout — fired by the Postgres payouts_notify_dispatch trigger
// when a payout row transitions to a final state. Sends a single
// transactional email to the payout's recipient (viewer or streamer),
// then inserts the matching in-app notification, then stamps
// payouts.notified_at so the trigger can't re-fire.
//
// Body: { kind: 'credited' | 'rake' | 'rejected', payout_id: uuid }
// Auth: shared internal bearer (from the DB trigger via Supabase Vault).
//
// Idempotency story:
//   • The trigger fires only on the first status transition (OLD vs NEW).
//   • This function double-checks `payouts.notified_at IS NULL`.
//   • Resend `emails.send` takes an idempotencyKey = `<payout_id>::<kind>`
//     so a retry from us (or pg_net retrying internally) doesn't
//     double-deliver at the Resend layer either.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { HttpError, requireInternalToken } from "../_shared/auth.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import { FROM, resend, unsubscribeHeaders, APP_URL } from "../_shared/resend.ts";
import {
  renderCreatorRakeCredited,
  renderPayoutCredited,
  renderPayoutRejected,
} from "../_shared/email-templates.ts";

type Kind = "credited" | "rake" | "rejected";

interface Body {
  kind?: Kind;
  payout_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    requireInternalToken(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    const kind = body.kind;
    const payoutId = body.payout_id;
    if (!payoutId || typeof payoutId !== "string") {
      throw new HttpError(400, "Missing payout_id");
    }
    if (kind !== "credited" && kind !== "rake" && kind !== "rejected") {
      throw new HttpError(400, "Bad kind");
    }

    const db = serviceRoleClient();

    // Fetch payout + event + creator in a single query. Recipient
    // profile (with opt-out flags) is a separate lookup because the
    // recipient may differ from event.creator_id (winner payout) and
    // we want both rows clean.
    const { data: payout, error: payoutErr } = await db
      .from("payouts")
      .select(
        `
        id, type, status, amount_cents, recipient_id, recipient_kind,
        reject_reason, reject_notes, notified_at, event_id,
        events!payouts_event_id_fkey (
          id, title, cover_url, creator_id,
          creator:creator_profiles!events_creator_id_fkey ( id, display_name )
        )
      `,
      )
      .eq("id", payoutId)
      .maybeSingle();

    if (payoutErr || !payout) {
      throw new HttpError(404, "Payout not found");
    }
    if (payout.notified_at) {
      return jsonResponse({ ok: true, skipped: "already_notified" });
    }
    if (!payout.recipient_id || payout.recipient_kind === "platform") {
      return jsonResponse({ ok: true, skipped: "no_recipient" });
    }

    // Cross-check the kind matches the actual payout state. Defensive
    // against a stale trigger fire or someone calling the function
    // directly with bad inputs.
    if (kind === "credited" && (payout.status !== "completed" || payout.type !== "winner")) {
      return jsonResponse({ ok: true, skipped: "kind_state_mismatch" });
    }
    if (kind === "rake" && (payout.status !== "completed" || payout.type !== "rake_streamer")) {
      return jsonResponse({ ok: true, skipped: "kind_state_mismatch" });
    }
    if (kind === "rejected" && payout.status !== "rejected") {
      return jsonResponse({ ok: true, skipped: "kind_state_mismatch" });
    }

    // Recipient opt-out check. Global notifications_enabled wins; the
    // per-category payouts flag is the secondary gate.
    const { data: profile } = await db
      .from("profiles")
      .select("notifications_enabled, notifications_enabled_payouts")
      .eq("id", payout.recipient_id)
      .maybeSingle();
    const optedOutGlobal = profile?.notifications_enabled === false;
    const optedOutCategory = profile?.notifications_enabled_payouts === false;
    if (optedOutGlobal || optedOutCategory) {
      // Stamp anyway — opt-out is intentional, retrying would just
      // hit the same fork next time.
      await db
        .from("payouts")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", payoutId);
      return jsonResponse({
        ok: true,
        skipped: optedOutGlobal ? "opted_out_global" : "opted_out_category",
      });
    }

    // Pull the recipient's email from auth.users via the admin API.
    const { data: userRes, error: userErr } = await db.auth.admin.getUserById(
      payout.recipient_id,
    );
    if (userErr || !userRes.user?.email) {
      // Stamp + bail — no email means we can't deliver and shouldn't retry.
      await db
        .from("payouts")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", payoutId);
      return jsonResponse({ ok: true, skipped: "no_email_on_record" });
    }
    const recipientEmail = userRes.user.email;

    // Render the right template for this kind.
    const event = Array.isArray(payout.events) ? payout.events[0] : payout.events;
    if (!event) {
      throw new HttpError(500, "Payout has no parent event");
    }
    const creator = Array.isArray(event.creator) ? event.creator[0] : event.creator;
    const creatorName = creator?.display_name ?? "A LiveRush creator";
    const baseCtx = {
      eventTitle: event.title,
      eventId: event.id,
      coverUrl: event.cover_url,
      creatorName,
    };

    let tmpl;
    let inAppType:
      | "bet_won"
      | "rake_credited"
      | "payout_rejected";
    let inAppTitle: string;
    let inAppBody: string;

    if (kind === "credited") {
      tmpl = renderPayoutCredited({ ...baseCtx, amountCents: payout.amount_cents });
      inAppType = "bet_won";
      inAppTitle = "You won";
      inAppBody = `${(payout.amount_cents / 100).toFixed(2)} credited from "${event.title}"`;
    } else if (kind === "rake") {
      tmpl = renderCreatorRakeCredited({ ...baseCtx, amountCents: payout.amount_cents });
      inAppType = "rake_credited";
      inAppTitle = "Earnings credited";
      inAppBody = `Streamer earnings from "${event.title}"`;
    } else {
      tmpl = renderPayoutRejected({
        ...baseCtx,
        amountCents: payout.amount_cents,
        reason: payout.reject_reason,
        notes: payout.reject_notes,
        recipientRole: payout.recipient_kind === "streamer" ? "streamer" : "viewer",
      });
      inAppType = "payout_rejected";
      inAppTitle = "Payout on hold";
      inAppBody = `Pending moderator review on "${event.title}"`;
    }

    // Send. Resend's `emails.send` takes idempotencyKey as a second-arg
    // option (npm v4+). Key shape: `<payout_id>::<kind>` so a re-fire
    // can't double-deliver.
    const { data: sendRes, error: sendErr } = await resend.emails.send(
      {
        from: FROM,
        to: recipientEmail,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        headers: unsubscribeHeaders(`${APP_URL}/profile?notifications=off`),
      },
      { idempotencyKey: `${payoutId}::${kind}` },
    );

    if (sendErr) {
      // Don't stamp notified_at — leave it null so we can replay manually.
      console.error(
        `notify-payout send failed for ${payoutId}::${kind}:`,
        sendErr.message ?? sendErr,
      );
      return jsonResponse(
        { error: "Resend send failed", detail: sendErr.message ?? null },
        { status: 502 },
      );
    }

    // In-app notification row (best-effort).
    const { error: nErr } = await db.from("notifications").insert({
      user_id: payout.recipient_id,
      type: inAppType,
      title: inAppTitle,
      body: inAppBody,
      event_id: event.id,
    });
    if (nErr) console.warn("notifications insert failed:", nErr.message);

    // Stamp notified_at so the trigger can't re-fire this payout.
    await db
      .from("payouts")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", payoutId);

    return jsonResponse({
      ok: true,
      kind,
      payout_id: payoutId,
      message_id: sendRes?.id ?? null,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("notify-payout failed:", message);
    return jsonResponse({ error: message }, { status: 500 });
  }
});
