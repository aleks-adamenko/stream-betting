import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Loader2, Volume2, VolumeX } from "lucide-react";

import { cn } from "@/lib/utils";

interface HlsPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
}

// Hold the cover poster + spinner on screen for at least this long so
// viewers register what they're about to watch before the video kicks
// in. If the HLS stream takes longer to start, the loading state
// naturally outlives the timer.
const MIN_POSTER_MS = 2000;

export function HlsPlayer({
  src,
  poster,
  autoPlay = true,
  muted: initialMuted = true,
  className,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(initialMuted);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Minimum-display gate for the poster — set true after MIN_POSTER_MS
  // ticks. We show the poster while EITHER the video is buffering OR
  // this gate hasn't tripped yet.
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    setMinElapsed(false);
    const t = setTimeout(() => setMinElapsed(true), MIN_POSTER_MS);
    return () => clearTimeout(t);
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setLoading(true);
    setError(null);
    let hls: Hls | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    // Live streams (Cloudflare specifically) often take 5–30 s after
    // ingest starts before the .m3u8 manifest is reachable. hls.js's
    // default behaviour on an early 404 is to log a fatal error and
    // stop trying — leaving the viewer staring at the poster forever.
    // We work around that by re-creating the hls.js instance with a
    // backoff every time it bails out, until the source either plays
    // (`playing` event fires) or the component unmounts.
    let retryDelayMs = 2000;
    const MAX_RETRY_DELAY_MS = 15_000;

    function startNativeHls() {
      // Safari path — `<video src=...>` handles HLS natively. No
      // hls.js needed. The video's own `error` event drives retry.
      video.src = src;
      video.addEventListener("error", scheduleRetry, { once: true });
    }

    function startHlsJs() {
      if (!Hls.isSupported()) {
        setError("This browser cannot play HLS streams.");
        setLoading(false);
        return;
      }
      // Light retry config on the hls.js side too — covers transient
      // segment 404s once the playlist is up but a specific .ts isn't.
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 6,
        fragLoadingMaxRetry: 6,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        // Fatal — tear down and schedule a fresh attempt. Don't show
        // the error UI; viewers don't need to know about Cloudflare's
        // warm-up window. The poster + spinner stay on screen.
        hls?.destroy();
        hls = null;
        scheduleRetry();
      });
    }

    function scheduleRetry() {
      if (destroyed) return;
      retryTimer = setTimeout(() => {
        if (destroyed) return;
        retryDelayMs = Math.min(retryDelayMs * 1.5, MAX_RETRY_DELAY_MS);
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          startNativeHls();
        } else {
          startHlsJs();
        }
        tryPlay();
      }, retryDelayMs);
    }

    function tryPlay() {
      if (!autoPlay) return;
      video.muted = initialMuted;
      void video.play().catch(() => {
        // Autoplay blocked — wait for user gesture; ignore.
      });
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      startNativeHls();
    } else {
      startHlsJs();
    }

    const onPlaying = () => setLoading(false);
    const onWaiting = () => setLoading(true);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);

    tryPlay();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      hls?.destroy();
    };
  }, [src, autoPlay, initialMuted]);

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  // Show the poster + spinner while EITHER the video is still loading
  // OR the minimum-display window hasn't elapsed yet. This gives the
  // viewer a guaranteed 2s "here's what you're about to watch" beat
  // even when HLS starts up fast.
  const showPoster = (loading || !minElapsed) && !error;

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <video
        ref={videoRef}
        playsInline
        autoPlay={autoPlay}
        muted={muted}
        loop
        disablePictureInPicture
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Poster overlay — absolutely-positioned <img> with object-cover
          so the cover fills the player container the same way the
          live video does, regardless of the poster's native aspect
          ratio. Hidden once the video has started AND the 2s minimum
          window has elapsed. */}
      {poster && showPoster && (
        <img
          src={poster}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}
      {showPoster && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
          <Loader2 className="h-8 w-8 animate-spin text-white/80" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 px-4 text-center">
          <p className="text-sm font-medium text-white/80">{error}</p>
        </div>
      )}
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute right-3 bottom-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75 sm:right-4 sm:bottom-4 sm:h-10 sm:w-10"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
