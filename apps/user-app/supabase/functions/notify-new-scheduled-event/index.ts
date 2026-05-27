// notify-new-scheduled-event — fired by the Postgres dispatch trigger
// when an event's status flips to 'scheduled' for the first time (i.e.
// draft → scheduled, not scheduled → scheduled after a title edit).
// Emails the event's creator's followers + inserts in-app notifications.
//
// Body: { event_id: string }
// Auth: shared internal bearer.
//
// Throttle: 1 email per (creator, follower) per hour. Stored as
// `creator_followers.last_notified_at`. A creator who batch-publishes
// 5 events in 10 minutes will send the first email and skip the rest,
// protecting our sender reputation and the viewer's sanity.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { HttpError, requireInternalToken } from "../_shared/auth.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import { FROM, resend, unsubscribeHeaders, APP_URL } from "../_shared/resend.ts";
import { renderNewScheduled } from "../_shared/email-templates.ts";

interface Body {
  event_id?: string;
}

const BATCH_SIZE = 100;
const THROTTLE_HOURS = 1;

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

    const { data: event, error: eventErr } = await db
      .from("events")
      .select(
        `
        id, title, cover_url, status, scheduled_at, scheduled_notified_at, creator_id,
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
    if (event.scheduled_notified_at) {
      return jsonResponse({ ok: true, skipped: "already_notified" });
    }

    // Pull creator followers who are outside the per-hour throttle
    // window. New followers (last_notified_at IS NULL) always qualify.
    const cutoffIso = new Date(
      Date.now() - THROTTLE_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const { data: follows } = await db
      .from("creator_followers")
      .select("follower_user_id, last_notified_at")
      .eq("creator_id", event.creator_id)
      .or(`last_notified_at.is.null,last_notified_at.lt.${cutoffIso}`);

    // Exclude the creator themselves if they happen to have followed
    // their own account in the past.
    const userIds = (follows ?? [])
      .map((f) => f.follower_user_id)
      .filter((uid) => uid !== event.creator_id);

    if (userIds.length === 0) {
      await db
        .from("events")
        .update({ scheduled_notified_at: new Date().toISOString() })
        .eq("id", eventId);
      return jsonResponse({ ok: true, recipients: 0 });
    }

    // Filter out users who've opted out of emails. They still get the
    // in-app notification — that's part of why the toggle is
    // email-only.
    const { data: profiles } = await db
      .from("profiles")
      .select("id, notifications_enabled")
      .in("id", userIds);
    const optedOut = new Set(
      (profiles ?? [])
        .filter((p) => p.notifications_enabled === false)
        .map((p) => p.id),
    );

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

    const creator = Array.isArray(event.creator) ? event.creator[0] : event.creator;
    const creatorName = creator?.display_name ?? "A LiveRush creator";
    const tmpl = renderNewScheduled({
      eventTitle: event.title,
      eventId: event.id,
      coverUrl: event.cover_url,
      creatorName,
      scheduledAt: event.scheduled_at,
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
        idempotencyKey: `${eventId}:scheduled:${batchIndex}`,
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

    // In-app notifications for ALL followers (including opt-outs).
    const notificationRows = userIds.map((uid) => ({
      user_id: uid,
      type: "event_starting" as const,
      title: `${creatorName} scheduled a new event`,
      body: event.title,
      event_id: event.id,
    }));
    if (notificationRows.length > 0) {
      const { error: nErr } = await db
        .from("notifications")
        .insert(notificationRows);
      if (nErr) console.warn("notifications insert failed:", nErr.message);
    }

    // Update creator_followers.last_notified_at for everyone we
    // pulled in this pass (whether the email actually sent or not).
    // The throttle window starts now, even on partial-send errors —
    // we'd rather under-send than spam.
    const nowIso = new Date().toISOString();
    if (userIds.length > 0) {
      const { error: updateErr } = await db
        .from("creator_followers")
        .update({ last_notified_at: nowIso })
        .eq("creator_id", event.creator_id)
        .in("follower_user_id", userIds);
      if (updateErr) {
        console.warn(
          "creator_followers throttle stamp failed:",
          updateErr.message,
        );
      }
    }

    await db
      .from("events")
      .update({ scheduled_notified_at: nowIso })
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
    console.error("notify-new-scheduled-event failed:", message);
    return jsonResponse({ error: message }, { status: 500 });
  }
});
