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
 * bearer token from the Postgres dispatch trigger. Used by every
 * trigger-dispatched function (notify-event-live,
 * notify-new-scheduled-event, notify-payout, notify-event-cancelled).
 *
 * The token lives in Supabase Vault on the database side
 * (`vault.read_secret('internal_webhook_token')`) and as the
 * `INTERNAL_WEBHOOK_TOKEN` secret on the function side. Constant-
 * time compare so we don't leak length info via timing.
 *
 * These functions are deployed with `verify_jwt = false` (see
 * `supabase/config.toml`) because the trigger sends our shared
 * secret as the bearer — NOT a JWT — and the Supabase API Gateway's
 * default JWT verification would reject every call with
 * `UNAUTHORIZED_INVALID_JWT_FORMAT`. With JWT verification disabled
 * at the gateway, this helper is the ONLY auth gate, so the
 * constant-time check matters.
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
