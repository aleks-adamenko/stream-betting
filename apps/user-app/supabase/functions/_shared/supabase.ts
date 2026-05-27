// Supabase client factories for use inside Edge Functions.
//
// Two flavours:
//   • `serviceRoleClient()` — bypasses RLS. Use for cross-user writes
//     (insert event_streams, update events.playback_url) and for
//     calling RPCs that need to act on behalf of any user (e.g.
//     publish_event from the provision-stream function).
//   • `userScopedClient(authHeader)` — runs as the calling user.
//     Useful for read-only checks that already have RLS coverage.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error(
    "Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY).",
  );
}

export function serviceRoleClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * User-scoped client — inherits the caller's auth context via the
 * Authorization header forwarded from the browser. Useful when you
 * want RLS to enforce ownership for you.
 */
export function userScopedClient(authHeader: string | null) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
