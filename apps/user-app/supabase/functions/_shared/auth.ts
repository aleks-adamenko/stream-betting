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
