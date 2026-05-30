// Resend SDK factory + shared helpers for the notification Edge
// Functions.
//
// RESEND_API_KEY comes from `supabase secrets set`. The Resend account
// + verified `liverush.co` sending domain are pre-existing — this file
// just wires them into our Edge Function runtime.
//
// Why `npm:resend@^4.0.0` and not the Deno-native `resend` module:
// Resend's published Deno fork lags the npm release. Using the npm
// specifier means we ride the well-trodden SDK path that gets all the
// new features (`batch.send`, idempotency keys, etc.).

import { Resend } from "npm:resend@^4.0.0";

const apiKey = Deno.env.get("RESEND_API_KEY");

if (!apiKey) {
  throw new Error(
    "Missing RESEND_API_KEY env var — set it via `supabase secrets set RESEND_API_KEY=…`.",
  );
}

export const resend = new Resend(apiKey);

/**
 * Sender for all transactional emails. The display name shows up in
 * inbox previews; the address must live on a Resend-verified domain.
 */
export const FROM = "LiveRush <noreply@liverush.co>";

/**
 * Base URL for the public user-app. Used to build deep links inside
 * the email body (event page, /notifications, unsubscribe).
 */
export const APP_URL = Deno.env.get("APP_URL") ?? "https://liverush.co";

/**
 * Base URL for the creator-facing studio app. Used by creator-side
 * emails (rake credited, payout rejected) so the CTA opens the studio
 * balance / event detail page instead of the public user-app.
 */
export const STUDIO_URL =
  Deno.env.get("STUDIO_URL") ?? "https://studio.liverush.co";

/**
 * RFC 8058 one-click-unsubscribe headers. Gmail requires these for
 * any sender > 5k emails/day; harmless to ship at any volume. The
 * `unsubscribeUrl` should deep-link to the user-app's notifications
 * settings page, which is also reachable from the Profile toggle.
 *
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is the magic
 * that turns the "Unsubscribe" link in Gmail / Yahoo / iCloud's
 * preview pane into an instant-action button.
 */
export function unsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
