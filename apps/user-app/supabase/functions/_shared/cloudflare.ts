// Cloudflare Stream client for Edge Functions.
//
// Cloudflare's Stream API is a plain JSON REST endpoint, so there's no
// SDK to install — just authenticated fetch() calls. We export two
// helpers (create + delete live inputs) and a URL builder for the
// public HLS manifest URL viewers load.
//
// Env vars (set via `supabase secrets set` during Phase 0):
//   • CLOUDFLARE_ACCOUNT_ID    — account that owns the Stream subscription
//   • CLOUDFLARE_STREAM_TOKEN  — API token with Stream:Edit permission
//   • CLOUDFLARE_CUSTOMER_CODE — per-customer subdomain (e.g. customer-abc123).
//                                Used to build playback URLs; not a secret,
//                                but lives in one place so the URL pattern
//                                only exists in one file.

const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
const apiToken = Deno.env.get("CLOUDFLARE_STREAM_TOKEN");
const rawCustomerCode = Deno.env.get("CLOUDFLARE_CUSTOMER_CODE");

if (!accountId || !apiToken || !rawCustomerCode) {
  throw new Error(
    "Missing Cloudflare env vars: set CLOUDFLARE_ACCOUNT_ID, " +
      "CLOUDFLARE_STREAM_TOKEN, CLOUDFLARE_CUSTOMER_CODE via `supabase secrets set`.",
  );
}

// Cloudflare's dashboard shows the customer subdomain in two forms
// depending on where you look: sometimes the bare prefix
// (`customer-abc123`), sometimes the full host
// (`customer-abc123.cloudflarestream.com`). Accept either by stripping
// the suffix if present — the playback URL builder below tacks it
// back on exactly once.
const customerCode = rawCustomerCode
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .replace(/\.cloudflarestream\.com$/, "");

const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`;

interface CloudflareLiveInputResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: {
    uid: string;
    rtmps?: { url: string; streamKey: string };
    srt?: { url: string; streamId: string; passphrase: string };
    webRTC?: { url: string };
    webRTCPlayback?: { url: string };
  };
}

/**
 * Result shape returned to the caller (the provision-stream function).
 * - `whipUrl`: contains the publish secret in its path. Creator-only,
 *   gated by RLS via the get_stream_credentials RPC.
 * - `playbackUrl`: the WHEP (WebRTC playback) URL viewers use to
 *   subscribe to the live broadcast. Public; stored in
 *   `events.playback_url`. The browser opens its own
 *   RTCPeerConnection to this URL — see CloudflareStreamPlayer.
 */
export interface CreatedLiveInput {
  uid: string;
  whipUrl: string;
  playbackUrl: string;
}

/**
 * Create a Cloudflare Stream live input. `name` is purely operational
 * (shows up in the dashboard list).
 *
 * `recording.mode: "automatic"` is set even though Cloudflare doesn't
 * currently record WHIP-published streams — when they add that
 * support we get it for free, and it's harmless until then.
 *
 * Critical Cloudflare behaviour: a live input ingested via WHIP only
 * exposes WHEP for playback. The HLS/DASH transcoder is RTMPS-only.
 * Don't use the /iframe URL for WHIP-published streams — it polls for
 * an HLS manifest that will never appear. Use webRTCPlayback.url +
 * a WHEP client instead.
 */
export async function createLiveInput(name: string): Promise<CreatedLiveInput> {
  const res = await fetch(`${API_BASE}/live_inputs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      meta: { name },
      recording: { mode: "automatic" },
    }),
  });

  const body = (await res.json()) as CloudflareLiveInputResponse;
  if (!res.ok || !body.success || !body.result) {
    const errMsg = body.errors?.map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(
      `Cloudflare createLiveInput failed (${res.status}): ${errMsg ?? res.statusText}`,
    );
  }

  const result = body.result;
  const whipUrl = result.webRTC?.url;
  if (!whipUrl) {
    throw new Error(
      "Cloudflare response missing webRTC.url — is WHIP enabled on this account?",
    );
  }

  // Prefer the API-returned WHEP URL; fall back to the documented
  // URL pattern if Cloudflare's response shape ever shifts. Pattern
  // is intentionally encoded here so the rest of the app never has
  // to know it.
  const whepUrl =
    result.webRTCPlayback?.url ??
    `https://${customerCode}.cloudflarestream.com/${result.uid}/webRTC/play`;

  return {
    uid: result.uid,
    whipUrl,
    playbackUrl: whepUrl,
  };
}

/**
 * Tear down a live input by its UID. Cloudflare is permissive here — a
 * 404 means it's already gone, which is fine; we let the caller swallow
 * those.
 */
export async function deleteLiveInput(uid: string): Promise<void> {
  const res = await fetch(`${API_BASE}/live_inputs/${uid}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Cloudflare deleteLiveInput failed (${res.status}): ${body || res.statusText}`,
    );
  }
}
