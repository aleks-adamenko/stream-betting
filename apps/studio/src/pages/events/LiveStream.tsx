import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Camera,
  CameraOff,
  Coins,
  Loader2,
  MessageCircle,
  PhoneOff,
  Radio,
  Users,
} from "lucide-react";

import { Button } from "@liverush/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useEventChat, type ChatMessage } from "@/hooks/useEventChat";
import { useEventViewers } from "@/hooks/useEventViewers";
import { supabase } from "@/integrations/supabase/client";

/**
 * Full-screen "live" view for the creator. Lives outside StudioLayout
 * so the camera takes the whole viewport.
 *
 * Lifecycle:
 *  1. Mount → load the event row to know its current status.
 *  2. Status must be `scheduled` (and scheduled_at <= now) OR `live`
 *     for the creator to be here. Anything else → boot back to /events.
 *  3. User clicks "Start camera" → getUserMedia. On success we fire
 *     start_event if the row is still scheduled. Status flips to live;
 *     user-app picks it up on its next refetch.
 *  4. End stream → finish_event RPC flips status to finished, we stop
 *     all media tracks, navigate back to /events.
 */
export default function LiveStream() {
  const { id: eventId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { creator } = useAuth();
  const queryClient = useQueryClient();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "requesting" | "live" | "ending" | "error" | "unsupported"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Real-time viewer count from the shared `event:{id}:viewers`
  // presence channel. `track: false` so the creator doesn't count
  // themselves as a viewer.
  const viewerCount = useEventViewers(eventId, { track: false });

  // Bail out if the browser doesn't expose getUserMedia (insecure
  // context / very old browser).
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setPhase("unsupported");
    }
  }, []);

  // Pull the event row so we know if we should be here at all.
  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ["studio", "event", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, status, scheduled_at, creator_id, started_at")
        .eq("id", eventId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Redirect away if the event isn't in a streamable state, or doesn't
  // belong to this creator. Allow status === 'live' so the creator can
  // resume after a refresh.
  useEffect(() => {
    if (!event) return;
    if (creator && event.creator_id !== creator.id) {
      navigate("/events", { replace: true });
      return;
    }
    if (event.status !== "scheduled" && event.status !== "live") {
      toast.error("This event isn't ready to stream");
      navigate(`/events/${event.id}`, { replace: true });
      return;
    }
    if (
      event.status === "scheduled" &&
      new Date(event.scheduled_at).getTime() > Date.now()
    ) {
      toast.error("Event hasn't started yet — come back at start time.");
      navigate(`/events/${event.id}`, { replace: true });
    }
  }, [event, creator, navigate]);

  // Pre-set phase to "live" if we land here on an already-live event
  // (e.g. after a page refresh while streaming) — the camera still
  // needs to be re-acquired manually since browsers don't persist
  // getUserMedia handles.
  useEffect(() => {
    if (event?.status === "live" && phase === "idle") {
      // Stay on `idle` so the user has to click Start camera again,
      // but show a softer "resume" call-to-action via the copy.
    }
  }, [event, phase]);

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

  // Always release the camera when this page unmounts so we don't
  // leave the indicator light on after the creator navigates away.
  useEffect(() => () => stopStream(), [stopStream]);

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error("Missing event id");
      const { error } = await supabase.rpc("start_event", {
        p_event_id: eventId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["studio", "events", creator?.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["studio", "event", eventId],
      });
    },
  });

  const finishMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error("Missing event id");
      const { error } = await supabase.rpc("finish_event", {
        p_event_id: eventId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["studio", "events", creator?.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["studio", "event", eventId],
      });
    },
  });

  const handleStart = async () => {
    setErrorMessage(null);
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {
          // playsinline + muted should cover autoplay restrictions;
          // ignore the rejection so the page still flips to "live".
        });
      }

      // Only flip the DB status if it isn't already 'live'. Resuming
      // after a refresh keeps the same row state.
      if (event?.status === "scheduled") {
        await startMutation.mutateAsync();
      }
      setPhase("live");
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const message =
        name === "NotAllowedError"
          ? "Camera permission denied. Allow access in your browser and try again."
          : name === "NotFoundError"
            ? "No camera found on this device."
            : name === "NotReadableError"
              ? "Your camera is already in use by another app."
              : err instanceof Error
                ? err.message
                : "Couldn't start the stream.";
      setErrorMessage(message);
      setPhase("error");
    }
  };

  const handleEnd = async () => {
    if (
      !confirm(
        "End the stream now? This marks the event as finished and stops accepting bets.",
      )
    ) {
      return;
    }
    setPhase("ending");
    try {
      await finishMutation.mutateAsync();
      stopStream();
      toast.success("Stream ended");
      navigate("/events", { replace: true });
    } catch (err) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't end the stream";
      toast.error(message);
      // Camera stays running; we don't force-kill it on a failed
      // finish_event because the row may still be live.
      setPhase("live");
    }
  };

  // ----- Render --------------------------------------------------------

  if (eventLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-black text-white">
        <Loader2 className="h-8 w-8 animate-spin opacity-60" />
      </div>
    );
  }

  const resumeAfterRefresh = event?.status === "live" && phase === "idle";

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-black text-white">
      {/* Video — always mounted so srcObject can attach on first
          start without a flicker. Hidden until a stream is live. */}
      <video
        ref={videoRef}
        className={
          phase === "live"
            ? "absolute inset-0 h-full w-full -scale-x-100 object-cover"
            : "hidden"
        }
        autoPlay
        playsInline
        muted
      />

      {/* Top bar — End stream button only visible once we're live. */}
      <header className="relative z-20 flex items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          {phase === "live" && (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 text-xs font-bold uppercase tracking-wider">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                Live
              </span>
              {/* Real-time viewer count from the presence channel —
                  updates instantly as viewers join / leave the event
                  page in the user-app. */}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
                <Users className="h-3.5 w-3.5" />
                <span className="tabular-nums">{viewerCount}</span>
              </span>
            </>
          )}
          <p className="hidden text-sm font-medium opacity-80 sm:block">
            {event?.title}
          </p>
        </div>
        {phase === "live" || phase === "ending" ? (
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={handleEnd}
            disabled={phase === "ending"}
            className="bg-destructive text-white [background:none] hover:bg-destructive/90"
          >
            {phase === "ending" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <PhoneOff className="h-4 w-4" />
                End stream
              </>
            )}
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => navigate(`/events/${eventId}`)}
            className="text-sm font-medium text-white/70 hover:text-white"
          >
            Back to event
          </button>
        )}
      </header>

      {/* Pre-stream / error overlay */}
      {phase !== "live" && (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          {phase === "unsupported" ? (
            <>
              <CameraOff className="h-12 w-12 text-white/60" />
              <h1 className="mt-4 font-heading text-xl font-bold">
                Camera not available
              </h1>
              <p className="mt-2 max-w-md text-sm text-white/70">
                Your browser doesn't support live camera access. Try a
                recent version of Chrome, Safari, or Firefox over HTTPS.
              </p>
            </>
          ) : phase === "error" ? (
            <>
              <CameraOff className="h-12 w-12 text-red-300" />
              <h1 className="mt-4 font-heading text-xl font-bold">
                Can't start the camera
              </h1>
              <p className="mt-2 max-w-md text-sm text-red-200">
                {errorMessage}
              </p>
              <Button
                type="button"
                variant="accent"
                size="lg"
                className="mt-6"
                onClick={handleStart}
              >
                <Camera className="h-4 w-4" />
                Try again
              </Button>
            </>
          ) : phase === "requesting" ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-white/70" />
              <p className="mt-4 text-sm font-medium opacity-80">
                Waiting for camera permission…
              </p>
            </>
          ) : (
            <>
              <Radio className="h-12 w-12 text-white/80" />
              <h1 className="mt-4 font-heading text-2xl font-bold sm:text-3xl">
                {resumeAfterRefresh
                  ? "Resume your live stream"
                  : "Ready to go live"}
              </h1>
              <p className="mt-3 max-w-md text-sm text-white/70">
                {resumeAfterRefresh
                  ? "Your event is already live. Grant camera access again to keep streaming."
                  : "Starting your camera will mark this event as live in the LiveRush feed."}
              </p>
              <Button
                type="button"
                variant="accent"
                size="lg"
                className="mt-6"
                onClick={handleStart}
              >
                <Camera className="h-4 w-4" />
                {resumeAfterRefresh ? "Resume camera" : "Start camera"}
              </Button>
              <p className="mt-3 text-xs text-white/50">
                We'll ask your browser for camera + microphone access.
              </p>
            </>
          )}
        </div>
      )}

      {/* Side overlays — only while live. Each panel is absolutely
          positioned over the video with a semi-transparent dark bg so
          the camera stays visible behind. Both hidden below `md` so
          phones get the unobstructed video; tablet+ shows both. */}
      {phase === "live" && (
        <>
          <StakesOverlay />
          <ChatOverlay eventId={eventId} />
        </>
      )}

      {/* Bottom info bar was removed — the Stakes / Chat overlays now
          extend to the same `bottom-3` inset as the side margins, and
          the "Live" badge + End-stream button in the header already
          carry the duplicate info. */}
    </div>
  );
}

// =========================================================================
// Overlays — placeholder UI only.
//
// These render mock stakes and chat data so the layout can be reviewed
// while the camera is up. Real-time wiring will replace MOCK_* with
// Supabase Realtime subscriptions (presence channel for viewer count,
// `bets` table inserts for the stakes feed, a new `event_chat` table
// for the chat) in a follow-up pass.
// =========================================================================

type StakeRow = {
  id: string;
  name: string;
  amountCents: number;
  outcomeLabel: string;
  placedAt: Date;
};

const MOCK_STAKES: StakeRow[] = [
  {
    id: "s1",
    name: "RushFanatic",
    amountCents: 2500,
    outcomeLabel: "Pops all 10",
    placedAt: new Date(Date.now() - 1000 * 12),
  },
  {
    id: "s2",
    name: "QueenBee",
    amountCents: 10000,
    outcomeLabel: "Fails the run",
    placedAt: new Date(Date.now() - 1000 * 35),
  },
  {
    id: "s3",
    name: "SpeedyG",
    amountCents: 500,
    outcomeLabel: "Pops all 10",
    placedAt: new Date(Date.now() - 1000 * 60 * 2),
  },
  {
    id: "s4",
    name: "kookaburra666",
    amountCents: 3500,
    outcomeLabel: "Fails the run",
    placedAt: new Date(Date.now() - 1000 * 60 * 4),
  },
  {
    id: "s5",
    name: "GoodVibesOnly",
    amountCents: 1500,
    outcomeLabel: "Pops all 10",
    placedAt: new Date(Date.now() - 1000 * 60 * 6),
  },
];

/** Compact relative-time helper for chat / stake timestamps. */
function relativeTimeShort(d: Date): string {
  const diff = Math.max(0, Date.now() - d.getTime());
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function StakesOverlay() {
  return (
    <aside
      aria-label="Live stakes feed"
      className="pointer-events-auto absolute bottom-3 left-3 z-10 hidden h-[280px] w-[300px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/55 text-white shadow-xl backdrop-blur-md md:flex"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-[#FED448]" />
          <h2 className="font-heading text-xs font-bold uppercase tracking-wider">
            Live stakes
          </h2>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">
          {MOCK_STAKES.length}
        </span>
      </div>
      <ul className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {MOCK_STAKES.map((s) => (
          <li
            key={s.id}
            className="rounded-lg border border-white/5 bg-white/[0.04] px-2.5 py-2 text-xs"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold text-white">
                {s.name}
              </span>
              <span className="flex-shrink-0 text-[10px] text-white/50">
                {relativeTimeShort(s.placedAt)} ago
              </span>
            </div>
            <p className="mt-1 truncate text-white/80">
              <span className="text-white/60">on</span> {s.outcomeLabel}
            </p>
            <p className="mt-0.5 font-heading text-sm font-bold text-[#FED448] tabular-nums">
              {formatCents(s.amountCents)}
            </p>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ChatOverlay({ eventId }: { eventId: string | undefined }) {
  const messages = useEventChat(eventId);
  const listRef = useRef<HTMLUListElement>(null);

  // Auto-scroll to the latest message when a new one arrives.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <aside
      aria-label="Live chat"
      className="pointer-events-auto absolute bottom-3 right-3 z-10 hidden h-[280px] w-[300px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/55 text-white shadow-xl backdrop-blur-md md:flex"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-white" />
          <h2 className="font-heading text-xs font-bold uppercase tracking-wider">
            Live chat
          </h2>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">
          {messages.length}
        </span>
      </div>
      <ul
        ref={listRef}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {messages.length === 0 && (
          <li className="text-center text-[11px] text-white/50">
            No chat yet — viewers will appear here as they post.
          </li>
        )}
        {messages.map((m: ChatMessage) => (
          <li key={m.id} className="text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold text-white">
                {m.display_name ?? "Viewer"}
              </span>
              <span className="flex-shrink-0 text-[10px] text-white/50">
                {relativeTimeShort(new Date(m.created_at))} ago
              </span>
            </div>
            <p className="mt-0.5 leading-snug text-white/85">{m.body}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
