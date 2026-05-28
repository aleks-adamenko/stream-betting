import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { WebRTCPlayer } from "@eyevinn/webrtc-player";

import { cn } from "@/lib/utils";

/**
 * Cloudflare Stream live broadcast viewer.
 *
 * Uses Eyevinn's @eyevinn/webrtc-player to consume the live stream
 * over WHEP (WebRTC playback). Why this and not a custom WHEP
 * client: Cloudflare's own docs recommend it, and rolling our own
 * WHEP client was the source of debug pain in earlier iterations —
 * subtle issues around DTLS setup roles, ICE timing, and transceiver
 * direction are all handled by the library.
 *
 * Why not the /iframe player: that polls for an HLS manifest, but
 * Cloudflare doesn't generate HLS for WHIP-published streams (only
 * RTMPS feeds the HLS transcoder). Iframe + WHIP = indefinite
 * "Stream has not started yet" cover. WHEP is the only correct
 * playback path for WHIP ingest.
 *
 * Latency: ~sub-second, same as before. Mobile autoplay: the
 * native <video> with `muted` attribute + library-driven playback
 * works on iOS Safari without the cross-origin-iframe restriction.
 */

interface CloudflareStreamPlayerProps {
  /** Full WHEP URL from `events.playback_url`. Looks like
   *  `https://customer-XXX.cloudflarestream.com/<uid>/webRTC/play`. */
  src: string;
  poster?: string;
  className?: string;
}

export function CloudflareStreamPlayer({
  src,
  poster,
  className,
}: CloudflareStreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<WebRTCPlayer | null>(null);
  const [muted, setMuted] = useState(true);
  const [hasMedia, setHasMedia] = useState(false);

  // Spin up the WHEP player when the WHEP URL is available and
  // tear it down on unmount / src change. The library handles
  // SDP / ICE / DTLS internally.
  //
  // StrictMode protection: in development React intentionally runs
  // this effect twice on mount (mount → cleanup → mount). Each run
  // would otherwise POST a fresh WHEP offer to Cloudflare; the
  // server's first session is still being torn down when the second
  // POST arrives, so Cloudflare returns 409 Conflict and the second
  // session never starts → broken player. We defer the real setup
  // by a microtask + small timeout so the cleanup from the first
  // run cancels it before a single WHEP request is made; the second
  // run is then the only one that actually fires.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let cancelled = false;
    let player: WebRTCPlayer | null = null;
    let onPlaying: (() => void) | null = null;
    let onLoadedMetadata: (() => void) | null = null;

    const setupTimer = setTimeout(() => {
      if (cancelled) return;

      console.info("[whep] loading", src);

      player = new WebRTCPlayer({
        video,
        type: "whep",
        debug: true,
      });
      playerRef.current = player;

      player.on("error", (err: unknown) =>
        console.error("[whep] error:", err),
      );
      player.on("no-media", () =>
        console.warn("[whep] no media received yet from Cloudflare"),
      );
      player.on("media-recovered", () =>
        console.info("[whep] media recovered"),
      );
      player.on("connect-error", (err: unknown) =>
        console.error("[whep] connect-error:", err),
      );

      onPlaying = () => {
        console.info("[whep] <video> playing event — media is flowing");
        setHasMedia(true);
      };
      onLoadedMetadata = () =>
        console.info("[whep] <video> loadedmetadata");
      video.addEventListener("playing", onPlaying);
      video.addEventListener("loadedmetadata", onLoadedMetadata);

      let url: URL;
      try {
        url = new URL(src);
      } catch (err) {
        console.error("[whep] invalid src URL:", src, err);
        return;
      }

      player
        .load(url)
        .then(() => {
          if (cancelled) return;
          console.info("[whep] load resolved");
          // Chrome's `autoplay` attribute is unreliable when the
          // source is a MediaStream srcObject (vs. an `src` URL).
          // Call play() ourselves once the library has wired up
          // the inbound stream. Muted so autoplay policy lets us.
          video.play().catch((err) => {
            console.warn("[whep] play() failed:", err);
          });
        })
        .catch((err) => console.error("[whep] load failed:", err));
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(setupTimer);
      if (onPlaying) video.removeEventListener("playing", onPlaying);
      if (onLoadedMetadata)
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
      if (player) {
        player.destroy();
        playerRef.current = null;
      }
      setHasMedia(false);
    };
  }, [src]);

  // Apply mute state through the library's own API. The library
  // manages audio routing internally, so toggling `video.muted`
  // directly is not enough — its mute()/unmute() methods are what
  // actually flip the audio track on/off in the inbound MediaStream.
  // We mirror onto `video.muted` as a belt-and-braces fallback for
  // browsers that key off the HTMLMediaElement attribute.
  useEffect(() => {
    const player = playerRef.current;
    const video = videoRef.current;
    if (player) {
      if (muted) player.mute();
      else player.unmute();
    }
    if (video) video.muted = muted;
  }, [muted]);

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-black",
        className,
      )}
    >
      {/* Poster image is shown until we have media flowing. Once
          the <video> hits the `playing` event we fade it out so
          the live frame takes over. */}
      {poster && !hasMedia && (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          "absolute inset-0 h-full w-full bg-black object-contain transition-opacity",
          hasMedia ? "opacity-100" : "opacity-0",
        )}
      />
      {hasMedia && (
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Unmute" : "Mute"}
          className="absolute bottom-3 right-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/80"
        >
          {muted ? (
            <VolumeX className="h-5 w-5" />
          ) : (
            <Volume2 className="h-5 w-5" />
          )}
        </button>
      )}
    </div>
  );
}

/** Cheap predicate so callers can branch on "is this a Cloudflare
 *  WHEP playback URL" vs an HLS URL or social-embed URL. */
export function isCloudflareStreamUrl(
  url: string | null | undefined,
): boolean {
  if (!url) return false;
  return (
    url.includes("cloudflarestream.com") &&
    (url.includes("/webRTC/play") || url.endsWith("/iframe"))
  );
}
