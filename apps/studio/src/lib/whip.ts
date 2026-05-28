// WHIP (WebRTC-HTTP Ingestion Protocol) publisher.
//
// One-shot publisher targeting Cloudflare Stream's WHIP endpoint.
// The browser owns the encoder; Cloudflare ingests the WebRTC and
// serves HLS to viewers.
//
// Cloudflare's WHIP URL is per-input and embeds the publish secret in
// the URL path (e.g. `https://customer-XXX.cloudflarestream.com/<secret>/webRTC/publish`),
// so there's no separate Authorization header — possession of the URL
// is the credential. We get that URL from the `get_stream_credentials`
// RPC, which is gated by RLS to the event's creator.
//
// Sequence:
//   1. Create RTCPeerConnection with STUN servers (Cloudflare handles
//      TURN on its side; STUN is enough from the publisher).
//   2. Add audio + video tracks from the supplied MediaStream as
//      send-only transceivers. setCodecPreferences pins H.264 baseline
//      + Opus, which is what Cloudflare expects on the WHIP ingest.
//   3. Cap the video sender bitrate at ~2 Mbps via setParameters so
//      the encoder doesn't try to push past Cloudflare's per-stream cap.
//   4. createOffer / setLocalDescription, then POST the offer SDP to
//      `${whipUrl}` with `Content-Type: application/sdp`.
//   5. Cloudflare returns the answer SDP (Content-Type: application/sdp,
//      201 Created) and a Location header pointing at the resource
//      URL for the active ingest session.
//   6. setRemoteDescription with the answer. ICE negotiation
//      completes shortly after; the connection state goes "connected"
//      and bytes start flowing.
//   7. On stop() — DELETE the resource URL Cloudflare returned so the
//      session ends cleanly server-side, then close the peer and
//      stop all local tracks.
//
// Orientation changes mid-stream are handled by replaceVideoTrack().
// The browser swaps the track on the existing RTCRtpSender without
// renegotiation; the new aspect ratio is delivered to Cloudflare on
// the next keyframe.

export type WhipPublisherStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "failed"
  | "stopped";

export interface WhipPublisherOptions {
  /** Called whenever the underlying RTCPeerConnection transitions
   *  state. Useful for UI cues (spinner during 'connecting',
   *  warning banner on 'failed'). */
  onStatusChange?: (status: WhipPublisherStatus) => void;
  /** Surface any error from the WHIP exchange or PC failure. */
  onError?: (error: Error) => void;
}

// Target ingest bitrate (bits per second). Cloudflare's WHIP ingest cap
// is higher but ~2 Mbps is the sweet spot for 720p WebRTC: high enough
// to look good, low enough that uplink-constrained creators don't drop
// frames.
const VIDEO_BITRATE_BPS = 2_000_000;

export class WhipPublisher {
  private pc: RTCPeerConnection | null = null;
  /** The WHIP resource URL Mux returns in the Location header. We
   *  DELETE this on stop() to release the session server-side. */
  private resourceUrl: string | null = null;
  /** The MediaStream we're publishing — held so we can stop its
   *  tracks on shutdown. */
  private stream: MediaStream | null = null;
  /** Reference to the video sender so replaceVideoTrack() can swap
   *  in a new track when the creator rotates their phone. */
  private videoSender: RTCRtpSender | null = null;
  /** Same for the audio sender — needed because rotating a phone
   *  triggers a fresh getUserMedia and the new audio track has to
   *  be substituted in, or the publisher silently keeps sending the
   *  stopped old track and viewers hear nothing. */
  private audioSender: RTCRtpSender | null = null;
  /** Periodic keyframe-forcer. Chrome's WebRTC encoder only emits an
   *  H.264 keyframe at session start + on receiver PLI request; the
   *  rest is P-frames. Cloudflare's WHIP→HLS transcoder needs keys
   *  every few seconds to chunk media into HLS segments — without
   *  them, playback stalls after the first ~10 s when the initial
   *  segment is consumed and there's no keyframe to start a new one.
   *  This timer toggles `scaleResolutionDownBy` by a fractional
   *  amount every 2 s, which triggers Chrome's encoder to emit a
   *  fresh keyframe without actually changing the encoded resolution
   *  (the delta is < 1 px). Cleared in stop(). */
  private keyframeTimer: ReturnType<typeof setInterval> | null = null;
  private status: WhipPublisherStatus = "idle";

  constructor(private options: WhipPublisherOptions = {}) {}

  /** Begin publishing the given MediaStream to the supplied WHIP URL.
   *  Throws on negotiation failure. Resolves once the WHIP exchange
   *  succeeds — ICE may still be negotiating at this point, but the
   *  server will be expecting bytes. */
  async start(stream: MediaStream, whipUrl: string): Promise<void> {
    if (this.pc) {
      throw new Error("WhipPublisher.start() called twice without stop()");
    }
    this.stream = stream;
    this.setStatus("connecting");

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    this.pc = pc;

    pc.addEventListener("connectionstatechange", () => {
      switch (pc.connectionState) {
        case "connected":
          this.setStatus("live");
          break;
        case "disconnected":
          this.setStatus("reconnecting");
          break;
        case "failed":
          this.setStatus("failed");
          this.options.onError?.(
            new Error("WebRTC connection to the ingest server failed"),
          );
          break;
        case "closed":
          // Triggered by our own stop() — leave status alone.
          break;
      }
    });

    // Add tracks as send-only and pin codec preferences. Cloudflare's
    // WHIP ingest expects H.264 baseline for video and Opus for audio.
    // Both sender refs are stashed so the creator can rotate their
    // phone mid-broadcast (replaceVideoTrack / replaceAudioTrack).
    for (const track of stream.getTracks()) {
      const transceiver = pc.addTransceiver(track, { direction: "sendonly" });
      pinCodecPreferences(transceiver, track.kind);
      if (track.kind === "video") {
        this.videoSender = transceiver.sender;
      } else if (track.kind === "audio") {
        this.audioSender = transceiver.sender;
      }
    }

    // Cap video sender bitrate before negotiation so the server sees
    // the intended rate in the offer.
    if (this.videoSender) {
      try {
        const params = this.videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = VIDEO_BITRATE_BPS;
        await this.videoSender.setParameters(params);
      } catch {
        // Older browsers may reject — non-fatal; the server will
        // rate-limit if needed.
      }
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete so the offer SDP has the
    // full candidate list. Cloudflare's WHIP endpoint expects
    // trickle-less offers (most WHIP servers do).
    await waitForIceGatheringComplete(pc);
    const finalOffer = pc.localDescription;
    if (!finalOffer) throw new Error("Failed to build local description");

    // 5) Negotiate with Cloudflare. The publish secret is in the URL
    //    path itself, so no Authorization header is needed.
    const response = await fetch(whipUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp",
      },
      body: finalOffer.sdp,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `WHIP server rejected the offer (${response.status}): ${body || response.statusText}`,
      );
    }

    // Save the resource URL so we can DELETE on stop. The server
    // returns it (usually relative) in the Location header.
    const location = response.headers.get("Location");
    if (location) {
      this.resourceUrl = location.startsWith("http")
        ? location
        : new URL(location, whipUrl).toString();
    }

    const answerSdp = await response.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    // connectionstatechange listener will flip status to "live" once
    // ICE completes.

    // Start the periodic keyframe-forcer — see field comment on
    // keyframeTimer for the why.
    this.startKeyframeForcer();
  }

  /** Toggle `scaleResolutionDownBy` between 1.0 and 1.001 every 2 s.
   *  Each setParameters call triggers Chrome to re-evaluate the
   *  encoding pipeline, which in turn forces a fresh keyframe. The
   *  delta is < 1 px so the actual encoded resolution is unchanged. */
  private startKeyframeForcer(): void {
    if (this.keyframeTimer || !this.videoSender) return;
    let useNudge = false;
    this.keyframeTimer = setInterval(async () => {
      const sender = this.videoSender;
      if (!sender) return;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].scaleResolutionDownBy = useNudge ? 1.001 : 1.0;
        useNudge = !useNudge;
        await sender.setParameters(params);
      } catch {
        // Some browser/encoder combos reject setParameters mid-flight;
        // non-fatal — the worst case is no keyframe nudge, which is
        // where we were before this code existed.
      }
    }, 2000);
  }

  /** Swap the currently-published video track for a new one. Used
   *  when the creator rotates their phone mid-stream — we re-grab the
   *  camera at the new orientation and hand the resulting track here. */
  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.videoSender) {
      throw new Error("Cannot replace video track before start()");
    }
    await this.videoSender.replaceTrack(track);
  }

  /** Swap the currently-published audio track for a new one. We pair
   *  this with replaceVideoTrack on phone-rotation: the fresh
   *  getUserMedia returns both a new video AND new audio track, and
   *  if we only swap video the publisher keeps trying to send the now-
   *  stopped old audio track — viewers go silent. */
  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.audioSender) {
      throw new Error("Cannot replace audio track before start()");
    }
    await this.audioSender.replaceTrack(track);
  }

  /** Tear down the session: DELETE the WHIP resource (so the server
   *  marks the ingest as cleanly ended), close the peer connection,
   *  stop the local media tracks (camera light turns off). */
  async stop(): Promise<void> {
    if (this.keyframeTimer) {
      clearInterval(this.keyframeTimer);
      this.keyframeTimer = null;
    }

    // Best-effort DELETE to the server. If the network is gone or
    // the server has already cleaned up, ignore the error — the
    // local teardown below is what actually matters for the camera
    // light.
    if (this.resourceUrl) {
      try {
        await fetch(this.resourceUrl, { method: "DELETE" });
      } catch {
        // ignore
      }
      this.resourceUrl = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    this.videoSender = null;
    this.audioSender = null;
    this.setStatus("stopped");
  }

  private setStatus(next: WhipPublisherStatus) {
    if (this.status === next) return;
    this.status = next;
    this.options.onStatusChange?.(next);
  }
}

// =========================================================================
// Helpers
// =========================================================================

/** Restrict the transceiver's offered codecs to H.264 baseline +
 *  Opus, which is what Cloudflare's WHIP ingest accepts. Older browsers
 *  may not support setCodecPreferences — in that case we skip and let
 *  the answer SDP do the codec selection. */
function pinCodecPreferences(
  transceiver: RTCRtpTransceiver,
  kind: string,
): void {
  if (typeof RTCRtpSender.getCapabilities !== "function") return;
  if (typeof transceiver.setCodecPreferences !== "function") return;

  const caps = RTCRtpSender.getCapabilities(kind);
  if (!caps) return;

  const preferred =
    kind === "video"
      ? caps.codecs.filter(
          (c) => c.mimeType.toLowerCase() === "video/h264",
        )
      : caps.codecs.filter(
          (c) => c.mimeType.toLowerCase() === "audio/opus",
        );

  if (preferred.length === 0) return;

  // Move preferred codecs to the front; keep others as fallback.
  const ordered = [
    ...preferred,
    ...caps.codecs.filter((c) => !preferred.includes(c)),
  ];
  try {
    transceiver.setCodecPreferences(ordered);
  } catch {
    // Some browsers throw if any unsupported codec is in the list;
    // ignore and fall back to default ordering.
  }
}

/** Resolves once ICE gathering finishes, or 3 s elapses (whichever
 *  comes first). Cloudflare's WHIP endpoint expects a complete offer;
 *  some networks never reach "complete" but produce enough candidates
 *  in the first second. */
function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", check);
    const timer = setTimeout(done, 3000);
  });
}
