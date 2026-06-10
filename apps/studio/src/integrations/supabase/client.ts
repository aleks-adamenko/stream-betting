import { createClient } from "@supabase/supabase-js";

import type { Database } from "./types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local",
  );
}

// Same Supabase project as user-app, but a distinct localStorage `storageKey`
// so a single browser can hold both an active user-app session and an active
// studio session without overwriting each other.
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    storageKey: "liverush-studio.auth",
  },
});

/** True when a functions.invoke error is an HTTP 401 from the function. */
function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const ctx = (error as { context?: { status?: number } }).context;
  return ctx?.status === 401;
}

/** Force-refresh the session; throws a clear re-auth message on failure. */
async function refreshOrThrow() {
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    throw new Error("Your session has expired. Please sign in again.");
  }
  return data.session;
}

/**
 * Invoke an Edge Function with a guaranteed-fresh user access token.
 *
 * `supabase.functions.invoke` attaches whatever access token the
 * functions client last cached. If the studio tab has been sitting idle
 * — e.g. a creator watching a long betting window before ending the
 * stream — that cached token can expire, or the client can silently
 * fall back to the anon publishable key. Either way the Edge Function's
 * `requireUser()` rejects the call with 401 "Invalid or expired token".
 *
 * Two layers of protection:
 *  1. Resolve the session up front and force a refresh when it is
 *     missing or within 60s of expiry (per the client's own clock), then
 *     pass the access token explicitly so the request carries a valid
 *     user JWT instead of a cached/anon one.
 *  2. If the function still answers 401 — which happens when the client
 *     *thinks* its token is valid but the server rejects it (stale stored
 *     session, server-side revoke, or clock skew) — force a refresh and
 *     retry exactly once. A failed refresh surfaces a clear re-auth
 *     message instead of an opaque 401.
 */
export async function invokeEdgeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
) {
  const invokeWith = (accessToken: string) =>
    supabase.functions.invoke<T>(name, {
      body,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

  let session = (await supabase.auth.getSession()).data.session;

  const expiresAtMs = (session?.expires_at ?? 0) * 1000;
  if (!session || expiresAtMs - Date.now() < 60_000) {
    session = await refreshOrThrow();
  }

  const result = await invokeWith(session.access_token);

  // The token looked valid to us but the server rejected it — refresh
  // from the refresh token and retry once before giving up.
  if (isUnauthorizedError(result.error)) {
    const refreshed = await refreshOrThrow();
    return invokeWith(refreshed.access_token);
  }

  return result;
}
