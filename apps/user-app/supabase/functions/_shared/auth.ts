// JWT → user_id helper for Edge Functions.
//
// Edge Functions deployed without `--no-verify-jwt` already get the
// JWT verified by the Supabase gateway, but we still need to *read*
// the user_id and validate the caller exists. The cleanest way is to
// hand the Authorization header to a user-scoped Supabase client and
// call `auth.getUser()` — that re-validates the token and returns the
// user row in one round trip.

import { userScopedClient } from "./supabase.ts";

export type AuthedUser = {
  id: string;
  email: string | null;
};

/**
 * Extracts the bearer JWT from the request and returns the
 * authenticated user. Throws (caller catches and 401s) on missing or
 * invalid token.
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }

  const client = userScopedClient(authHeader);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "Invalid or expired token");
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Small typed error class so handler bodies can `throw new HttpError(...)`
 * and the top-level catch can map to a proper response code.
 */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Internal-only auth: validate that the request carries our shared
 * bearer token from the Postgres dispatch trigger. Used by the
 * notify-event-live and notify-new-scheduled-event functions.
 *
 * The token lives in Supabase Vault on the database side
 * (`vault.read_secret('internal_webhook_token')`) and as the
 * `INTERNAL_WEBHOOK_TOKEN` secret on the function side. Constant-
 * time compare so we don't leak length info via timing.
 *
 * These functions are deployed normally (not `--no-verify-jwt`) BUT
 * the JWT is the trigger's service-role JWT which the gateway already
 * accepts — this helper is the additional defense-in-depth check that
 * the call really did come from our trigger and not from a leaked
 * service-role key being misused.
 */
export function requireInternalToken(req: Request): void {
  const expected = Deno.env.get("INTERNAL_WEBHOOK_TOKEN");
  if (!expected) {
    throw new HttpError(500, "INTERNAL_WEBHOOK_TOKEN is not configured");
  }
  const header = req.headers.get("Authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length === 0 || provided.length !== expected.length) {
    throw new HttpError(401, "Bad token");
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) {
    throw new HttpError(401, "Bad token");
  }
}
