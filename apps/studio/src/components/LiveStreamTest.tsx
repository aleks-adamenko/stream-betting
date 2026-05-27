import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Coins,
  Loader2,
  MessageCircle,
  SwitchCamera,
  Users,
  Video,
} from "lucide-react";

import { Button } from "@liverush/ui";

/**
 * Tiny self-contained "does my camera work?" panel for the event editor.
 *
 * - Requests `getUserMedia` with `facingMode`. State-tracked so a phone
 *   user can flip between front + back camera via the in-frame button
 *   (bottom-right, mobile only — desktops without a back camera get
 *   nothing useful from the flip).
 * - Preview-only: nothing is uploaded or recorded.
 * - Mock overlays mirror the real LiveStream view's layout so the
 *   creator sees exactly where the LIVE badge, viewer count, title,
 *   stakes feed, and chat will land once the broadcast starts.
 * - Cleans up MediaStream tracks on stop / unmount so the camera light
 *   turns off as soon as the user is done.
 * - Container goes portrait on small viewports (matches a phone shot)
 *   and 16:9 on tablet+ (matches a webcam).
 * - Requires HTTPS in production; localhost is allowed for dev.
 */
type FacingMode = "user" | "environment";

interface LiveStreamTestProps {
  /** Title typed by the creator in the Challenge section, mirrored
   *  into the mock overlay so the preview reflects the event identity. */
  title?: string;
}

export function LiveStreamTest({ title }: LiveStreamTestProps = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<
    "idle" | "requesting" | "active" | "error" | "unsupported"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  // Only true when the device exposes ≥ 2 video inputs. Single-camera
  // devices (most desktops, plenty of phones) hide the flip button
  // entirely so we don't dangle a useless control.
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

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

  // Probe the device list for available video inputs. We call this
  //  • once at mount (handles already-granted permissions),
  //  • again after a successful getUserMedia (some platforms only
  //    surface the second camera after the user has granted access).
  const refreshCameraCount = useCallback(async () => {
    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.enumerateDevices !== "function"
      ) {
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");
      setHasMultipleCameras(videoInputs.length >= 2);
    } catch {
      // enumerateDevices can throw on very locked-down browsers —
      // treat as "single camera" and move on.
      setHasMultipleCameras(false);
    }
  }, []);

  useEffect(() => {
    void refreshCameraCount();
  }, [refreshCameraCount]);

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

  const requestStream = useCallback(
    async (which: FacingMode) => {
      setErrorMessage(null);
      setStatus("requesting");
      try {
        // Stop the previous stream first so the camera light doesn't
        // momentarily flicker between two active tracks on flip.
        stopStream();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: which,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {
            /* autoplay might be blocked — `playsinline` + `muted` on
               the element should cover it; ignore the rejection so the
               panel still flips to "active". */
          });
        }
        setStatus("active");
        // Some platforms only reveal the second camera after the
        // user has granted access. Re-enumerate now so the flip
        // button can appear on first allow.
        void refreshCameraCount();
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
    },
    [stopStream, refreshCameraCount],
  );

  const startStream = () => {
    void requestStream(facingMode);
  };

  const flipCamera = () => {
    const next: FacingMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    // Only re-request if a stream is already running; otherwise the
    // start button will pick up the new facingMode on first click.
    if (status === "active") void requestStream(next);
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

      {/* Portrait container on mobile (matches a phone-shot stream),
          16:9 from `sm` upward (matches a webcam-shot stream). */}
      <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-black/90 aspect-[9/16] sm:aspect-video">
        {/* The video element is always mounted so srcObject assignment
            works on first start without a flicker. We hide it until a
            stream is attached. We mirror only the front camera — that
            matches Zoom / Meet / TikTok and reads more naturally.
            Rear-camera output stays unmirrored, like a regular shot. */}
        <video
          ref={videoRef}
          className={
            status === "active"
              ? `h-full w-full object-cover ${facingMode === "user" ? "-scale-x-100" : ""}`
              : "hidden"
          }
          autoPlay
          playsInline
          muted
        />

        {/* Mock overlays — always rendered, so the creator can see
            the broadcast layout even before granting camera permission.
            They sit at z-10 above the video, with `pointer-events-none`
            so they never trap clicks. */}

        {/* Top-left header strip: LIVE pill + viewer count + title,
            mirroring the real LiveStream page. */}
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            Live
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
            <Users className="h-3 w-3" />
            <span className="tabular-nums">128</span>
          </span>
          <span className="hidden truncate text-xs font-medium text-white/80 sm:block">
            {title?.trim() || "Your event title"}
          </span>
        </div>

        {/* Bottom-left stakes mock — same corner as the real
            StakesOverlay. Compact because the test container is a
            fraction of the full-screen LiveStream view. Visible on
            every viewport so the preview shows the full broadcast
            layout (real LiveStream hides them below md, but that's a
            creator-facing concern; the preview is about what viewers
            will see). On mobile portrait we trim the width so the
            two side panels don't overlap in the middle. */}
        <aside
          aria-hidden
          className="pointer-events-none absolute bottom-3 left-3 z-10 flex w-[100px] flex-col gap-1.5 overflow-hidden rounded-xl border border-white/10 bg-black/55 p-2 text-white shadow-md backdrop-blur-sm sm:w-[180px]"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider sm:text-[10px]">
              <Coins className="h-3 w-3 text-[#FED448]" />
              Stakes
            </span>
            <span className="text-[9px] uppercase text-white/50">5</span>
          </div>
          <ul className="space-y-1">
            <MockStakeRow name="RushFanatic" amount="$25" />
            <MockStakeRow name="QueenBee" amount="$100" />
            <MockStakeRow name="SpeedyG" amount="$5" />
          </ul>
        </aside>

        {/* Bottom-right chat mock — same corner as the real
            ChatOverlay. */}
        <aside
          aria-hidden
          className="pointer-events-none absolute bottom-3 right-3 z-10 flex w-[100px] flex-col gap-1.5 overflow-hidden rounded-xl border border-white/10 bg-black/55 p-2 text-white shadow-md backdrop-blur-sm sm:w-[180px]"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider sm:text-[10px]">
              <MessageCircle className="h-3 w-3" />
              Chat
            </span>
            <span className="text-[9px] uppercase text-white/50">3</span>
          </div>
          <ul className="space-y-1">
            <MockChatRow name="kookaburra666" body="let's go 🔥" />
            <MockChatRow name="QueenBee" body="my money's on you" />
            <MockChatRow name="GoodVibes" body="GL!" />
          </ul>
        </aside>

        {/* Idle / requesting / error / unsupported center CTA. Rendered
            on top of the mock overlays via z-20 so the icon and copy
            stay readable. */}
        {status !== "active" && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/80">
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
              </>
            )}
          </div>
        )}

        {/* Flip camera button — top edge, horizontally centred so it
            sits between the LIVE pill/viewer count cluster on the
            left and the (empty) right corner. Mobile-first
            (md:hidden), and only meaningful while the stream is
            actually running AND the device exposes at least two video
            inputs. Desktops with one webcam hide it; phones with both
            front + back show it. z-30 so it sits above both the mock
            overlays and the idle CTA layer. */}
        {status === "active" && hasMultipleCameras && (
          <button
            type="button"
            onClick={flipCamera}
            aria-label="Flip camera"
            className="absolute left-1/2 top-3 z-30 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/75 md:hidden"
          >
            <SwitchCamera className="h-4 w-4" />
          </button>
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

// =========================================================================
// Mock overlay row components — purely visual filler. No props beyond
// the strings to render. Kept compact: this preview is much smaller
// than the real overlays, so we shrink type sizes and drop secondary
// metadata (timestamps, odds, etc.).
// =========================================================================

function MockStakeRow({ name, amount }: { name: string; amount: string }) {
  return (
    <li className="flex items-baseline justify-between gap-1 text-[10px] leading-tight">
      <span className="truncate font-semibold">{name}</span>
      <span className="flex-shrink-0 font-heading font-bold text-[#FED448] tabular-nums">
        {amount}
      </span>
    </li>
  );
}

function MockChatRow({ name, body }: { name: string; body: string }) {
  return (
    <li className="text-[10px] leading-tight">
      <span className="font-semibold">{name}</span>
      <span className="ml-1 text-white/80">{body}</span>
    </li>
  );
}
