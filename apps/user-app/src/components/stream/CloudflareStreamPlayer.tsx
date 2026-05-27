import { cn } from "@/lib/utils";

/**
 * Cloudflare Stream live broadcast player.
 *
 * Cloudflare doesn't generate HLS manifests for WHIP-ingested live
 * streams while they're broadcasting — they expect viewers to use
 * WHEP (WebRTC-HTTP egress playback) instead. The simplest way to
 * consume WHEP without writing a custom WebRTC client is Cloudflare's
 * own iframe player, which handles the WHEP handshake internally and
 * also gracefully falls back to HLS if the stream has ended and a
 * recording is available.
 *
 * Sub-second glass-to-glass latency is a useful side benefit over the
 * 5–10 s lag of HLS.
 *
 * Trade-off: the player chrome (play/pause/volume/fullscreen) is
 * Cloudflare's, not ours. If we ever need full UI control we'd swap
 * this for a custom WHEP client (e.g. `@cloudflare/stream-react` or
 * direct RTCPeerConnection negotiation).
 */
interface CloudflareStreamPlayerProps {
  /** Full iframe URL from `event.playback_url`. Looks like
   *  `https://customer-XXX.cloudflarestream.com/<uid>/iframe`. */
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
  // Pass behaviour flags via Cloudflare's documented query params so
  // the embed renders the way the rest of the user-app expects:
  // muted autoplay viewers, with a poster shown until playback starts.
  const params = new URLSearchParams();
  if (autoPlay) params.set("autoplay", "true");
  if (muted) params.set("muted", "true");
  if (poster) params.set("poster", poster);
  // Hides the giant Cloudflare logo overlay; the player controls
  // remain visible.
  params.set("letterboxColor", "transparent");
  const url = `${src}?${params.toString()}`;

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-black", className)}>
      <iframe
        src={url}
        title="Live stream"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}

/** Cheap predicate so callers can branch on "is this a Cloudflare
 *  iframe URL" vs an HLS URL or a social-embed URL. */
export function isCloudflareStreamUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("cloudflarestream.com") && url.endsWith("/iframe");
}
