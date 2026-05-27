import { HlsPlayer } from "@/components/stream/HlsPlayer";

/**
 * Cloudflare Stream live broadcast player.
 *
 * Implementation history:
 *   v1 — Cloudflare's `/iframe` embed. Sub-second WHEP latency but
 *        iOS Safari's cross-origin iframe autoplay policy blocked
 *        mobile autoplay until the user tapped the parent doc.
 *   v2 — `@cloudflare/stream-react`. Native <video> but inconsistent
 *        sizing (frame didn't fill the container) + same mobile
 *        autoplay issues + an extra SDK dep we don't need.
 *   v3 (now) — our own `HlsPlayer` pointed at the live HLS manifest
 *        URL. HlsPlayer already plumbs `playsInline`, `object-cover`,
 *        retry-on-fatal, and minimum-poster behaviour. Autoplay
 *        works on every platform because we control the <video>
 *        element directly. Latency rises to Cloudflare's standard
 *        HLS (~3–5 s) — fine for the consumption side, and the
 *        existing broadcast-delay buffer lives at this scale.
 *
 * Cloudflare serves an HLS manifest for any live input that was
 * created with `recording.mode: "automatic"` (our default), at
 * `https://customer-XXX.cloudflarestream.com/<uid>/manifest/video.m3u8`.
 * We derive it from the stored `/iframe` URL via a literal swap so
 * we don't need a schema migration; new events provisioned in the
 * future will continue to store the iframe URL as the canonical
 * playback link.
 */

interface CloudflareStreamPlayerProps {
  /** Full Cloudflare iframe URL stored on `events.playback_url`.
   *  Looks like `https://customer-XXX.cloudflarestream.com/<uid>/iframe`.
   *  We rewrite this to the HLS manifest URL before passing it down
   *  to HlsPlayer. */
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
  const manifestUrl = toHlsManifestUrl(src);
  return (
    <HlsPlayer
      src={manifestUrl}
      poster={poster}
      autoPlay={autoPlay}
      muted={muted}
      className={className}
    />
  );
}

/** Rewrite a Cloudflare `/iframe` URL to its corresponding HLS
 *  manifest URL. If the input doesn't look like an iframe URL we
 *  return it unchanged — HlsPlayer will surface its own error
 *  state rather than silently 404. */
function toHlsManifestUrl(iframeUrl: string): string {
  if (iframeUrl.endsWith("/iframe")) {
    return iframeUrl.slice(0, -"/iframe".length) + "/manifest/video.m3u8";
  }
  // Already a manifest URL? Pass through. Anything else? Pass through
  // and let HlsPlayer report the real error.
  return iframeUrl;
}

/** Cheap predicate so callers can branch on "is this a Cloudflare
 *  Stream URL" vs an HLS URL or a social-embed URL. The stored
 *  shape is still the iframe URL, hence the suffix check. */
export function isCloudflareStreamUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("cloudflarestream.com") && url.endsWith("/iframe");
}
