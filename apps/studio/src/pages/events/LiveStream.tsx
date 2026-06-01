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
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Trophy,
  Users,
  Video,
  VideoOff,
} from "lucide-react";

import {
  BettingCountdown,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@liverush/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useEventChat, type ChatMessage } from "@/hooks/useEventChat";
import { useEventViewers } from "@/hooks/useEventViewers";
import { supabase } from "@/integrations/supabase/client";
import { WhipPublisher } from "@/lib/whip";

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
  // WHIP publisher — created on first start, reused for orientation
  // changes (replaceVideoTrack), released on stop / unmount.
  const publisherRef = useRef<WhipPublisher | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "requesting" | "live" | "ending" | "error" | "unsupported"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Local on/off toggles for the creator's own video + audio while
  // they're broadcasting. We flip `track.enabled` on the underlying
  // MediaStream tracks — that keeps the WebRTC peer connection open
  // (no re-negotiation) but tells the browser to send black frames /
  // silence respectively. Cloudflare keeps the stream alive; viewers
  // see a dark frame / hear silence until the creator re-enables.
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);

  // Declare-winner modal — opens after betting_closes_at. Stores the
  // outcome ids the creator has checked; supports multi-select for
  // dead heat scenarios.
  const [declareOpen, setDeclareOpen] = useState(false);
  const [selectedWinners, setSelectedWinners] = useState<Set<string>>(
    new Set(),
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // 5-second tick is plenty for cutoff math — the visual flip from
    // "End stream" → "Declare winner" doesn't need second-precision.
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

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
        .select(
          `id, title, status, scheduled_at, creator_id, started_at,
           betting_opens_at, betting_closes_at, winning_outcome_ids,
           outcomes:event_outcomes!event_outcomes_event_id_fkey ( id, label, sort_order )`,
        )
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
    // If the creator just clicked End stream, finishMutation flips
    // status to 'finished' and our own handleEnd is already navigating
    // away. Skip the validator so it doesn't surface a false-positive
    // "isn't ready to stream" toast in the brief overlap window.
    if (phase === "ending") return;
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
  }, [event, creator, navigate, phase]);

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

  const stopStream = useCallback(async () => {
    // Tear down the WHIP publisher first — it stops the local tracks
    // and DELETEs the WHIP resource on Mux so the ingest session ends
    // cleanly. Local stream + video element clear out below as a
    // belt-and-braces fallback.
    if (publisherRef.current) {
      try {
        await publisherRef.current.stop();
      } catch {
        // best-effort
      }
      publisherRef.current = null;
    }
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
  useEffect(() => {
    return () => {
      void stopStream();
    };
  }, [stopStream]);

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
      // Go through the end-stream Edge Function so Mux's live stream
      // gets torn down (DELETE on liveStreams) and the event_streams
      // row is cleaned up. The function calls finish_event internally
      // to flip status. Service-role can't, because finish_event reads
      // auth.uid().
      const { error } = await supabase.functions.invoke("end-stream", {
        body: { event_id: eventId },
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

  // declare_winner: flips status live → pending_moderation and stamps
  // winning_outcome_ids. A LiveRush moderator then runs settle_event
  // from the SQL Editor (Phase 1 MVP — no admin UI yet).
  const declareWinnerMutation = useMutation({
    mutationFn: async (outcomeIds: string[]) => {
      if (!eventId) throw new Error("Missing event id");
      const { error } = await supabase.rpc("declare_winner", {
        p_event_id: eventId,
        p_winning_outcome_ids: outcomeIds,
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
      if (!eventId) throw new Error("Missing event id");

      // 1) Fetch the Cloudflare WHIP URL. The studio user MUST be the
      //    creator of the event for the RPC to return anything (RLS).
      //    Cloudflare's WHIP URL contains the publish secret in the
      //    path, so it's the only credential we need.
      const { data: credRows, error: credErr } = await supabase.rpc(
        "get_stream_credentials",
        { p_event_id: eventId },
      );
      if (credErr) throw credErr;
      const creds = Array.isArray(credRows) ? credRows[0] : credRows;
      if (!creds?.whip_url) {
        throw new Error(
          "No stream credentials found for this event. Try unpublishing and re-publishing the draft.",
        );
      }

      // 2) Decide camera orientation based on the device. Mobile in
      //    portrait → 720x1280 (9:16); rotated landscape OR desktop →
      //    1280x720 (16:9). Mux ingests whatever native aspect we
      //    send and LL-HLS preserves it for viewers.
      const isMobile = window.matchMedia(
        "(max-width: 767px), (pointer: coarse)",
      ).matches;
      const portrait = window.matchMedia("(orientation: portrait)").matches;
      const wantsPortrait = isMobile && portrait;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: wantsPortrait ? 720 : 1280 },
          height: { ideal: wantsPortrait ? 1280 : 720 },
        },
        // Standard audio constraints. iOS Safari especially benefits
        // from being explicit here — bare `audio: true` sometimes
        // ships audio with surprising defaults (raw mic, no AGC) that
        // WHIP servers downstream don't like, resulting in silent
        // playback on the viewer. echoCancellation / noiseSuppression
        // / autoGainControl are widely supported and the documented
        // iOS-friendly path.
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // 3) Attach to the local preview so the creator sees what's
      //    being broadcast. object-contain on the <video> element
      //    means we never lie about the framing (vs. cover, which
      //    would crop edges out of the viewer-side view).
      //
      //    The local preview gets a VIDEO-ONLY clone of the
      //    MediaStream — not the full stream that's about to be
      //    handed to the WHIP publisher. Sharing the audio track
      //    between a <video> element (even one with `muted` set)
      //    and the WebRTC sender has historically caused Chrome's
      //    audio encoder to emit zero packets, which Cloudflare's
      //    WHIP ingest treats as a broken session and tears down
      //    after ~30 s. Isolating the audio track to a single
      //    consumer (the publisher) sidesteps that.
      const previewStream = new MediaStream(stream.getVideoTracks());
      if (videoRef.current) {
        videoRef.current.srcObject = previewStream;
        await videoRef.current.play().catch(() => {
          // playsinline + muted cover autoplay restrictions; ignore.
        });
      }

      // 4) Hand the stream off to the WHIP publisher. WhipPublisher
      //    handles ICE / SDP / codec preferences / DELETE on stop.
      const publisher = new WhipPublisher({
        onStatusChange: (status) => {
          if (status === "failed") {
            setErrorMessage("Lost connection to the stream. Try again.");
            setPhase("error");
          }
        },
        onError: (err) => {
          console.error("WHIP publisher error:", err);
        },
      });
      publisherRef.current = publisher;
      await publisher.start(stream, creds.whip_url);

      // 5) Flip DB status to 'live' (or no-op if already live after a
      //    refresh).
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
      // If we failed mid-setup, release whatever we acquired.
      void stopStream();
    }
  };

  // Orientation change handler — when the creator rotates their phone
  // mid-stream we re-grab the camera at the new dims and hot-swap the
  // track on the WHIP sender. Viewers see the new aspect on the next
  // HLS segment (~2s).
  useEffect(() => {
    if (phase !== "live") return;
    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    if (!isMobile) return;
    const orientation = window.screen?.orientation;
    if (!orientation) return;

    const handler = async () => {
      const portrait = window.matchMedia("(orientation: portrait)").matches;
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: portrait ? 720 : 1280 },
            height: { ideal: portrait ? 1280 : 720 },
          },
          // Same iOS-friendly audio constraints used on initial start.
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        const newAudioTrack = newStream.getAudioTracks()[0];
        const publisher = publisherRef.current;
        if (!publisher) return;

        // Re-apply the creator's current on/off toggle state to the
        // fresh tracks BEFORE handing them to the publisher. Without
        // this, rotation silently turns the camera/mic back on for
        // a creator who'd toggled them off, while the UI icons stay
        // showing the off state.
        if (newVideoTrack) newVideoTrack.enabled = videoEnabled;
        if (newAudioTrack) newAudioTrack.enabled = audioEnabled;

        // Replace BOTH senders. The old code only swapped video, so
        // after rotation the publisher kept pointing at the now-
        // stopped old audio track and viewers went silent. Audio is
        // critical enough to a stream that this can't be best-effort
        // — we want it as robust as video swapping.
        if (newVideoTrack) await publisher.replaceVideoTrack(newVideoTrack);
        if (newAudioTrack) await publisher.replaceAudioTrack(newAudioTrack);

        // Swap the local preview's MediaStream and stop the old one
        // so the camera light reflects only the active track set.
        const oldStream = streamRef.current;
        streamRef.current = newStream;
        if (videoRef.current) videoRef.current.srcObject = newStream;
        if (oldStream) {
          for (const t of oldStream.getTracks()) t.stop();
        }
      } catch (err) {
        console.warn("Orientation change re-capture failed", err);
      }
    };

    orientation.addEventListener("change", handler);
    return () => orientation.removeEventListener("change", handler);
    // videoEnabled + audioEnabled are intentionally in the dep array:
    // if the creator toggles a track off and THEN rotates, the
    // handler captured at registration time should observe the
    // updated state. Re-registering on each toggle change is cheap.
  }, [phase, videoEnabled, audioEnabled]);

  // Camera + mic in-broadcast toggles. We flip `track.enabled` rather
  // than stop/start the track so the WebRTC connection to Cloudflare
  // stays up — no codec re-negotiation, no viewer dropout. Disabled
  // video tracks send black frames; disabled audio tracks send
  // silence. The creator can flip them back on instantly.
  const toggleVideo = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !videoEnabled;
    for (const track of stream.getVideoTracks()) {
      track.enabled = next;
    }
    setVideoEnabled(next);
  }, [videoEnabled]);

  const toggleAudio = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !audioEnabled;
    for (const track of stream.getAudioTracks()) {
      track.enabled = next;
    }
    setAudioEnabled(next);
  }, [audioEnabled]);

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
      await stopStream();
      toast.success("Stream ended");
      navigate("/events", { replace: true }); // landing back on the list, not the editor
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

  // Cutoff math: betting_closes_at is stamped by start_event. Once
  // it's in the past, the "End stream" CTA in the top bar swaps for
  // a "Declare winner" CTA that opens the outcomes modal.
  const bettingClosesAt = event?.betting_closes_at
    ? new Date(event.betting_closes_at).getTime()
    : null;
  const bettingClosed =
    !!bettingClosesAt && now >= bettingClosesAt;
  const outcomes = (event?.outcomes ?? [])
    .slice()
    .sort(
      (a: { sort_order: number }, b: { sort_order: number }) =>
        a.sort_order - b.sort_order,
    ) as Array<{ id: string; label: string; sort_order: number }>;

  const handleDeclareSubmit = async () => {
    if (selectedWinners.size === 0) {
      toast.error("Pick at least one winning outcome");
      return;
    }
    try {
      await declareWinnerMutation.mutateAsync(Array.from(selectedWinners));
      await stopStream();
      toast.success("Stream ended — awaiting platform settlement");
      setDeclareOpen(false);
      navigate("/events", { replace: true });
    } catch (err) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't declare winner";
      toast.error(message);
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
      {/* object-contain (not cover) on purpose: the creator sees the
          full broadcast frame including any letterboxing, instead of a
          crop that hides what viewers will actually see. */}
      <video
        ref={videoRef}
        className={
          phase === "live"
            ? "absolute inset-0 h-full w-full -scale-x-100 object-contain"
            : "hidden"
        }
        autoPlay
        playsInline
        muted
      />

      {/* Top bar — End stream button only visible once we're live. */}
      <header className="relative z-20 flex items-start justify-between px-4 py-4 sm:px-6">
        <div className="flex flex-col items-start gap-2">
          {/* Top row: Live + viewers + title chip. */}
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
          {/* Absolute betting countdown — same value all viewers see
              in the user-app overlay. Gated on event.status === 'live'
              rather than the local `phase` so a refresh-and-resume
              cycle (status='live', phase momentarily 'idle' until
              Resume camera fires) doesn't hide the timer the streamer
              still needs to see. */}
          {event?.status === "live" && event?.betting_closes_at && (
            <BettingCountdown
              closesAt={event.betting_closes_at}
              variant="compact"
            />
          )}
        </div>
        {phase === "live" || phase === "ending" ? (
          // Single "End stream" button always. Click → open the
          // declare-winner modal. Inside, we either show the outcome
          // selector (if betting window has closed) or a "still
          // accepting bets, cancel will refund everyone" notice
          // (if the streamer is bailing early).
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={() => setDeclareOpen(true)}
            disabled={phase === "ending" || declareWinnerMutation.isPending}
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

      {/* In-broadcast controls — bottom-center, horizontally centred
          between the Stakes (left) and Chat (right) overlays. Two
          icon buttons let the creator pause their own video or mute
          their mic without dropping the broadcast. The stream stays
          connected; viewers see a dark frame / hear silence until the
          creator toggles back on. */}
      {phase === "live" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/55 px-3 py-2 backdrop-blur-md">
            <button
              type="button"
              onClick={toggleVideo}
              aria-label={videoEnabled ? "Turn camera off" : "Turn camera on"}
              title={videoEnabled ? "Turn camera off" : "Turn camera on"}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                videoEnabled
                  ? "bg-white/10 text-white hover:bg-white/20"
                  : "bg-destructive text-white hover:bg-destructive/90"
              }`}
            >
              {videoEnabled ? (
                <Video className="h-5 w-5" />
              ) : (
                <VideoOff className="h-5 w-5" />
              )}
            </button>
            <button
              type="button"
              onClick={toggleAudio}
              aria-label={audioEnabled ? "Mute microphone" : "Unmute microphone"}
              title={audioEnabled ? "Mute microphone" : "Unmute microphone"}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                audioEnabled
                  ? "bg-white/10 text-white hover:bg-white/20"
                  : "bg-destructive text-white hover:bg-destructive/90"
              }`}
            >
              {audioEnabled ? (
                <Mic className="h-5 w-5" />
              ) : (
                <MicOff className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* End-stream modal — single entry point regardless of whether
          the betting window has closed. Post-cutoff: pick winning
          outcome(s) → declare_winner flips status → pending_moderation.
          Pre-cutoff: only allow a hard end (no declaration possible
          yet) via finish_event. */}
      <Dialog open={declareOpen} onOpenChange={setDeclareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bettingClosed ? "End stream & declare winner" : "End stream"}
            </DialogTitle>
            <DialogDescription>
              {bettingClosed
                ? "Pick the outcome(s) that won. Multi-select supports dead heats. Once submitted, the event flips to Pending settlement and a LiveRush moderator releases payouts."
                : "The betting window is still open. Ending now closes the stream — you'll be able to come back and declare a winner once the cutoff passes."}
            </DialogDescription>
          </DialogHeader>
          {bettingClosed && (
            <ul className="space-y-2 py-2">
              {outcomes.map((o) => {
                const active = selectedWinners.has(o.id);
                return (
                  <li key={o.id}>
                    <label
                      className={
                        "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors " +
                        (active
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:bg-secondary/30")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => {
                          setSelectedWinners((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(o.id);
                            else next.delete(o.id);
                            return next;
                          });
                        }}
                        className="h-4 w-4"
                      />
                      <span className="text-sm font-medium">{o.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeclareOpen(false)}
              disabled={declareWinnerMutation.isPending || phase === "ending"}
            >
              Cancel
            </Button>
            {bettingClosed ? (
              <Button
                type="button"
                onClick={handleDeclareSubmit}
                disabled={
                  declareWinnerMutation.isPending || selectedWinners.size === 0
                }
              >
                {declareWinnerMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Trophy className="h-4 w-4" />
                    End & submit results
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={async () => {
                  setDeclareOpen(false);
                  await handleEnd();
                }}
                disabled={phase === "ending"}
                className="bg-destructive text-white [background:none] hover:bg-destructive/90"
              >
                <PhoneOff className="h-4 w-4" />
                End stream
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
