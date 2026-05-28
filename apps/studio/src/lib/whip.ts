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
  /** Diagnostic stats poller. Logs outbound RTP byte/packet counts
   *  and the selected ICE candidate pair every second so we can see
   *  from devtools whether media is leaving the browser at all
   *  (versus the WHIP handshake having succeeded but ICE never
   *  reaching `connected`). Cleared in stop(). */
  private statsTimer: ReturnType<typeof setInterval> | null = null;
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

    // Multiple STUN servers for redundancy. A single STUN endpoint
    // sometimes rate-limits high-volume browser clients silently —
    // when that happens the only srflx candidate never gathers and
    // ICE has nothing but host candidates to try, which fails on any
    // non-LAN target. Listing several gives the gatherer a fallback.
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
      ],
      // bundlePolicy 'max-bundle' keeps audio + video on one
      // transport — fewer candidate pairs to check, faster connect.
      bundlePolicy: "max-bundle",
    });
    this.pc = pc;

    // Track ICE-restart attempts so we don't loop forever if the
    // network is genuinely broken.
    let iceRestartAttempts = 0;
    const MAX_ICE_RESTARTS = 2;

    pc.addEventListener("connectionstatechange", () => {
      switch (pc.connectionState) {
        case "connected":
          this.setStatus("live");
          break;
        case "disconnected":
          this.setStatus("reconnecting");
          break;
        case "failed":
          // Try an ICE restart before giving up. This forces a fresh
          // candidate gather and re-negotiation, which recovers from
          // transient NAT timeouts and STUN throttling without the
          // user having to click anything. We POST the new offer to
          // the same WHIP resource URL Cloudflare returned earlier.
          if (
            iceRestartAttempts < MAX_ICE_RESTARTS &&
            this.resourceUrl !== null
          ) {
            iceRestartAttempts += 1;
            this.setStatus("reconnecting");
            this.restartIce().catch((err) => {
              this.setStatus("failed");
              this.options.onError?.(err as Error);
            });
            break;
          }
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

    // Visibility for diagnostics — chrome://webrtc-internals will
    // surface these too, but having them in the page console makes
    // remote debugging much cheaper.
    pc.addEventListener("iceconnectionstatechange", () => {
      console.info("[whip] iceConnectionState =", pc.iceConnectionState);
    });
    pc.addEventListener("icegatheringstatechange", () => {
      console.info("[whip] iceGatheringState =", pc.iceGatheringState);
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

    // Wait for ICE gathering to complete so the offer SDP carries
    // the full candidate list. Cloudflare's WHIP endpoint is trickle-
    // less. We wait up to 5 s — long enough for slow STUN responses
    // (the previous 3 s budget was occasionally too tight, leaving
    // the offer with only host candidates and ICE no path to
    // Cloudflare).
    await waitForIceGatheringComplete(pc, 5000);
    const finalOffer = pc.localDescription;
    if (!finalOffer) throw new Error("Failed to build local description");

    // Sanity-check: if after the wait we still have no srflx
    // candidate, every STUN we tried failed silently. That's the
    // exact failure mode where signaling succeeds but media never
    // flows. Surface it loudly instead of letting the user stare at
    // a spinner.
    const hasSrflx = finalOffer.sdp?.includes("typ srflx") ?? false;
    if (!hasSrflx) {
      console.warn(
        "[whip] No server-reflexive candidate gathered — STUN may be blocked or rate-limited. " +
          "ICE will likely fail on any non-LAN target.",
      );
    }

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

    // Start the diagnostic stats poller. Logs once a second so we
    // can confirm media is actually leaving the browser. The
    // failure mode we're chasing is "WHIP signaling succeeds but
    // Cloudflare's ingest never sees a single RTP packet" — this
    // turns that opaque condition into an observable one.
    this.startStatsPoller();
  }

  /** Poll RTCPeerConnection.getStats() every second and log a
   *  one-line summary: ICE candidate-pair state, the local/remote
   *  candidate types of the selected pair, and outbound bytes/packets
   *  per kind. From devtools you can read this off directly without
   *  opening chrome://webrtc-internals. */
  private startStatsPoller(): void {
    if (this.statsTimer || !this.pc) return;
    let prev = { videoBytes: 0, audioBytes: 0 };
    this.statsTimer = setInterval(async () => {
      const pc = this.pc;
      if (!pc || pc.connectionState === "closed") return;
      try {
        const report = await pc.getStats();
        let videoBytes = 0;
        let audioBytes = 0;
        let videoPackets = 0;
        let audioPackets = 0;
        let selectedPairId: string | undefined;
        const candidates = new Map<string, RTCIceCandidateStats>();
        const pairs = new Map<string, RTCIceCandidatePairStats>();
        report.forEach((stat) => {
          if (stat.type === "outbound-rtp") {
            const s = stat as RTCOutboundRtpStreamStats;
            if (s.kind === "video") {
              videoBytes = s.bytesSent ?? 0;
              videoPackets = s.packetsSent ?? 0;
            } else if (s.kind === "audio") {
              audioBytes = s.bytesSent ?? 0;
              audioPackets = s.packetsSent ?? 0;
            }
          } else if (stat.type === "transport") {
            const s = stat as RTCTransportStats;
            if (s.selectedCandidatePairId) {
              selectedPairId = s.selectedCandidatePairId;
            }
          } else if (stat.type === "candidate-pair") {
            pairs.set(stat.id, stat as RTCIceCandidatePairStats);
          } else if (
            stat.type === "local-candidate" ||
            stat.type === "remote-candidate"
          ) {
            candidates.set(stat.id, stat as RTCIceCandidateStats);
          }
        });
        // Find the active pair: prefer the transport's selectedPairId,
        // fall back to whichever pair reports state=succeeded.
        let pair = selectedPairId ? pairs.get(selectedPairId) : undefined;
        if (!pair) {
          for (const p of pairs.values()) {
            if (p.state === "succeeded") {
              pair = p;
              break;
            }
          }
        }
        const localCand = pair?.localCandidateId
          ? candidates.get(pair.localCandidateId)
          : undefined;
        const remoteCand = pair?.remoteCandidateId
          ? candidates.get(pair.remoteCandidateId)
          : undefined;
        const dv = videoBytes - prev.videoBytes;
        const da = audioBytes - prev.audioBytes;
        prev = { videoBytes, audioBytes };
        console.info(
          `[whip] pc=${pc.connectionState} ice=${pc.iceConnectionState} ` +
            `pair=${pair?.state ?? "none"} ` +
            `local=${localCand?.candidateType ?? "?"}/${localCand?.protocol ?? "?"} ` +
            `remote=${remoteCand?.candidateType ?? "?"}/${remoteCand?.address ?? "?"} ` +
            `video=${videoBytes}B (+${dv}/s, ${videoPackets}pkt) ` +
            `audio=${audioBytes}B (+${da}/s, ${audioPackets}pkt)`,
        );
      } catch (err) {
        console.warn("[whip] getStats failed:", err);
      }
    }, 1000);
  }

  /** Restart ICE on the existing peer connection and re-PATCH the
   *  fresh offer to Cloudflare's WHIP resource URL. Recovers from a
   *  transient NAT timeout / STUN throttle without tearing the
   *  publisher down. Caller (`connectionstatechange` listener) is
   *  responsible for capping attempts so we don't loop. */
  private async restartIce(): Promise<void> {
    const pc = this.pc;
    const resourceUrl = this.resourceUrl;
    if (!pc || !resourceUrl) {
      throw new Error("restartIce called without an active session");
    }

    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc, 5000);
    const finalOffer = pc.localDescription;
    if (!finalOffer?.sdp) throw new Error("ICE restart: empty local SDP");

    // WHIP servers conventionally accept a PATCH on the resource URL
    // for renegotiation (RFC 9725 / draft-ietf-wish-whip). Cloudflare
    // supports it. If it 405s we fall back to a full POST to the
    // original WHIP endpoint, but that would require re-saving the
    // resource URL — caller decides whether to retry that path.
    const response = await fetch(resourceUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/sdp" },
      body: finalOffer.sdp,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `ICE restart PATCH rejected (${response.status}): ${body || response.statusText}`,
      );
    }

    // Some WHIP servers return a 204 with no body on PATCH; only
    // setRemoteDescription if we got an answer back.
    const ct = response.headers.get("Content-Type") ?? "";
    if (ct.includes("application/sdp")) {
      const answerSdp = await response.text();
      if (answerSdp) {
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      }
    }
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
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
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

/** Resolves once ICE gathering finishes, or `timeoutMs` elapses
 *  (whichever comes first). Cloudflare's WHIP endpoint expects a
 *  complete offer; some networks never reach "complete" but produce
 *  enough candidates in the first second. Default budget bumped to
 *  5 s to accommodate slow STUN responses on flaky connections. */
function waitForIceGatheringComplete(
  pc: RTCPeerConnection,
  timeoutMs = 5000,
): Promise<void> {
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
    const timer = setTimeout(done, timeoutMs);
  });
}
