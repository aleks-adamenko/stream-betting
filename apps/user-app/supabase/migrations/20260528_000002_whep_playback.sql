-- WHEP playback for WHIP-published live streams.
--
-- Cloudflare Stream does NOT generate HLS / DASH manifests for live
-- inputs published over WHIP — that pipeline is RTMPS-only. Viewers
-- subscribing to a WHIP-published stream must use WHEP (the WebRTC
-- playback counterpart to WHIP). Previously we stored the iframe
-- embed URL in `events.playback_url`, expecting Cloudflare's hosted
-- player to handle WHEP internally. It doesn't: the /iframe player
-- polls for an HLS manifest that never materializes for a WHIP
-- source, so viewers see an indefinite "Stream has not started yet"
-- loading state even when the publisher is healthy.
--
-- Fix: switch every existing `events.playback_url` from the
-- `/iframe` form to the `/webRTC/play` (WHEP) form. The UID embedded
-- in the URL is identical between both forms, so a path substitution
-- is sufficient — no API round-trip to Cloudflare needed for
-- historical rows. From this point on, the `provision-stream` Edge
-- Function writes WHEP URLs directly (see _shared/cloudflare.ts).
--
-- Viewer-side: the CloudflareStreamPlayer component implements a
-- minimal WHEP client (RTCPeerConnection, recvonly transceivers,
-- SDP POST) and renders the remote MediaStream into a native
-- `<video>` element. Trade-off vs. the iframe: we manage the player
-- chrome ourselves now (mute / fullscreen / volume), but viewer
-- autoplay no longer has the cross-origin-iframe iOS Safari snag.

update public.events
set playback_url = replace(playback_url, '/iframe', '/webRTC/play')
where playback_url is not null
  and playback_url like '%/iframe%';
