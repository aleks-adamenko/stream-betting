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
 * We keep `whip_url` and `playback_url` as the two fields the rest of
 * the app needs; the rest of Cloudflare's response (rtmps/srt) is
 * discarded for now — easy to surface later if we want OBS fallback.
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
 * `recording.mode: "automatic"` is required for HLS playback during
 * the live broadcast — Cloudflare only generates the .m3u8 manifest
 * when recording is enabled. We don't pass `deleteRecordingAfterDays`
 * because Cloudflare rejected our earlier values; we'll prune
 * recordings out-of-band if storage starts costing real money.
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

  return {
    uid: result.uid,
    whipUrl,
    // Cloudflare's iframe embed URL. Important: HLS playback is NOT
    // generated for WHIP-ingested live streams during the broadcast —
    // Cloudflare expects you to use WHEP (WebRTC playback). The
    // /iframe endpoint loads Cloudflare's player which speaks WHEP
    // internally and gives us sub-second viewer latency for free.
    // (HLS does become available later as a VOD recording, but we
    // don't expose that as the canonical playback URL since the
    // product is live-only.)
    playbackUrl: `https://${customerCode}.cloudflarestream.com/${result.uid}/iframe`,
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
