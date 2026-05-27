// send-subscription-email — invoked by the user-app right after the
// `subscribe_event` RPC returns success. Sends the "you're on the
// list" confirmation email to the caller via Resend.
//
// Auth model: standard Supabase JWT (no --no-verify-jwt flag). We
// pull the caller's user_id from the JWT and look up their email
// from auth.users via the service-role client — we never trust an
// email passed in by the client.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { HttpError, requireUser } from "../_shared/auth.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import { FROM, resend, unsubscribeHeaders, APP_URL } from "../_shared/resend.ts";
import { renderSubscriptionConfirmation } from "../_shared/email-templates.ts";

interface Body {
  event_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const user = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const eventId = body.event_id;
    if (!eventId || typeof eventId !== "string") {
      throw new HttpError(400, "Missing event_id");
    }

    const db = serviceRoleClient();

    // Fetch event details for the email body + the creator name.
    // We join through creator_profiles so we can render "X scheduled
    // / X is live" with a friendly display name.
    const { data: event, error: eventErr } = await db
      .from("events")
      .select(
        `
        id, title, cover_url,
        creator:creator_profiles!events_creator_id_fkey ( display_name )
      `,
      )
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr) {
      throw new HttpError(500, `Lookup failed: ${eventErr.message}`);
    }
    if (!event) throw new HttpError(404, "Event not found");

    // Resolve the caller's email via auth.users — never trust
    // anything passed from the client.
    const { data: userResp, error: userErr } = await db.auth.admin.getUserById(
      user.id,
    );
    if (userErr || !userResp.user?.email) {
      throw new HttpError(500, "Could not read caller email");
    }
    const toEmail = userResp.user.email;

    // Respect the global notifications toggle. If a user opted out of
    // emails between tapping Notify and us getting here, skip silently
    // — they're already subscribed at the DB level and will see the
    // in-app notification when the event goes live.
    const { data: profile } = await db
      .from("profiles")
      .select("notifications_enabled")
      .eq("id", user.id)
      .maybeSingle();
    if (profile && profile.notifications_enabled === false) {
      return jsonResponse({ ok: true, skipped: "notifications_disabled" });
    }

    const creator = Array.isArray(event.creator) ? event.creator[0] : event.creator;
    const creatorName = creator?.display_name ?? "A LiveRush creator";
    const tmpl = renderSubscriptionConfirmation({
      eventTitle: event.title,
      eventId: event.id,
      coverUrl: event.cover_url,
      creatorName,
    });

    const { error: sendErr } = await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
      headers: unsubscribeHeaders(`${APP_URL}/profile?notifications=off`),
    });
    if (sendErr) {
      console.error("Resend send failed:", sendErr);
      throw new HttpError(500, `Resend: ${sendErr.message ?? "send failed"}`);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("send-subscription-email failed:", message);
    return jsonResponse({ error: message }, { status: 500 });
  }
});
