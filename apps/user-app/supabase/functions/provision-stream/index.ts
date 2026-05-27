// provision-stream — called by the studio when a creator hits Publish.
//
// Flow:
//   1. Verify the JWT and resolve the caller's user_id.
//   2. Look up the event. Caller must be the owner; status must be
//      'draft' or 'scheduled' (recovery path if a prior provision was
//      half-applied).
//   3. Idempotency: if event_streams already has a row for this event
//      (double-click on Publish), return the cached playback_url
//      without creating another Cloudflare live input.
//   4. Create a Cloudflare Stream live input (recording off, no
//      asset side-effects).
//   5. Persist:
//      • event_streams row with cf_input_uid + whip_url.
//      • events.playback_url = the HLS manifest URL.
//   6. Call publish_event(event_id) to flip status draft → scheduled
//      (or live, if scheduled_at <= now()).
//   7. Return { playback_url } to the studio.
//
// The studio fetches the WHIP URL separately via the
// `get_stream_credentials` SQL RPC at start-stream time — never
// returning the WHIP URL (which carries the publish secret) from this
// provision call keeps it out of the studio's call-time response
// history.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { HttpError, requireUser } from "../_shared/auth.ts";
import { createLiveInput, deleteLiveInput } from "../_shared/cloudflare.ts";
import { serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";

interface ProvisionBody {
  event_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const user = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as ProvisionBody;
    const eventId = body.event_id;
    if (!eventId || typeof eventId !== "string") {
      throw new HttpError(400, "Missing event_id");
    }

    const db = serviceRoleClient();

    // 2) Ownership + state check.
    const { data: event, error: eventErr } = await db
      .from("events")
      .select("id, title, creator_id, status, scheduled_at, playback_url")
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr) {
      throw new HttpError(500, `Database lookup failed: ${eventErr.message}`);
    }
    if (!event) throw new HttpError(404, "Event not found");
    if (event.creator_id !== user.id) {
      throw new HttpError(403, "Not your event");
    }
    if (!["draft", "scheduled"].includes(event.status)) {
      throw new HttpError(
        409,
        `Event is in state '${event.status}' — can't provision a live stream`,
      );
    }

    // 3) Idempotency — if we already have an event_streams row, just
    //    return the cached playback_url.
    const { data: existing } = await db
      .from("event_streams")
      .select("event_id")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existing && event.playback_url) {
      // If the row's status is still draft (because a previous
      // publish_event call somehow failed), nudge it forward now.
      // publish_event reads auth.uid() so it must be called via the
      // user-scoped client.
      if (event.status === "draft") {
        const userDb = userScopedClient(req.headers.get("Authorization"));
        const { error: pubErr } = await userDb.rpc("publish_event", {
          p_event_id: eventId,
        });
        if (pubErr) {
          throw new HttpError(500, `publish_event failed: ${pubErr.message}`);
        }
      }
      return jsonResponse({ playback_url: event.playback_url });
    }

    // 4) Create the Cloudflare live input. The dashboard name is just
    //    operational metadata — easier debugging than a raw UUID.
    const liveInput = await createLiveInput(`LiveRush: ${event.title}`);

    // 5) Persist credentials + playback url.
    const { error: insertErr } = await db.from("event_streams").insert({
      event_id: eventId,
      cf_input_uid: liveInput.uid,
      whip_url: liveInput.whipUrl,
    });
    if (insertErr) {
      // Try to clean up the Cloudflare side so we don't leak orphan
      // live inputs on a DB failure.
      try {
        await deleteLiveInput(liveInput.uid);
      } catch (_) {
        // swallow — we'll log via Cloudflare dashboard
      }
      throw new HttpError(
        500,
        `Failed to persist event_streams: ${insertErr.message}`,
      );
    }

    const { error: updateErr } = await db
      .from("events")
      .update({ playback_url: liveInput.playbackUrl })
      .eq("id", eventId);
    if (updateErr) {
      throw new HttpError(
        500,
        `Failed to update events.playback_url: ${updateErr.message}`,
      );
    }

    // 6) Flip status to scheduled (or live if start time is now/past).
    //    publish_event uses auth.uid() so it must be called via the
    //    user-scoped client. service-role would make auth.uid() null
    //    and the RPC raises "Not authenticated".
    const userDb = userScopedClient(req.headers.get("Authorization"));
    const { error: pubErr } = await userDb.rpc("publish_event", {
      p_event_id: eventId,
    });
    if (pubErr) {
      throw new HttpError(500, `publish_event failed: ${pubErr.message}`);
    }

    // 7) Done.
    return jsonResponse({ playback_url: liveInput.playbackUrl });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("provision-stream failed:", message);
    return jsonResponse({ error: message }, { status: 500 });
  }
});
