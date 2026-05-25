import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2, Video } from "lucide-react";

import { Button } from "@liverush/ui";

/**
 * Tiny self-contained "does my camera work?" panel for the event editor.
 *
 * - Requests the user's front camera via getUserMedia (`facingMode: "user"`
 *   so phones default to the selfie cam, desktops use the built-in webcam).
 * - Stream is preview-only — no recording, no upload. We make that
 *   explicit in the helper copy so creators don't worry about it.
 * - Cleans up the MediaStream tracks on stop / unmount so the camera
 *   light turns off as soon as the user is done.
 * - Requires HTTPS in production; localhost is allowed for dev.
 */
export function LiveStreamTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<
    "idle" | "requesting" | "active" | "error" | "unsupported"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Bail early if the browser doesn't expose getUserMedia at all
  // (very old browsers or insecure contexts).
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setStatus("unsupported");
    }
  }, []);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Make sure we release the camera if the editor unmounts.
  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  const startStream = async () => {
    setErrorMessage(null);
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Safari iOS needs an explicit play() after srcObject is set.
        await videoRef.current.play().catch(() => {
          /* autoplay might be blocked — the video tag's `playsinline` +
             `muted` attributes should cover it, but ignore the rejection
             so the panel still flips to "active". */
        });
      }
      setStatus("active");
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const message =
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow access in your browser and try again."
          : name === "NotFoundError"
            ? "No camera was found on this device."
            : name === "NotReadableError"
              ? "Your camera is already in use by another app."
              : err instanceof Error
                ? err.message
                : "Couldn't start the camera.";
      setErrorMessage(message);
      setStatus("error");
    }
  };

  const handleStop = () => {
    stopStream();
    setStatus("idle");
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold">Test live stream</label>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Video className="h-3.5 w-3.5" />
          Preview only — nothing is recorded
        </span>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-black/90 aspect-video">
        {/* The video element is always mounted so srcObject assignment
            works on first start without a flicker. We hide it until a
            stream is attached. Mirroring (scaleX(-1)) makes the selfie
            view feel natural — same as Zoom / Meet / TikTok. */}
        <video
          ref={videoRef}
          className={
            status === "active"
              ? "h-full w-full -scale-x-100 object-cover"
              : "hidden"
          }
          autoPlay
          playsInline
          muted
        />

        {status !== "active" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/80">
            {status === "requesting" ? (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-white/70" />
                <p className="text-sm font-medium">
                  Waiting for camera permission…
                </p>
              </>
            ) : status === "unsupported" ? (
              <>
                <CameraOff className="h-7 w-7 text-white/60" />
                <p className="text-sm font-medium">
                  Your browser doesn't support camera access. Try a recent
                  version of Chrome, Safari, or Firefox.
                </p>
              </>
            ) : status === "error" ? (
              <>
                <CameraOff className="h-7 w-7 text-red-300" />
                <p className="text-sm font-medium text-red-200">
                  {errorMessage}
                </p>
              </>
            ) : (
              <>
                <Camera className="h-7 w-7 text-white/70" />
                <p className="text-sm font-medium">
                  Check your camera before going live.
                </p>
                <p className="text-xs text-white/60">
                  Works on phone (front camera) and desktop (webcam).
                </p>
              </>
            )}
          </div>
        )}

        {status === "active" && (
          <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Live preview
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {status !== "active" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={startStream}
            disabled={status === "requesting" || status === "unsupported"}
          >
            <Camera className="h-4 w-4" />
            {status === "error" ? "Try again" : "Start camera"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleStop}
          >
            <CameraOff className="h-4 w-4" />
            Stop camera
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          We'll ask your browser for camera permission. Real live streaming
          comes in a later phase.
        </p>
      </div>
    </section>
  );
}
