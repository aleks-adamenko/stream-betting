import { useRef, useState } from "react";
import { Play } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Cloudflare Stream live broadcast player.
 *
 * Why iframe (and not HLS via <video>): Cloudflare Stream live
 * inputs DO NOT serve an HLS manifest during the live broadcast —
 * HLS is only available as a VOD recording AFTER the stream ends.
 * During the live window, Cloudflare expects viewers to use WHEP
 * (WebRTC playback), and the only no-custom-code path to consume
 * WHEP is their hosted iframe player. So iframe it is.
 *
 * Mobile autoplay quirk: iOS Safari refuses to autoplay a
 * *cross-origin* iframe until the user has interacted with the
 * parent document. There's no developer override for this — it's
 * a browser-enforced privacy policy. Workaround below:
 *   • Desktop / large viewports: autoplay starts immediately (the
 *     policy doesn't apply on desktop browsers).
 *   • Touch viewports: we render a full-frame overlay with a Play
 *     icon over the cover image. One tap satisfies the parent-doc
 *     gesture requirement and we postMessage Cloudflare's player
 *     to start. The overlay hides itself after that single tap.
 *
 * The iframe itself fills the container via `absolute inset-0`.
 */

interface CloudflareStreamPlayerProps {
  /** Full iframe URL from `events.playback_url`, e.g.
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Tap-to-play overlay is shown only on touch devices, only
  // before the user's first tap. Once dismissed it stays hidden
  // for the lifetime of this component instance — subsequent
  // pauses are user-initiated via Cloudflare's own controls.
  const isTouch = useTouchDevice();
  const [overlayShown, setOverlayShown] = useState(isTouch);

  // Build the iframe URL with Cloudflare's documented behaviour
  // flags. autoplay=true + muted=true is the canonical muted-
  // autoplay configuration browsers accept everywhere except
  // cross-origin iframes on iOS (handled by the overlay above).
  const params = new URLSearchParams();
  if (autoPlay) params.set("autoplay", "true");
  if (muted) params.set("muted", "true");
  if (poster) params.set("poster", poster);
  // Black letterbox bars when the source aspect doesn't match the
  // container.  `transparent` lets the parent's bg-black show
  // through cleanly.
  params.set("letterboxColor", "transparent");
  const url = `${src}?${params.toString()}`;

  const handleStartPlayback = () => {
    setOverlayShown(false);
    // Send the play command via postMessage so the iframe's video
    // element starts. Without this the iframe might stay paused
    // even after the gesture lands — autoplay was already
    // attempted and failed silently before the tap.
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "method", method: "play" }),
      "*",
    );
  };

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-black",
        className,
      )}
    >
      <iframe
        ref={iframeRef}
        src={url}
        title="Live stream"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
      {overlayShown && (
        <button
          type="button"
          onClick={handleStartPlayback}
          aria-label="Tap to play"
          // Sits over the iframe and intercepts the first tap. Once
          // it disappears the iframe is interactive (volume,
          // fullscreen, etc.). The cover image is rendered behind
          // the iframe by Cloudflare's player itself (via the
          // `poster=` URL param) so the user sees content here, not
          // a black box.
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 transition-colors active:bg-black/50"
        >
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-black shadow-lg">
            <Play className="h-7 w-7 fill-current" />
          </span>
        </button>
      )}
    </div>
  );
}

/** True on devices whose primary input is a touch surface (phones,
 *  tablets). We use this to decide whether to show the tap-to-play
 *  overlay. Hydration-safe: returns false on the server (the SPA
 *  doesn't SSR anyway, but useful for tests). */
function useTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

/** Cheap predicate so callers can branch on "is this a Cloudflare
 *  iframe URL" vs an HLS URL or a social-embed URL. */
export function isCloudflareStreamUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("cloudflarestream.com") && url.endsWith("/iframe");
}
