// end-stream — called by the studio when the creator hits End stream.
//
// Flow:
//   1. Verify the JWT and resolve the caller's user_id.
//   2. Look up the event. Caller must be the owner; status must be
//      'live' (the normal path) or 'scheduled' (creator hit End before
//      the camera ever connected to Cloudflare — still tear down cleanly).
//   3. Read the event_streams row (if any) to get cf_input_uid.
//   4. Best-effort `deleteLiveInput(uid)`. 404 is swallowed because
//      Cloudflare may have already cleaned it up.
//   5. Delete the event_streams row. Service-role bypasses RLS.
//   6. Call finish_event(event_id) via the user-scoped client so the
//      RPC's auth.uid() check passes — this flips status to 'finished'
//      and stamps finished_at.
//   7. Return { ok: true }.
//
// Idempotency: if the event is already 'finished', return ok without
// touching Cloudflare.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { HttpError, requireUser } from "../_shared/auth.ts";
import { deleteLiveInput } from "../_shared/cloudflare.ts";
import { serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";

interface EndStreamBody {
  event_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const user = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as EndStreamBody;
    const eventId = body.event_id;
    if (!eventId || typeof eventId !== "string") {
      throw new HttpError(400, "Missing event_id");
    }

    const db = serviceRoleClient();

    // 2) Ownership + state check.
    const { data: event, error: eventErr } = await db
      .from("events")
      .select("id, creator_id, status")
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr) {
      throw new HttpError(500, `Database lookup failed: ${eventErr.message}`);
    }
    if (!event) throw new HttpError(404, "Event not found");
    if (event.creator_id !== user.id) {
      throw new HttpError(403, "Not your event");
    }

    // Idempotent: if it's already finished, just say ok.
    if (event.status === "finished") {
      return jsonResponse({ ok: true });
    }

    if (!["live", "scheduled"].includes(event.status)) {
      throw new HttpError(
        409,
        `Event is in state '${event.status}' — can't end it`,
      );
    }

    // 3) Look up the Cloudflare live input UID so we can delete it.
    const { data: streamRow } = await db
      .from("event_streams")
      .select("cf_input_uid")
      .eq("event_id", eventId)
      .maybeSingle();

    // 4) Best-effort Cloudflare delete. We log and continue on failure
    //    — the DB state is the source of truth for our app.
    if (streamRow?.cf_input_uid) {
      try {
        await deleteLiveInput(streamRow.cf_input_uid);
      } catch (err) {
        console.warn(
          `Cloudflare deleteLiveInput failed (continuing):`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // 5) Drop the event_streams row — credentials are now useless.
    if (streamRow) {
      const { error: delErr } = await db
        .from("event_streams")
        .delete()
        .eq("event_id", eventId);
      if (delErr) {
        console.warn("event_streams cleanup failed:", delErr.message);
      }
    }

    // 6) Flip status to 'finished'. finish_event uses auth.uid() so it
    //    must be called via the user-scoped client.
    const userDb = userScopedClient(req.headers.get("Authorization"));
    const { error: finErr } = await userDb.rpc("finish_event", {
      p_event_id: eventId,
    });
    if (finErr) {
      throw new HttpError(500, `finish_event failed: ${finErr.message}`);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("end-stream failed:", message);
    return jsonResponse({ error: message }, { status: 500 });
  }
});
