// Stripe client for Edge Functions.
//
// One factory + the type re-exports the two functions need. Pinned to
// the major version so an unexpected breaking change in Stripe's SDK
// can't drop a paid checkout flow without a deliberate bump.
//
// Env vars (set via `supabase secrets set`):
//   • STRIPE_SECRET_KEY     — sk_test_… in sandbox, sk_live_… in prod
//   • STRIPE_WEBHOOK_SECRET — whsec_… from the dashboard webhook
//                             endpoint config. Used only by stripe-webhook.
//   • APP_BASE_URL          — public origin the user returns to after
//                             checkout, e.g. https://liverush.co.
//                             Used to build success / cancel URLs.

import Stripe from "npm:stripe@^17";

const SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const APP_BASE_URL = Deno.env.get("APP_BASE_URL");

if (!SECRET_KEY) {
  throw new Error(
    "Missing STRIPE_SECRET_KEY — set via `supabase secrets set STRIPE_SECRET_KEY=sk_test_…`.",
  );
}

/**
 * Single Stripe client instance reused across handler invocations.
 * The Stripe SDK is stateless apart from the API key + version, so
 * one instance is enough.
 *
 * `httpClient: 'fetch'` is essential on Deno — the default Node http
 * client doesn't exist there. The async `webhooks.constructEventAsync`
 * we use below also needs WebCrypto, which `fetch` mode wires up.
 */
export const stripe = new Stripe(SECRET_KEY, {
  apiVersion: "2025-09-30.clover",
  httpClient: Stripe.createFetchHttpClient(),
});

/** Re-export for handler files. */
export type { Stripe };

/** Webhook signing secret, lazily required (only the webhook function
 *  needs it, so the create-checkout-session function shouldn't fail to
 *  boot when this isn't set). Callers that need it should call this
 *  helper rather than reading the env directly. */
export function getWebhookSecret(): string {
  if (!WEBHOOK_SECRET) {
    throw new Error(
      "Missing STRIPE_WEBHOOK_SECRET — set via `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…`.",
    );
  }
  return WEBHOOK_SECRET;
}

/** Public base URL the user returns to after Stripe Checkout. Required
 *  for `success_url` / `cancel_url`. Trimmed of trailing slash for
 *  predictable joins. */
export function getAppBaseUrl(): string {
  if (!APP_BASE_URL) {
    throw new Error(
      "Missing APP_BASE_URL — set via `supabase secrets set APP_BASE_URL=https://liverush.co`.",
    );
  }
  return APP_BASE_URL.replace(/\/$/, "");
}
