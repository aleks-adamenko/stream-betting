// WHIP (WebRTC-HTTP Ingestion Protocol) publisher for Cloudflare Stream.
//
// Thin wrapper around @eyevinn/whip-web-client, which Cloudflare has
// explicitly tested and certified as a compatible WHIP client. After
// a full day of debugging a custom WHIP implementation where Chrome's
// Opus encoder would emit zero packets — making Cloudflare's ingest
// tear the session down after ~30s — Cloudflare's own AI agent
// pointed at @eyevinn/whip-web-client as the right tool. Subtle
// differences in SDP m-line ordering, ICE gathering timing, DTLS role
// negotiation, and BUNDLE handling matter for the Opus encoder to
// actually engage, and Cloudflare-tested libraries get them right.
//
// We keep the WhipPublisher class shape stable so LiveStream.tsx
// doesn't need to change — it still gets start() / stop() /
// onStatusChange / onError / replaceVideoTrack / replaceAudioTrack.

import { WHIPClient } from "@eyevinn/whip-web-client";

export type WhipPublisherStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "failed"
  | "stopped";

export interface WhipPublisherOptions {
  /** Status transitions for UI cues (spinner on 'connecting',
   *  warning on 'failed'). */
  onStatusChange?: (status: WhipPublisherStatus) => void;
  /** Surface fatal errors from the WHIP exchange or PC failure. */
  onError?: (error: Error) => void;
}

export class WhipPublisher {
  private client: WHIPClient | null = null;
  private stream: MediaStream | null = null;
  /** The underlying RTCPeerConnection — fished out via a peer-
   *  connection factory so we can call getSenders() for the
   *  phone-rotation track swaps. The library doesn't expose it
   *  through public API, so this is the documented escape hatch. */
  private pc: RTCPeerConnection | null = null;
  private status: WhipPublisherStatus = "idle";

  constructor(private options: WhipPublisherOptions = {}) {}

  /** Begin publishing `stream` to the supplied WHIP URL. Throws on
   *  negotiation failure. */
  async start(stream: MediaStream, whipUrl: string): Promise<void> {
    if (this.client) {
      throw new Error("WhipPublisher.start() called twice without stop()");
    }
    this.stream = stream;
    this.setStatus("connecting");

    // peerConnectionFactory: build the RTCPeerConnection ourselves
    // so we can hold a reference to it. We also wire connection-
    // state events here so the React layer can react to drops.
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
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
        // "closed" → our own stop() — leave status alone.
      }
    });

    try {
      this.client = new WHIPClient({
        endpoint: whipUrl,
        opts: {
          debug: true,
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        },
        peerConnectionFactory: () => pc,
      });
      await this.client.ingest(stream);
    } catch (err) {
      this.setStatus("failed");
      // Re-throw so LiveStream's try/catch surfaces a user-visible
      // error and stopStream() runs.
      throw err;
    }
  }

  /** Swap the published video track (creator rotates phone). */
  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) {
      throw new Error("Cannot replace video track before start()");
    }
    await sender.replaceTrack(track);
  }

  /** Swap the published audio track — paired with replaceVideoTrack
   *  on phone rotation. Without this, after a new getUserMedia call
   *  the publisher keeps trying to send the now-stopped old audio
   *  track and viewers go silent. */
  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "audio");
    if (!sender) {
      throw new Error("Cannot replace audio track before start()");
    }
    await sender.replaceTrack(track);
  }

  /** Tear down the session: DELETE the WHIP resource (handled by
   *  the library), close the peer connection, stop local tracks. */
  async stop(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // best-effort
      }
      this.client = null;
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

    this.setStatus("stopped");
  }

  private setStatus(next: WhipPublisherStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.options.onStatusChange?.(next);
  }
}
