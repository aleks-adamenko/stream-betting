// notify-event-rescheduled — fired by the Postgres dispatch trigger
// when an event's `scheduled_at` changes after the initial
// scheduled-email has already gone out (`scheduled_notified_at IS NOT
// NULL`). Sends a "RESCHEDULED" email to every direct subscriber +
// every creator follower (same recipient set as notify-event-live),
// inserts companion in-app notification rows, then stamps
// `events.reschedule_email_sent_for_at` with the new scheduled_at so
// a redundant save (focus + blur with no real change) doesn't
// re-fire the email.
//
// Body: { event_id: string, previous_scheduled_at?: string | null }
//   - previous_scheduled_at is included for body copy ("Was: X →
//     Now: Y"). Falls back to the stamped reschedule_email_sent_for_at
//     so a re-deliver of the trigger payload still produces a useful
//     before/after.
// Auth: shared internal bearer (from the DB trigger via Supabase Vault).
//
// Idempotency story:
//   • Trigger fires on every scheduled_at-changing UPDATE to
//     status='scheduled' events — possibly multiple times in a row if
//     the creator clicks Save several times.
//   • This function compares `event.scheduled_at` to
//     `event.reschedule_email_sent_for_at`. If they match, the new
//     value has already been emailed; we skip. Otherwise we proceed
//     and stamp on success.
//   • Resend batch.send takes an idempotency_key so a retry of the
//     same call to Resend doesn't double-deliver.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { HttpError, requireInternalToken } from "../_shared/auth.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import { FROM, resend, unsubscribeHeaders, APP_URL } from "../_shared/resend.ts";
import { renderEventRescheduled } from "../_shared/email-templates.ts";

interface Body {
  event_id?: string;
  previous_scheduled_at?: string | null;
}

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
    const previousScheduledAtFromTrigger = body.previous_scheduled_at ?? null;

    const db = serviceRoleClient();

    const { data: event, error: eventErr } = await db
      .from("events")
      .select(
        `
        id, title, cover_url, status, scheduled_at, archived_at,
        scheduled_notified_at, reschedule_email_sent_for_at, creator_id,
        creator:creator_profiles!events_creator_id_fkey ( id, display_name )
      `,
      )
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr || !event) {
      throw new HttpError(404, "Event not found");
    }
    if (event.status !== "scheduled") {
      return jsonResponse({ ok: true, skipped: `status=${event.status}` });
    }
    if (event.archived_at) {
      return jsonResponse({ ok: true, skipped: "archived" });
    }
    if (!event.scheduled_notified_at) {
      // Edge case: the initial scheduled email never went out for this
      // event, so there's nobody to notify about a "reschedule". The
      // trigger should have gated on this already — defensive belt
      // here in case the trigger's guard column was reset.
      return jsonResponse({ ok: true, skipped: "never_announced" });
    }
    if (event.reschedule_email_sent_for_at === event.scheduled_at) {
      // We already sent an email for this exact scheduled_at value.
      // Covers retries and no-op saves where scheduled_at landed back
      // on a value we've previously broadcast.
      return jsonResponse({ ok: true, skipped: "already_sent_for_value" });
    }

    // The "previous" timestamp the template renders. Prefer the value
    // the trigger forwarded (OLD.scheduled_at — the most truthful
    // before/after of THIS save). Fall back to the stamp from the
    // last email if the trigger payload was empty (retried delivery
    // with stale body) — that still beats showing nothing.
    const previousScheduledAt =
      previousScheduledAtFromTrigger ??
      event.reschedule_email_sent_for_at ??
      null;

    // Recipient set — same union as notify-event-live: direct event
    // subscribers ∪ creator followers, minus the creator themselves.
    // We dedupe by user_id so a viewer who's both gets exactly one
    // email.
    const { data: subs } = await db
      .from("event_subscribers")
      .select("user_id")
      .eq("event_id", eventId);
    const { data: follows } = await db
      .from("creator_followers")
      .select("follower_user_id")
      .eq("creator_id", event.creator_id);

    const userIdSet = new Set<string>();
    for (const r of subs ?? []) userIdSet.add(r.user_id);
    for (const r of follows ?? []) userIdSet.add(r.follower_user_id);
    if (event.creator_id) userIdSet.delete(event.creator_id);

    if (userIdSet.size === 0) {
      // Still stamp so trigger replays don't keep retrying for an
      // empty audience.
      await db
        .from("events")
        .update({ reschedule_email_sent_for_at: event.scheduled_at })
        .eq("id", eventId);
      return jsonResponse({ ok: true, recipients: 0 });
    }

    const userIds = Array.from(userIdSet);

    // Fetch profile rows for everyone in the audience — we need both
    // `notifications_enabled` (opt-out filter for email) AND
    // `timezone` (per-recipient render below).
    const { data: profiles } = await db
      .from("profiles")
      .select("id, notifications_enabled, timezone")
      .in("id", userIds);
    const profileById = new Map(
      (profiles ?? []).map((p) => [p.id, p] as const),
    );
    const optedOut = new Set(
      (profiles ?? [])
        .filter((p) => p.notifications_enabled === false)
        .map((p) => p.id),
    );

    // Pull emails from auth.users one user at a time via the admin API.
    // No bulk select for auth.users on Supabase, so we parallelise.
    const lookups = await Promise.all(
      userIds.map(async (uid) => {
        const { data, error } = await db.auth.admin.getUserById(uid);
        if (error || !data.user?.email) return null;
        return { user_id: uid, email: data.user.email };
      }),
    );
    const recipients = lookups.filter(
      (x): x is { user_id: string; email: string } =>
        x !== null && !optedOut.has(x.user_id),
    );

    // Render per-recipient — each viewer reads the time in their
    // OWN wall-clock based on profiles.timezone (falls back to UTC
    // when null). The before/after comparison gets re-evaluated for
    // each recipient's TZ so a Warsaw recipient sees "Was 1 PM →
    // Now 4 PM CEST" while a Kyiv recipient sees "Was 2 PM → Now
    // 5 PM EEST" for the same underlying UTC shift.
    const creator = Array.isArray(event.creator) ? event.creator[0] : event.creator;
    const creatorName = creator?.display_name ?? "A LiveRush creator";

    let sent = 0;
    let batchIndex = 0;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const slice = recipients.slice(i, i + BATCH_SIZE);
      const payload = slice.map((r) => {
        const tmpl = renderEventRescheduled({
          eventTitle: event.title,
          eventId: event.id,
          coverUrl: event.cover_url,
          creatorName,
          scheduledAt: event.scheduled_at,
          previousScheduledAt,
          timeZone: profileById.get(r.user_id)?.timezone ?? null,
        });
        return {
          from: FROM,
          to: r.email,
          subject: tmpl.subject,
          html: tmpl.html,
          text: tmpl.text,
          headers: unsubscribeHeaders(`${APP_URL}/profile?notifications=off`),
        };
      });
      const { error: batchErr } = await resend.batch.send(payload, {
        // The scheduled_at value participates in the idempotency key so
        // two *different* reschedules in the same hour each get their
        // own idempotency surface in Resend — otherwise the second
        // legitimate change would be swallowed as a "duplicate".
        idempotencyKey: `${eventId}:rescheduled:${event.scheduled_at}:${batchIndex}`,
      });
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

    // In-app notifications for the full userIds set — opt-out only
    // suppresses email, not the bell badge.
    const notificationRows = userIds.map((uid) => ({
      user_id: uid,
      type: "event_rescheduled" as const,
      title: `${creatorName} changed the start time`,
      body: event.title,
      event_id: event.id,
    }));
    if (notificationRows.length > 0) {
      const { error: nErr } = await db
        .from("notifications")
        .insert(notificationRows);
      if (nErr) console.warn("notifications insert failed:", nErr.message);
    }

    // Stamp so a redundant trigger replay on the same scheduled_at
    // skips next time.
    await db
      .from("events")
      .update({ reschedule_email_sent_for_at: event.scheduled_at })
      .eq("id", eventId);

    return jsonResponse({
      ok: true,
      recipients: recipients.length,
      sent,
      opted_out: optedOut.size,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("notify-event-rescheduled failed:", message);
    return jsonResponse({ error: message }, { status: 500 });
  }
});
