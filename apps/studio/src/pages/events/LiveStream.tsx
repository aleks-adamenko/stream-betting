import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@liverush/lib";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Circle,
  Loader2,
  ListChecks,
  MessageCircle,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  SwitchCamera,
  Trophy,
  Users,
  Video,
  VideoOff,
} from "lucide-react";

import {
  BettingCountdown,
  Button,
  CoinIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@liverush/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useEventChat, type ChatMessage } from "@/hooks/useEventChat";
import {
  useEventProgress,
  type EventProgress,
} from "@/hooks/useEventProgress";
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
  // Front / rear camera selector. Default to "user" (selfie cam) —
  // matches existing behaviour. The flip button at the bottom of
  // the live view lets the streamer switch between the two without
  // tearing down the WHIP session: we getUserMedia with the opposite
  // facingMode, then hot-swap the video track on the publisher via
  // replaceVideoTrack. Audio + the on/off toggle state carry across
  // the swap untouched.
  const [facingMode, setFacingMode] = useState<"user" | "environment">(
    "user",
  );
  // Only true on devices that expose >= 2 video inputs (typical
  // mobile, rare on desktop). Hides the flip button entirely when
  // there's nothing to flip to.
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  // Guards against double-tap during the async re-acquire + replace
  // dance — the flip button disables itself until the swap settles.
  const [flippingCamera, setFlippingCamera] = useState(false);

  // Declare-winner / end-stream modal — opens from the toolbar. Stores
  // the outcome ids the creator has checked (multi-select supports dead
  // heats). `declareIntent` decides what runs after the modal confirms:
  //   - "end": End stream. When the current round is settle-able
  //     (window closed + minimums met) the modal prompts for a winner,
  //     then settles + finishes (multi → finish_event settles the
  //     current round; single → declare flips to pending_moderation).
  //     When it's NOT settle-able (window open OR minimums unmet) the
  //     modal explains the refund and finish_event refunds instead.
  //   - "next":  declare winner → advance_round       (multi, minimums met)
  //   - "final": declare winner → mark_final_round     (multi, minimums met)
  //   - "next-refund":  no winner → advance_round      (multi, minimums unmet)
  //   - "final-refund": no winner → mark_final_round   (multi, minimums unmet)
  // The "*-refund" intents skip declare_winner — settle_round inside
  // advance_round / mark_final_round auto-refunds an under-minimum round.
  type DeclareIntent =
    | "end"
    | "next"
    | "final"
    | "next-refund"
    | "final-refund";
  const [declareOpen, setDeclareOpen] = useState(false);
  const [declareIntent, setDeclareIntent] = useState<DeclareIntent>("end");
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

  // Probe the device list for available video inputs so we can
  // decide whether to show the flip-camera button. Some platforms
  // only surface the second camera AFTER getUserMedia permission has
  // been granted, so we also re-probe after the first successful
  // `handleStart` (below) to catch that case.
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
      // Locked-down browsers can throw on enumerateDevices — treat
      // as single-camera and hide the flip button.
      setHasMultipleCameras(false);
    }
  }, []);

  useEffect(() => {
    void refreshCameraCount();
  }, [refreshCameraCount]);

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
           round_format, current_round, is_final_round,
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

  // declare_winner: stamps winning_outcome_ids on the event. For
  // single-round events this also flips status → pending_moderation.
  // For multi-round events the status stays 'live' and the caller
  // immediately follows up with advance_round or mark_final_round.
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

  // advance_round / mark_final_round: multi-round only. Both settle
  // the current round (calling settle_round → payouts to winners,
  // rake to streamer + platform, ledger entries) and either bump to
  // the next round (advance) or mark this round as final (final).
  const advanceRoundMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error("Missing event id");
      // `as never` because the new RPCs aren't reflected in the
      // generated types yet — operator regenerates after migration.
      const { error } = await supabase.rpc("advance_round" as never, {
        p_event_id: eventId,
        p_idempotency_key: crypto.randomUUID(),
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["studio", "event", eventId],
      });
    },
  });

  const markFinalRoundMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error("Missing event id");
      const { error } = await supabase.rpc("mark_final_round" as never, {
        p_event_id: eventId,
        p_idempotency_key: crypto.randomUUID(),
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
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
          facingMode,
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
      // Some platforms (notably iOS Safari) only surface the second
      // video input after the user has granted camera permission.
      // Re-probe now so the flip-camera button appears the moment
      // it's actually usable.
      void refreshCameraCount();
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
            // Keep whichever camera the streamer is currently using —
            // a rotation shouldn't snap the rear camera back to the
            // selfie cam.
            facingMode,
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
    // videoEnabled + audioEnabled + facingMode are intentionally in
    // the dep array: if the creator toggles a track off, flips the
    // camera, and THEN rotates, the handler captured at registration
    // time should observe the updated state. Re-registering on each
    // change is cheap.
  }, [phase, videoEnabled, audioEnabled, facingMode]);

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

  // Mid-broadcast camera flip — same mechanic as the orientation
  // handler: re-acquire getUserMedia with the opposite facingMode,
  // re-apply the streamer's current on/off toggle state to the
  // fresh tracks BEFORE handing them to the publisher (otherwise
  // a flip would silently turn the camera back on for a streamer
  // who'd toggled it off), then hot-swap the senders via
  // replaceVideoTrack / replaceAudioTrack. The WHIP session never
  // tears down — viewers see the new camera angle on the next
  // segment without a disconnect or re-buffering loop.
  const flipCamera = useCallback(async () => {
    if (phase !== "live") return;
    if (flippingCamera) return;
    const publisher = publisherRef.current;
    if (!publisher) return;

    setFlippingCamera(true);
    const nextFacingMode: "user" | "environment" =
      facingMode === "user" ? "environment" : "user";

    try {
      const portrait = window.matchMedia("(orientation: portrait)").matches;
      const isMobile = window.matchMedia(
        "(max-width: 767px), (pointer: coarse)",
      ).matches;
      const wantsPortrait = isMobile && portrait;

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: nextFacingMode,
          width: { ideal: wantsPortrait ? 720 : 1280 },
          height: { ideal: wantsPortrait ? 1280 : 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      const newAudioTrack = newStream.getAudioTracks()[0];

      // Preserve the streamer's current toggle state on the fresh
      // tracks. Without this, flipping the camera would override
      // a "camera off" or "mic muted" intent.
      if (newVideoTrack) newVideoTrack.enabled = videoEnabled;
      if (newAudioTrack) newAudioTrack.enabled = audioEnabled;

      // Replace both senders. Video is the obvious one; audio is
      // included for parity with the orientation-change handler —
      // some browsers tie the audio track lifecycle to the video
      // device handle, so re-acquiring both keeps them in sync.
      if (newVideoTrack) await publisher.replaceVideoTrack(newVideoTrack);
      if (newAudioTrack) await publisher.replaceAudioTrack(newAudioTrack);

      // Swap the local preview's MediaStream (video-only, same
      // rationale as in handleStart — never share the audio track
      // between the <video> element and the WebRTC sender). Stop
      // the old underlying stream so the camera light reflects only
      // the active device.
      const oldStream = streamRef.current;
      streamRef.current = newStream;
      const previewStream = new MediaStream(newStream.getVideoTracks());
      if (videoRef.current) {
        videoRef.current.srcObject = previewStream;
        await videoRef.current.play().catch(() => {
          // muted + playsinline cover autoplay restrictions; ignore.
        });
      }
      if (oldStream) {
        for (const t of oldStream.getTracks()) t.stop();
      }
      setFacingMode(nextFacingMode);
    } catch (err) {
      console.warn("Camera flip failed", err);
      // On failure the old stream is still active — nothing to
      // restore. We just surface a toast so the streamer knows the
      // flip didn't take.
      toast.error("Couldn't switch camera");
    } finally {
      setFlippingCamera(false);
    }
  }, [phase, flippingCamera, facingMode, videoEnabled, audioEnabled]);

  // `skipConfirm` is set when the caller has already confirmed via the
  // declare/end modal (so we don't stack a second native confirm on top
  // of it). The bare top-bar path leaves it unset and shows the prompt.
  const handleEnd = async (opts?: { skipConfirm?: boolean }) => {
    if (
      !opts?.skipConfirm &&
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

  // Pull the settle-readiness gauge — drives both the End-stream
  // button label (Cancel vs End, depending on whether ending now
  // would trigger a refund) AND the bottom-left ReadinessOverlay
  // that ticks over in real time as bets land. Single source of
  // truth so the two reads can't disagree.
  //
  // The hook wires up Realtime subscriptions on `event_outcomes`
  // UPDATE + `bets` INSERT, so the streamer sees the participant /
  // outcome / pool counters move the instant a viewer places a bet
  // — no polling, no manual refresh.
  const { data: progress } = useEventProgress(eventId);
  const minimumsMet = progress.minimumsMet;
  // Ending the stream right now would auto-cancel + refund if either
  // the window is still open (no winner can be declared yet) or the
  // pool / participant / outcome minimums aren't met (finish_event
  // routes through cancel_event in that case). Either way the UI
  // should say "Cancel stream" rather than "End stream" so the
  // streamer knows what they're agreeing to.
  const willCancel = !bettingClosed || !minimumsMet;
  // A sub-minimum round no longer auto-ends the stream. The streamer
  // stays in control: Next round / Final round sit on the toolbar
  // (disabled only while the window is open), and an under-minimum
  // round advances by refunding via settle_round when they choose to.
  //
  // `declareRefundAdvance` is the modal flavour where the streamer is
  // advancing past an under-minimum round (no winner pick — the round
  // refunds and the next/final round opens). The current round number
  // is surfaced for the modal copy.
  const roundNum = event?.current_round ?? 1;
  const declareRefundAdvance =
    declareIntent === "next-refund" || declareIntent === "final-refund";
  // Next / Final round are gated while any settlement RPC is in flight so
  // a double-tap can't fire two advance_round calls.
  const roundMutationPending =
    declareWinnerMutation.isPending ||
    advanceRoundMutation.isPending ||
    markFinalRoundMutation.isPending;
  const isMulti = event?.round_format === "multi";
  // The declare/end modal has three shapes, keyed off the active intent:
  //   • refund-advance (next-refund / final-refund) — no winner pick; the
  //     under-minimum current round refunds and the next / final round
  //     opens. Stream stays live.
  //   • winner-pick (!willCancel — bettingClosed && minimumsMet) — declare
  //     a winner, then settle + advance / settle + open final / settle +
  //     end depending on intent.
  //   • refund-end (willCancel && intent "end") — force-end: refund the
  //     current round and close the stream. Prior rounds keep payouts.
  const isWinnerPick = !willCancel;
  const isRefundEnd = willCancel && !declareRefundAdvance;
  const showPriorRoundList =
    isRefundEnd && isMulti && (event?.current_round ?? 1) > 1;
  const outcomes = (event?.outcomes ?? [])
    .slice()
    .sort(
      (a: { sort_order: number }, b: { sort_order: number }) =>
        a.sort_order - b.sort_order,
    ) as Array<{ id: string; label: string; sort_order: number }>;

  const handleDeclareSubmit = async () => {
    // Refund-advance: the round being left didn't meet minimums, so we
    // skip declare_winner entirely. advance_round / mark_final_round
    // call settle_round, which auto-refunds the under-minimum round and
    // opens the next / final round. The stream stays live.
    if (declareRefundAdvance) {
      try {
        if (declareIntent === "next-refund") {
          await advanceRoundMutation.mutateAsync();
          toast.success(`Round ${roundNum} refunded — next round opening`);
        } else {
          await markFinalRoundMutation.mutateAsync();
          toast.success(`Round ${roundNum} refunded — final round opening`);
        }
        setDeclareOpen(false);
        setSelectedWinners(new Set());
      } catch (err) {
        const message =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : "Couldn't advance the round";
        toast.error(message);
      }
      return;
    }

    // Every remaining intent declares a winner first.
    if (selectedWinners.size === 0) {
      toast.error("Pick at least one winning outcome");
      return;
    }
    try {
      await declareWinnerMutation.mutateAsync(Array.from(selectedWinners));

      // Multi-round, staying live: declare + advance OR declare + mark
      // final (mark_final_round advances AND opens a fresh window for
      // the final round — see 20260608_000005).
      if (declareIntent === "next") {
        await advanceRoundMutation.mutateAsync();
        toast.success(`Round ${roundNum} settled — next round opening`);
        setDeclareOpen(false);
        setSelectedWinners(new Set());
        return;
      }
      if (declareIntent === "final") {
        await markFinalRoundMutation.mutateAsync();
        toast.success(`Round ${roundNum} settled — final round opening for bets`);
        setDeclareOpen(false);
        setSelectedWinners(new Set());
        return;
      }

      // declareIntent === "end" with a winner picked (settle-able).
      if (event?.round_format === "multi") {
        // finish_event sees winning_outcome_ids set and settles the
        // current round under the hood (prior rounds keep their
        // payouts), then flips status → finished. handleEnd navigates.
        setDeclareOpen(false);
        setSelectedWinners(new Set());
        await handleEnd({ skipConfirm: true });
        return;
      }

      // Single-round: declare_winner already flipped the event to
      // pending_moderation; just stop the stream + bounce to the list.
      // A LiveRush moderator releases payouts.
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
      {/* The local preview is mirrored only for the front camera —
          matches the same convention Zoom / Meet / TikTok use, and
          reading text backwards through the rear camera would be
          jarring. Mirror is preview-only; the published stream is
          never mirrored (Cloudflare receives raw frames). */}
      <video
        ref={videoRef}
        className={
          phase === "live"
            ? `absolute inset-0 h-full w-full object-contain ${facingMode === "user" ? "-scale-x-100" : ""}`
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
            <div className="flex items-center gap-2">
              {/* Round pill — multi-round events only. Same data the
                  viewer sees, in compact-friendly sizing. */}
              {event.round_format === "multi" && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider tabular-nums",
                    event.is_final_round
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-white/10 text-white ring-1 ring-white/20",
                  )}
                >
                  {event.is_final_round
                    ? "Final round"
                    : `Round ${event.current_round ?? 1}`}
                </span>
              )}
              <BettingCountdown
                closesAt={event.betting_closes_at}
                variant="compact"
              />
            </div>
          )}
        </div>
        {phase === "live" || phase === "ending" ? (
          // Top-right toolbar — the streamer is always in control.
          //
          // Multi-round, not yet final: Next round + Final round +
          // End stream are ALL on screen. Next / Final are disabled
          // while the betting window is open (declare_winner /
          // settle_round would 22023 on the server until it closes);
          // once it closes they open the declare-winner modal —
          // picking a winner when minimums are met, or confirming a
          // refund-and-advance when they aren't (settle_round refunds
          // the under-minimum round and opens the next / final one).
          //
          // Multi-round final round + single-round events: only End
          // stream. The final round has no further Next/Final to
          // offer. End stream is a force-end that always works — it
          // settles a settle-able current round after a winner pick,
          // or refunds an in-window / under-minimum round, leaving
          // prior rounds' settlements untouched.
          event?.round_format === "multi" && !event.is_final_round ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDeclareIntent(minimumsMet ? "next" : "next-refund");
                  setDeclareOpen(true);
                }}
                disabled={!bettingClosed || roundMutationPending}
                title={
                  !bettingClosed
                    ? "Available once the betting window closes"
                    : undefined
                }
              >
                Next round
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDeclareIntent(minimumsMet ? "final" : "final-refund");
                  setDeclareOpen(true);
                }}
                disabled={!bettingClosed || roundMutationPending}
                title={
                  !bettingClosed
                    ? "Available once the betting window closes"
                    : undefined
                }
              >
                Final round
              </Button>
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={() => {
                  setDeclareIntent("end");
                  setDeclareOpen(true);
                }}
                disabled={phase === "ending" || declareWinnerMutation.isPending}
                className="bg-destructive text-white hover:bg-destructive/90"
                style={{ backgroundImage: "none" }}
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
            </div>
          ) : (
            // Multi-round final round + single-round: only End stream.
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={() => {
                setDeclareIntent("end");
                setDeclareOpen(true);
              }}
              disabled={phase === "ending" || declareWinnerMutation.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
              style={{ backgroundImage: "none" }}
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
          )
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
          phones get the unobstructed video; tablet+ shows both.
          ReadinessOverlay replaced the old mock "Live stakes" feed —
          the streamer now sees the three settle-guard counters tick
          over in real time as bets land, instead of fake names. */}
      {phase === "live" && (
        <>
          <ReadinessOverlay progress={progress} />
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
            {/* Flip camera — only shown when the device exposes ≥ 2
                video inputs (typical mobile). Triggers a hot-swap on
                the live publisher; the stream stays connected and
                the current video/audio on-off state is preserved. A
                tiny spinner overlay while the swap settles guards
                against double-tap. */}
            {hasMultipleCameras && (
              <button
                type="button"
                onClick={() => void flipCamera()}
                disabled={flippingCamera}
                aria-label="Switch camera"
                title={
                  facingMode === "user"
                    ? "Switch to rear camera"
                    : "Switch to front camera"
                }
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-60"
              >
                {flippingCamera ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <SwitchCamera className="h-5 w-5" />
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Multi-round cancel: any round before the current one has
          already settled (declare_winner + advance_round / mark_final
          fired its settle_round on the way through), so finish_event's
          server-side branch only refunds the *current* incomplete
          round. We surface that explicitly so the streamer isn't
          surprised that round 1's pool didn't blow up when they
          cancelled mid-round 2. */}
      {(() => null)()}
      {/* Declare / advance / end modal — single entry point for every
          round-control action. Three shapes (see isWinnerPick /
          declareRefundAdvance / isRefundEnd above):
            • refund-advance — under-minimum current round refunds, next
              / final round opens, stream stays live. No winner pick.
            • winner-pick — declare winner, then settle + advance / open
              final / end depending on intent.
            • refund-end — force-end: refund the current round and close
              the stream. Multi-round past round 1 shows the per-round
              breakdown so the streamer sees prior rounds keep payouts. */}
      <Dialog open={declareOpen} onOpenChange={setDeclareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {declareRefundAdvance
                ? declareIntent === "final-refund"
                  ? "Refund round & open final"
                  : "Refund round & continue"
                : isWinnerPick
                  ? declareIntent === "next"
                    ? "Declare winner — next round"
                    : declareIntent === "final"
                      ? "Declare winner — final round"
                      : "End stream & declare winner"
                  : "End stream"}
            </DialogTitle>
            <DialogDescription>
              {declareRefundAdvance
                ? `Round ${roundNum} didn't reach the minimum bets to settle (participants, outcomes, or pool). These bets refund in full and ${
                    declareIntent === "final-refund"
                      ? "the final round opens for betting"
                      : "the next round opens for betting"
                  }. The stream stays live.`
                : isWinnerPick
                  ? declareIntent === "next"
                    ? "Pick the outcome(s) that won this round. Multi-select supports dead heats. The round settles to payouts-pending-approval and the next round opens for betting."
                    : declareIntent === "final"
                      ? "Pick the outcome(s) that won this round. Multi-select supports dead heats. The round settles and the final round opens for betting."
                      : isMulti
                        ? "Pick the outcome(s) that won. Multi-select supports dead heats. The current round settles, prior rounds keep their payouts, and the stream ends."
                        : "Pick the outcome(s) that won. Multi-select supports dead heats. Once submitted, the event flips to Pending settlement and a LiveRush moderator releases payouts."
                  : showPriorRoundList
                    ? "Rounds you've already settled keep their payouts (waiting on LiveRush settlement approval). Only the current in-progress round will refund — see the breakdown below."
                    : bettingClosed
                      ? "This round didn't reach the minimum bets needed to settle (participants, outcomes, or pool). Ending now refunds every bet in this round in full and closes the stream."
                      : "The betting window is still open. Ending now closes the stream and refunds every bet in full — no winner is declared."}
            </DialogDescription>
          </DialogHeader>

          {/* Per-round status list — force-end of a multi-round event
              past its first round. Prior rounds already settled; only
              the current round refunds. */}
          {showPriorRoundList && (
            <ul className="space-y-2 py-2">
              {Array.from({ length: event?.current_round ?? 1 }, (_, i) => {
                const listRound = i + 1;
                const isCurrent = listRound === event?.current_round;
                return (
                  <li
                    key={listRound}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-sm",
                      isCurrent
                        ? "border-destructive/40 bg-destructive/[0.06]"
                        : "border-emerald-500/30 bg-emerald-500/[0.06]",
                    )}
                  >
                    {isCurrent ? (
                      <PhoneOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold">Round {listRound}</div>
                      <div className="text-xs text-muted-foreground">
                        {isCurrent
                          ? "Bets in this round will refund in full."
                          : "Settled — payouts pending LiveRush approval."}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {isWinnerPick && (
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
              disabled={
                declareWinnerMutation.isPending ||
                roundMutationPending ||
                phase === "ending"
              }
            >
              Cancel
            </Button>
            {declareRefundAdvance ? (
              // Refund the under-minimum round and open the next / final
              // round. No winner pick — handleDeclareSubmit calls
              // advance_round / mark_final_round directly.
              <Button
                type="button"
                onClick={handleDeclareSubmit}
                disabled={roundMutationPending}
              >
                {roundMutationPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : declareIntent === "final-refund" ? (
                  "Refund & open final round"
                ) : (
                  "Refund & open next round"
                )}
              </Button>
            ) : isWinnerPick ? (
              <Button
                type="button"
                onClick={handleDeclareSubmit}
                disabled={roundMutationPending || selectedWinners.size === 0}
              >
                {roundMutationPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Trophy className="h-4 w-4" />
                    {declareIntent === "next"
                      ? "Settle & open next round"
                      : declareIntent === "final"
                        ? "Settle & open final round"
                        : "End & submit results"}
                  </>
                )}
              </Button>
            ) : (
              // refund-end: the modal already confirmed, so skip the
              // native confirm inside handleEnd.
              <Button
                type="button"
                onClick={async () => {
                  setDeclareOpen(false);
                  await handleEnd({ skipConfirm: true });
                }}
                disabled={phase === "ending"}
                // Same gradient-strip-but-keep-solid trick as the top
                // bar CTA — inline style nukes only the bg gradient
                // so bg-destructive shows through.
                className="bg-destructive text-white hover:bg-destructive/90"
                style={{ backgroundImage: "none" }}
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
// Overlays — bottom-left readiness, bottom-right chat.
//
// ReadinessOverlay replaces the old mock stakes feed: it surfaces the
// three settle_event guards (unique bettors, distinct outcomes with
// bets, minimum pool) with live counters that tick over via Realtime
// every time a viewer places a bet. The streamer sees in real time
// whether the event will be settleable when the betting window
// closes — if any guard is still red when the window expires, the
// stream ends in cancel/refund mode instead of declare-winner.
// =========================================================================

/** Compact relative-time helper for chat timestamps. */
function relativeTimeShort(d: Date): string {
  const diff = Math.max(0, Date.now() - d.getTime());
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

function ReadinessOverlay({ progress }: { progress: EventProgress }) {
  // Same three-row layout the user-app's ReadinessCard used pre-
  // simplification: label + current/required counter, with cleared
  // rows striking through and turning green. The streamer wants the
  // full picture (including the rows that are already met) so they
  // can see progress as it happens, not just the outstanding items.
  // 1 coin = 100 cents internally (see packages/lib/src/coins.ts).
  // Pool labels show as `<coin> 18 / <coin> 30`, replacing the legacy
  // "$18/$30" so the unit reads as virtual coins everywhere.
  const poolCoins = (cents: number) => Math.round(cents / 100);
  const items: {
    label: string;
    haveLabel: ReactNode;
    cleared: boolean;
  }[] = [
    {
      label: "Unique participants",
      haveLabel: `${progress.uniqueBettors}/${progress.minUniqueBettors}`,
      cleared: progress.uniqueBettors >= progress.minUniqueBettors,
    },
    {
      label: "Different outcomes",
      haveLabel: `${progress.outcomesWithBets}/${progress.minOutcomesWithBets}`,
      cleared:
        progress.outcomesWithBets >= progress.minOutcomesWithBets,
    },
    {
      label: "Total pool",
      haveLabel: (
        <span className="inline-flex items-center gap-0.5">
          <CoinIcon className="h-3 w-3" />
          {poolCoins(progress.totalPoolCents)}/{poolCoins(progress.minPoolCents)}
        </span>
      ),
      cleared: progress.totalPoolCents >= progress.minPoolCents,
    },
  ];
  const allMet = progress.minimumsMet;

  return (
    <aside
      aria-label="Betting readiness"
      className="pointer-events-auto absolute bottom-3 left-3 z-10 hidden w-[300px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/55 text-white shadow-xl backdrop-blur-md md:flex"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ListChecks
            className={`h-4 w-4 ${allMet ? "text-emerald-300" : "text-amber-300"}`}
          />
          <h2 className="font-heading text-xs font-bold uppercase tracking-wider">
            {allMet ? "Ready to settle" : "Betting minimums"}
          </h2>
        </div>
        {/* Pulse dot mirrors the LIVE pill but in amber/green so the
            streamer's eye catches "still waiting" vs "all met" at a
            glance. */}
        <span
          className={`h-2 w-2 animate-pulse rounded-full ${allMet ? "bg-emerald-400" : "bg-amber-300"}`}
          aria-hidden
        />
      </div>
      <ul className="space-y-2 px-3 py-3 text-xs">
        {items.map((item) => (
          <li
            key={item.label}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              {item.cleared ? (
                <CheckCircle2
                  className="h-3.5 w-3.5 flex-shrink-0 text-emerald-300"
                  aria-hidden
                />
              ) : (
                <Circle
                  className="h-3.5 w-3.5 flex-shrink-0 text-white/40"
                  aria-hidden
                />
              )}
              <span
                className={
                  item.cleared
                    ? "text-white/80 line-through decoration-emerald-300/60"
                    : "text-white"
                }
              >
                {item.label}
              </span>
            </span>
            <span
              className={`font-heading text-sm font-bold tabular-nums ${
                item.cleared ? "text-emerald-300" : "text-amber-200"
              }`}
            >
              {item.haveLabel}
            </span>
          </li>
        ))}
      </ul>
      {!allMet && (
        <p className="border-t border-white/10 px-3 py-2 text-[10px] leading-tight text-white/60">
          If any threshold is still missed when the betting window closes,
          ending the stream refunds every bet.
        </p>
      )}
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
