// notify-event-live — fired by the Postgres dispatch trigger when an
// event's status flips to 'live'. Sends "X is live now" emails to
// every direct subscriber + every creator follower, then inserts the
// matching in-app notification rows, then stamps events.live_notified_at
// so the trigger can't re-fire.
//
// Body: { event_id: string }
// Auth: shared internal bearer (from the DB trigger via Supabase Vault).
//
// Idempotency story:
//   • The trigger only fires once because we guard on live_notified_at IS NULL.
//   • This function double-checks before doing any work.
//   • Resend batch.send takes an idempotency_key so a retry of the
//     same call to Resend doesn't double-deliver.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { HttpError, requireInternalToken } from "../_shared/auth.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import { FROM, resend, unsubscribeHeaders, APP_URL } from "../_shared/resend.ts";
import { renderEventLive } from "../_shared/email-templates.ts";

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

    // Re-check status + idempotency. The dispatcher already guarded
    // these, but in the time between trigger fire and HTTP arrival
    // the event could have flipped back (e.g. creator ended quickly).
    const { data: event, error: eventErr } = await db
      .from("events")
      .select(
        `
        id, title, cover_url, status, live_notified_at, creator_id,
        creator:creator_profiles!events_creator_id_fkey ( id, display_name )
      `,
      )
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr || !event) {
      throw new HttpError(404, "Event not found");
    }
    if (event.status !== "live") {
      return jsonResponse({ ok: true, skipped: `status=${event.status}` });
    }
    if (event.live_notified_at) {
      return jsonResponse({ ok: true, skipped: "already_notified" });
    }

    // Build the recipient set: union of direct event_subscribers and
    // the creator's followers. We pull user_id from both, then join
    // through auth.users + profiles to get email + the opt-out flag.
    // Distinct on user_id so a viewer who's BOTH a direct subscriber
    // and an old creator follower only gets one email.
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
    // Exclude the creator's own user_id — they don't need an email
    // about their own stream going live.
    if (event.creator_id) userIdSet.delete(event.creator_id);

    if (userIdSet.size === 0) {
      // Still stamp live_notified_at so we don't keep retrying for an
      // empty audience.
      await db
        .from("events")
        .update({ live_notified_at: new Date().toISOString() })
        .eq("id", eventId);
      return jsonResponse({ ok: true, recipients: 0 });
    }

    const userIds = Array.from(userIdSet);
    // Look up emails + notifications_enabled. RLS would block this
    // for an authed client but we're service-role.
    const { data: profiles } = await db
      .from("profiles")
      .select("id, notifications_enabled")
      .in("id", userIds);
    const optedOut = new Set(
      (profiles ?? [])
        .filter((p) => p.notifications_enabled === false)
        .map((p) => p.id),
    );

    // Pull emails from auth.users one batch at a time. Supabase
    // doesn't have an `auth.users.select(*)` REST endpoint — we use
    // the admin API user-by-id lookup. Parallelise for speed.
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

    if (recipients.length === 0) {
      await db
        .from("events")
        .update({ live_notified_at: new Date().toISOString() })
        .eq("id", eventId);
      return jsonResponse({ ok: true, recipients: 0, opted_out: optedOut.size });
    }

    // Render once, then send via batch in chunks of 100.
    const creator = Array.isArray(event.creator) ? event.creator[0] : event.creator;
    const creatorName = creator?.display_name ?? "A LiveRush creator";
    const tmpl = renderEventLive({
      eventTitle: event.title,
      eventId: event.id,
      coverUrl: event.cover_url,
      creatorName,
    });

    let sent = 0;
    let batchIndex = 0;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const slice = recipients.slice(i, i + BATCH_SIZE);
      const payload = slice.map((r) => ({
        from: FROM,
        to: r.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        headers: unsubscribeHeaders(`${APP_URL}/profile?notifications=off`),
      }));
      const { error: batchErr } = await resend.batch.send(payload, {
        idempotencyKey: `${eventId}:live:${batchIndex}`,
      });
      if (batchErr) {
        // Best-effort: log + continue. We'll still stamp
        // live_notified_at to avoid an infinite retry storm; a
        // separate manual replay can backfill if needed.
        console.error(
          `Resend batch ${batchIndex} failed:`,
          batchErr.message ?? batchErr,
        );
      } else {
        sent += slice.length;
      }
      batchIndex += 1;
    }

    // In-app notifications for everyone who got an email — and even
    // those who opted out of email (they still want to see it in the
    // bell). So this iterates the full userIds set, not just
    // recipients.
    const notificationRows = userIds.map((uid) => ({
      user_id: uid,
      type: "event_starting" as const,
      title: `${creatorName} is live`,
      body: event.title,
      event_id: event.id,
    }));
    if (notificationRows.length > 0) {
      const { error: nErr } = await db
        .from("notifications")
        .insert(notificationRows);
      if (nErr) console.warn("notifications insert failed:", nErr.message);
    }

    // Stamp the event so the trigger won't fire us again.
    await db
      .from("events")
      .update({ live_notified_at: new Date().toISOString() })
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
    console.error("notify-event-live failed:", message);
    return jsonResponse({ error: message }, { status: 500 });
  }
});
