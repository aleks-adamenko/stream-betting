import { useEffect, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import { WebRTCPlayer } from "@eyevinn/webrtc-player";

import { cn } from "@/lib/utils";

/**
 * Cloudflare Stream live broadcast viewer.
 *
 * Uses Eyevinn's @eyevinn/webrtc-player to consume the live stream
 * over WHEP (WebRTC playback). Cloudflare doesn't generate HLS for
 * WHIP-published streams (only RTMPS feeds the HLS transcoder), so
 * WHEP is the only correct playback path for our ingest pipeline.
 *
 * Loading UX:
 *   • Until the inbound MediaStream actually fires the `playing`
 *     event we show the cover image + a centered spinner overlay.
 *   • The `<video>` is rendered with opacity-0 underneath the
 *     spinner so swapping in feels instantaneous (no remount).
 *
 * Lazy mounting (for in-feed players, e.g. StreamCard on the home
 * feed): if `lazy` is true, we delay opening the WHEP connection
 * until the player's container scrolls into view, and tear it down
 * again once it leaves. This avoids holding dozens of simultaneous
 * WebRTC sessions for off-screen feed cards.
 *
 * Audio toggle: muted by default for autoplay compatibility. The
 * unmute button at the bottom-center flips it. We use
 * `player.unmute()` (the library's API) AND `muted={muted}` (the
 * React-tracked prop) — the bare `muted` attribute alone caused
 * React to re-apply `true` on every render and override the user's
 * unmute click.
 */

interface CloudflareStreamPlayerProps {
  /** Full WHEP URL from `events.playback_url`. Looks like
   *  `https://customer-XXX.cloudflarestream.com/<uid>/webRTC/play`. */
  src: string;
  poster?: string;
  className?: string;
  /** When true, only open the WHEP connection while the container
   *  is in the viewport. Tears down the connection when scrolled
   *  off-screen so a feed of N live cards doesn't hold N WebRTC
   *  sessions open. Default false — for the event page / featured
   *  hero we want the stream playing the moment the page loads. */
  lazy?: boolean;
}

export function CloudflareStreamPlayer({
  src,
  poster,
  className,
  lazy = false,
}: CloudflareStreamPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<WebRTCPlayer | null>(null);
  const [muted, setMuted] = useState(true);
  const [hasMedia, setHasMedia] = useState(false);
  // `inView` only matters when `lazy` is true. We default to !lazy
  // so eagerly-mounted players (event page, featured hero) start
  // immediately without waiting for an IntersectionObserver tick.
  const [inView, setInView] = useState(!lazy);

  // Lazy-mount: IntersectionObserver flips `inView` true/false as
  // the container enters / leaves the viewport. The setup effect
  // below keys off `inView`, so a player can be created/destroyed
  // multiple times as the user scrolls past.
  useEffect(() => {
    if (!lazy) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      // 0.25 means: connect when 25% of the card is visible. Keeps
      // us from opening a session for a card that's just barely
      // entered the viewport on a fast scroll.
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [lazy]);

  // Spin up the WHEP player when the WHEP URL is available + we're
  // in view (eager mounts treat inView as always true). Tear down
  // on unmount / src change / scroll-off. The library handles SDP /
  // ICE / DTLS internally.
  //
  // StrictMode protection: in development React intentionally runs
  // this effect twice on mount (mount → cleanup → mount). Each run
  // would otherwise POST a fresh WHEP offer to Cloudflare; the
  // server's first session is still being torn down when the second
  // POST arrives, so Cloudflare returns 409 Conflict and the second
  // session never starts → broken player. We defer the real setup
  // by a small timeout so the cleanup from the first run cancels
  // it before a single WHEP request is made; the second run is then
  // the only one that actually fires.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || !inView) return;

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
  }, [src, inView]);

  // Apply mute state through the library's own API AND mirror onto
  // `video.muted` via the `muted={muted}` prop binding below. The
  // library manages audio routing internally; the React prop binding
  // ensures the underlying HTMLMediaElement's `muted` property tracks
  // state across re-renders. Using a bare `muted` attribute caused
  // React to re-apply `true` on every render and silently override
  // the user's unmute click.
  useEffect(() => {
    const player = playerRef.current;
    if (player) {
      if (muted) player.mute();
      else player.unmute();
    }
  }, [muted]);

  return (
    <div
      ref={containerRef}
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
      {/* Loading spinner overlaid on the cover until media starts.
          The semi-opaque scrim improves contrast over busy cover
          art without fully hiding the brand image. We only show it
          while we actually expect media — for lazy players that
          haven't scrolled into view yet, no spinner. */}
      {!hasMedia && inView && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
          <Loader2 className="h-10 w-10 animate-spin text-white drop-shadow-lg" />
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={cn(
          "absolute inset-0 h-full w-full bg-black object-contain transition-opacity",
          hasMedia ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Sound toggle — bottom-center, same on desktop + mobile.
          Hidden in lazy/feed mode because a wall of unmuted cards
          is hostile UX; the detail page is where viewers control
          audio. stopPropagation so a click on the toggle inside a
          link-wrapped feed card (like StreamCard) doesn't also
          navigate. */}
      {hasMedia && !lazy && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setMuted((m) => !m);
          }}
          aria-label={muted ? "Unmute" : "Mute"}
          className="absolute bottom-3 left-1/2 z-10 inline-flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-black/60 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/80"
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
