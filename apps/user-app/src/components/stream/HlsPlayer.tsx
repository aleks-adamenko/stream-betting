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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setLoading(true);
    setError(null);
    let hls: Hls | null = null;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError("Stream is unavailable. Trying again…");
      });
    } else {
      setError("This browser cannot play HLS streams.");
      setLoading(false);
      return;
    }

    const onPlaying = () => setLoading(false);
    const onWaiting = () => setLoading(true);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);

    if (autoPlay) {
      video.muted = initialMuted;
      void video.play().catch(() => {
        // Autoplay was blocked — fine, user can tap to start.
      });
    }

    return () => {
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

  return (
    <div className={cn("relative h-full w-full", className)}>
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        autoPlay={autoPlay}
        muted={muted}
        loop
        disablePictureInPicture
        className="h-full w-full object-cover"
      />
      {loading && !error && (
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
