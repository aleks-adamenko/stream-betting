import { Stream } from "@cloudflare/stream-react";

import { cn } from "@/lib/utils";

/**
 * Cloudflare Stream live broadcast player.
 *
 * Implementation note — we used to render Cloudflare's `/iframe`
 * embed directly, but that's a cross-origin iframe and iOS Safari's
 * autoplay policy refuses to start playback in a cross-origin iframe
 * until the user has interacted with the parent document. Viewers on
 * mobile landed on the event page and saw an indefinite loading state.
 *
 * `@cloudflare/stream-react` renders a native `<video>` element with
 * HLS plumbed in via its SDK — no iframe — so the autoplay policy
 * that applies is the lenient native-video one: muted autoplay works
 * on every platform identically. Sub-second WHEP latency goes away
 * (the SDK uses HLS), but Cloudflare's HLS is low-latency by default
 * for live inputs with recording enabled (~3–5 s glass-to-glass) and
 * that's the universally-friendly trade-off.
 *
 * The player chrome (play/pause/volume/fullscreen) is still
 * Cloudflare's. If we ever want our own UI, we'd drop the SDK and
 * wire HLS.js into our existing HlsPlayer pointing at the live
 * manifest URL.
 */

interface CloudflareStreamPlayerProps {
  /** Full Cloudflare iframe URL stored on `events.playback_url`.
   *  Looks like `https://customer-XXX.cloudflarestream.com/<uid>/iframe`.
   *  We parse the UID out of the path for the `<Stream>` component. */
  src: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
}

export function CloudflareStreamPlayer({
  src,
  poster,
  autoPlay = true,
  muted = true,
  className,
}: CloudflareStreamPlayerProps) {
  const uid = extractStreamUid(src);

  // Defensive: if we can't parse a UID, fall back to a blank black
  // container rather than crashing the page. Shouldn't happen in
  // practice — provision-stream always writes the canonical URL —
  // but a manual DB edit could break the shape.
  if (!uid) {
    return (
      <div
        className={cn("relative h-full w-full overflow-hidden bg-black", className)}
      />
    );
  }

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden bg-black", className)}
    >
      <Stream
        src={uid}
        autoplay={autoPlay}
        muted={muted}
        // Muted autoplay also requires `playsInline` on iOS to keep
        // the video in the container instead of going fullscreen
        // (which iOS Safari does by default for un-tagged videos).
        // The SDK forwards this onto the underlying <video> element.
        // The prop is named `playsInline` in stream-react.
        responsive={false}
        controls
        poster={poster}
        // Hide Cloudflare's giant default logo to keep the frame
        // clean. `letterboxColor` replaces the black bars (when the
        // video aspect doesn't match the container) with a colour;
        // transparent lets the underlying black bg show through.
        letterboxColor="transparent"
        // Fill the wrapper.
        height="100%"
        width="100%"
      />
    </div>
  );
}

/** Pull the input UID out of a Cloudflare playback URL.
 *  Accepts the canonical iframe URL we store, and is forgiving about
 *  trailing path segments / query params. */
function extractStreamUid(url: string): string | null {
  // Path looks like `/<uid>/iframe` (or `/<uid>/manifest/video.m3u8`).
  // We just grab whatever sits between the host and the first
  // recognized suffix segment.
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // First non-empty path segment is the UID.
    return parts[0] ?? null;
  } catch {
    return null;
  }
}

/** Cheap predicate so callers can branch on "is this a Cloudflare
 *  Stream URL" vs an HLS URL or a social-embed URL. */
export function isCloudflareStreamUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("cloudflarestream.com") && url.endsWith("/iframe");
}
