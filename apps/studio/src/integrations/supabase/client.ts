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
 * To avoid that we resolve the current session up front, force a token
 * refresh when it is missing / expired / within 60s of expiry, and pass
 * the resulting access token explicitly so the request always carries a
 * valid user JWT. A failed refresh surfaces a clear re-auth message
 * instead of an opaque 401.
 */
export async function invokeEdgeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
) {
  let session = (await supabase.auth.getSession()).data.session;

  const expiresAtMs = (session?.expires_at ?? 0) * 1000;
  if (!session || expiresAtMs - Date.now() < 60_000) {
    const { data: refreshed, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session) {
      throw new Error("Your session has expired. Please sign in again.");
    }
    session = refreshed.session;
  }
  if (!session) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  return supabase.functions.invoke<T>(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
}
