// close-betting-windows — cron job (every minute).
//
// Thin wrapper around the SQL RPC `close_expired_betting_windows()`,
// which lives in `20260529_000003_spec_compliance.sql`. The RPC:
//
//   1. Stamps `events.betting_window_closed_at = now()` for any live
//      event whose `betting_closes_at` has passed. UX-only — the
//      hard cutoff is enforced inside `place_bet` regardless.
//
//   2. Auto-cancels + refunds any live event still sitting > 15
//      minutes past its cutoff without a declared winner (spec 12.6).
//      The minute the streamer abandons the broadcast, viewers get
//      their stakes back without manual intervention.
//
// Per the spec (section 14.5) cron Edge Functions should call
// Postgres functions rather than touching tables directly — keeps the
// audit trail server-side and lets RLS / SECURITY DEFINER do their
// jobs.
//
// Wire-up (operator):
//   1. `supabase functions deploy close-betting-windows`
//   2. From Supabase Dashboard → Database → Cron, fire this every
//      1 minute (one of pg_cron.schedule(...) or the dashboard UI).

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const sb = serviceRoleClient();
  const { data, error } = await sb.rpc("close_expired_betting_windows");

  if (error) {
    console.error("close_expired_betting_windows RPC failed", error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }

  return jsonResponse({ ok: true, ...((data as Record<string, unknown>) ?? {}) });
});
