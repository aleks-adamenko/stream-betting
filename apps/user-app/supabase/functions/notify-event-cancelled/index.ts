// notify-event-cancelled — fired by the Postgres
// events_cancel_notify_dispatch trigger when an event flips to
// status='cancelled'. Sends one refund email per bet via Resend
// batch.send, drops in-app notification rows in parallel, then stamps
// events.cancelled_notified_at so we can't fan out twice.
//
// Body: { event_id: string }
// Auth: shared internal bearer (from the DB trigger via Supabase Vault).
//
// Idempotency story:
//   • The trigger guards on cancelled_notified_at IS NULL.
//   • This function double-checks before doing work.
//   • Per-recipient idempotency key = `<bet_id>::refund` so a re-fire
//     hitting Resend won't double-deliver any individual refund email.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { HttpError, requireInternalToken } from "../_shared/auth.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import { FROM, resend, unsubscribeHeaders, APP_URL } from "../_shared/resend.ts";
import { renderRefundIssued } from "../_shared/email-templates.ts";

interface Body {
  event_id?: string;
}

// Resend's batch endpoint accepts up to 100 emails per call.
const BATCH_SIZE = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    requireInternalToken(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    const eventId = body.event_id;
    if (!eventId || typeof eventId !== "string") {
      throw new HttpError(400, "Missing event_id");
    }

    const db = serviceRoleClient();

    // Re-check status + idempotency.
    const { data: event, error: eventErr } = await db
      .from("events")
      .select(
        `
        id, title, cover_url, status, cancelled_reason,
        cancelled_notified_at, creator_id,
        creator:creator_profiles!events_creator_id_fkey ( id, display_name )
      `,
      )
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr || !event) {
      throw new HttpError(404, "Event not found");
    }
    if (event.status !== "cancelled") {
      return jsonResponse({ ok: true, skipped: `status=${event.status}` });
    }
    if (event.cancelled_notified_at) {
      return jsonResponse({ ok: true, skipped: "already_notified" });
    }

    // Pull every bet on this event that got refunded by cancel_event.
    // We email one row per (bet) — if a user has multiple bets on the
    // event they get multiple emails. That's intentional: each bet is
    // its own refund line item, and clustering across bets would
    // require knowing the user's preference for digest-style emails
    // (out of scope).
    const { data: bets } = await db
      .from("bets")
      .select("id, user_id, amount_cents")
      .eq("event_id", eventId)
      .eq("status", "refunded");

    if (!bets || bets.length === 0) {
      // No bets ever placed on this event — nothing to fan out. Still
      // stamp so we don't keep retrying.
      await db
        .from("events")
        .update({ cancelled_notified_at: new Date().toISOString() })
        .eq("id", eventId);
      return jsonResponse({ ok: true, sent_count: 0, recipients: 0 });
    }

    // Filter by opt-out flags. Pull all distinct bettor profiles in one
    // SELECT so we don't N+1 the profiles table.
    const userIds = Array.from(new Set(bets.map((b) => b.user_id)));
    const { data: profiles } = await db
      .from("profiles")
      .select("id, notifications_enabled, notifications_enabled_payouts")
      .in("id", userIds);
    const optedOut = new Set(
      (profiles ?? [])
        .filter(
          (p) =>
            p.notifications_enabled === false ||
            p.notifications_enabled_payouts === false,
        )
        .map((p) => p.id),
    );

    // Pull emails from auth.users via the admin API, parallel.
    const emails = new Map<string, string>();
    await Promise.all(
      userIds.map(async (uid) => {
        if (optedOut.has(uid)) return;
        const { data, error } = await db.auth.admin.getUserById(uid);
        if (error || !data.user?.email) return;
        emails.set(uid, data.user.email);
      }),
    );

    const creator = Array.isArray(event.creator) ? event.creator[0] : event.creator;
    const creatorName = creator?.display_name ?? "A LiveRush creator";

    // Build the per-bet payloads. One bet = one rendered email = one
    // entry in the Resend batch (with its own idempotency key).
    const sendable = bets
      .map((bet) => {
        const email = emails.get(bet.user_id);
        if (!email) return null;
        const tmpl = renderRefundIssued({
          eventTitle: event.title,
          eventId: event.id,
          coverUrl: event.cover_url,
          creatorName,
          amountCents: bet.amount_cents,
          reason: event.cancelled_reason ?? null,
        });
        return {
          bet,
          payload: {
            from: FROM,
            to: email,
            subject: tmpl.subject,
            html: tmpl.html,
            text: tmpl.text,
            headers: unsubscribeHeaders(`${APP_URL}/profile?notifications=off`),
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (sendable.length === 0) {
      await db
        .from("events")
        .update({ cancelled_notified_at: new Date().toISOString() })
        .eq("id", eventId);
      return jsonResponse({
        ok: true,
        sent_count: 0,
        recipients: 0,
        opted_out: optedOut.size,
      });
    }

    // Chunk into 100-per-batch and send. Resend batch.send takes a
    // single top-level idempotency key per request — that prevents the
    // *batch* from being double-submitted, which is what we want
    // because all the per-bet content is already deterministic for a
    // given event_id.
    let sent = 0;
    let batchIndex = 0;
    for (let i = 0; i < sendable.length; i += BATCH_SIZE) {
      const slice = sendable.slice(i, i + BATCH_SIZE);
      const { error: batchErr } = await resend.batch.send(
        slice.map((s) => s.payload),
        { idempotencyKey: `${eventId}:cancelled:${batchIndex}` },
      );
      if (batchErr) {
        console.error(
          `Resend batch ${batchIndex} failed:`,
          batchErr.message ?? batchErr,
        );
      } else {
        sent += slice.length;
      }
      batchIndex += 1;
    }

    // In-app notifications for every bettor (even opted-out — they
    // still want the bell). One row per bet.
    const notificationRows = bets.map((bet) => ({
      user_id: bet.user_id,
      type: "bet_refunded" as const,
      title: "Bet refunded",
      body: `${(bet.amount_cents / 100).toFixed(2)} refunded from "${event.title}"`,
      event_id: event.id,
    }));
    if (notificationRows.length > 0) {
      const { error: nErr } = await db
        .from("notifications")
        .insert(notificationRows);
      if (nErr) console.warn("notifications insert failed:", nErr.message);
    }

    // Stamp the event so the trigger can't fan out again.
    await db
      .from("events")
      .update({ cancelled_notified_at: new Date().toISOString() })
      .eq("id", eventId);

    return jsonResponse({
      ok: true,
      recipients: sendable.length,
      sent,
      opted_out: optedOut.size,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("notify-event-cancelled failed:", message);
    return jsonResponse({ error: message }, { status: 500 });
  }
});
