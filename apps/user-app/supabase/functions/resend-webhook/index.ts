// resend-webhook — Resend POSTs us bounce + complaint events so we
// can stop sending to dead / hostile mailboxes. Flipping
// `profiles.notifications_enabled = false` for the affected user is
// the simplest "stop bothering them" handler — they can still re-
// enable from the Profile page if it was a transient bounce.
//
// Deployed `--no-verify-jwt`: Resend doesn't carry a Supabase JWT.
// We validate the `svix-signature` header instead (HMAC-SHA-256 of
// `<svix-id>.<svix-timestamp>.<body>` against the webhook secret).
//
// Resend events we care about:
//   • email.bounced — recipient bounced (hard or soft).
//   • email.complained — recipient hit "Spam" or "Junk".
// Everything else we ack and ignore.

import { jsonResponse } from "../_shared/cors.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";

interface ResendWebhookEvent {
  type: string;
  data?: {
    email_id?: string;
    to?: string | string[];
    [key: string]: unknown;
  };
}

const SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET");

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }
  if (!SECRET) {
    console.error("RESEND_WEBHOOK_SECRET is not set");
    return jsonResponse({ error: "Server misconfigured" }, { status: 500 });
  }

  // Read the raw body BEFORE parsing — HMAC needs the exact bytes
  // Resend signed.
  const rawBody = await req.text();

  // svix-signature format: "v1,<base64-of-hmac>" — there can be more
  // than one space-separated entry; any matching one is accepted.
  const svixId = req.headers.get("svix-id") ?? "";
  const svixTs = req.headers.get("svix-timestamp") ?? "";
  const svixSig = req.headers.get("svix-signature") ?? "";

  if (!svixId || !svixTs || !svixSig) {
    return jsonResponse({ error: "Missing svix headers" }, { status: 401 });
  }

  const verified = await verifySvixSignature(svixId, svixTs, rawBody, svixSig, SECRET);
  if (!verified) {
    return jsonResponse({ error: "Bad signature" }, { status: 401 });
  }

  let event: ResendWebhookEvent;
  try {
    event = JSON.parse(rawBody) as ResendWebhookEvent;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event.type !== "email.bounced" && event.type !== "email.complained") {
    return jsonResponse({ ok: true, skipped: event.type });
  }

  // `data.to` may be a single address or an array of addresses; the
  // bounce / complaint applies to the address that hit the failure.
  // For batch sends Resend emits one webhook per recipient with a
  // single `to`, but defend against both shapes.
  const tos = Array.isArray(event.data?.to)
    ? event.data!.to
    : event.data?.to
      ? [event.data.to]
      : [];
  if (tos.length === 0) {
    return jsonResponse({ ok: true, skipped: "no recipient" });
  }

  const db = serviceRoleClient();
  // Resolve email → user_id via the auth schema. Service role
  // bypasses RLS so this lookup just works. For low volumes (< 10k
  // users) we don't need a materialised email index.
  const updates: Array<{ email: string; user_id: string }> = [];
  for (const addr of tos) {
    const lower = addr.toLowerCase();
    const { data: row, error } = await db
      .schema("auth" as never)
      .from("users")
      .select("id")
      .eq("email", lower)
      .maybeSingle();
    if (error) {
      console.warn(`auth.users lookup failed for ${lower}:`, error.message);
      continue;
    }
    if (row?.id) updates.push({ email: lower, user_id: row.id });
  }

  for (const u of updates) {
    const { error: profileErr } = await db
      .from("profiles")
      .update({ notifications_enabled: false })
      .eq("id", u.user_id);
    if (profileErr) {
      console.warn(
        `Failed to disable notifications for ${u.email}:`,
        profileErr.message,
      );
    }
  }

  return jsonResponse({ ok: true, disabled: updates.length });
});

// =========================================================================
// Svix HMAC verification
// =========================================================================
// Standard Svix format. Signed value = `${svix-id}.${svix-timestamp}.${body}`.
// `svix-signature` header carries one or more space-separated entries
// of shape `v1,<base64>` — accept the first one that matches.

async function verifySvixSignature(
  id: string,
  timestamp: string,
  body: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  // Resend's signing secret starts with `whsec_` — strip if present.
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0));
  } catch {
    // If the secret wasn't base64 (shouldn't happen with Resend),
    // fall back to a raw UTF-8 bytes interpretation.
    keyBytes = new TextEncoder().encode(rawSecret);
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${id}.${timestamp}.${body}`),
  );
  const expectedB64 = bufToB64(new Uint8Array(signed));

  const entries = sigHeader.split(" ");
  for (const e of entries) {
    const [version, sig] = e.split(",");
    if (version === "v1" && constantTimeEqual(sig ?? "", expectedB64)) {
      return true;
    }
  }
  return false;
}

function bufToB64(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
