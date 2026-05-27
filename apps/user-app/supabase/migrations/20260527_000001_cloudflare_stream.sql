-- LiveRush — pivot from Mux to Cloudflare Stream.
--
-- Mux only ingests RTMP; browsers can't speak RTMP natively, so the
-- WHIP path we built can't terminate at Mux. Cloudflare Stream takes
-- WHIP directly and serves the same standard HLS to viewers — clean
-- swap, no architectural change to the app.
--
-- The trust split stays exactly the same:
--   • events.playback_url — public-readable (HLS manifest URL, fine to
--     hand to anonymous viewers).
--   • event_streams.{cf_input_uid, whip_url} — creator-only. The WHIP
--     URL contains the publish secret in the path, so it must stay
--     behind the RLS policy below.
--
-- Cloudflare's WHIP URL is per-input and embeds the publish secret —
-- there's no separate stream_key, so the old `mux_stream_key` column
-- gets dropped entirely. The `cf_input_uid` is the value we hand to
-- Cloudflare's API for end-of-stream cleanup.

-- =========================================================================
-- 1) events — rename mux_playback_id → playback_url
-- =========================================================================

-- The old column held a Mux playback id; the new column holds a fully-
-- formed HLS URL (Cloudflare prefixes per-customer, so the URL changes
-- per-account anyway — easier to store the full URL than reconstruct
-- it client-side). Rename keeps existing row values intact; the next
-- provision-stream call will overwrite with the new URL shape.
alter table public.events
  rename column mux_playback_id to playback_url;

-- =========================================================================
-- 2) event_streams — Mux columns out, Cloudflare columns in
-- =========================================================================

-- Drop the old supporting index first (it referenced mux_live_stream_id).
drop index if exists public.event_streams_live_stream_idx;

-- Rename the live-stream id column. Cloudflare calls these "live inputs"
-- and the UID is what we pass to DELETE /live_inputs/{uid} on end.
alter table public.event_streams
  rename column mux_live_stream_id to cf_input_uid;

-- The stream key is now baked into the whip_url path on Cloudflare —
-- no separate value to store.
alter table public.event_streams
  drop column if exists mux_stream_key;

-- Recreate the index against the new column name; the mux-webhook
-- handler looked rows up by live_stream_id, the cloudflare equivalent
-- (when we build it) will look up by cf_input_uid.
create index if not exists event_streams_cf_input_idx
  on public.event_streams(cf_input_uid);

-- =========================================================================
-- 3) get_stream_credentials RPC — return whip_url + playback_url
-- =========================================================================
--
-- The Mux variant returned (whip_url, stream_key, playback_id) — three
-- separate fields the studio had to combine. The Cloudflare path is
-- simpler: the WHIP URL is self-contained (auth in the URL), and the
-- playback URL is a full HLS manifest URL ready for hls.js.
--
-- Drop the old function signature explicitly so PostgREST doesn't trip
-- over an overloaded resolution later.

drop function if exists public.get_stream_credentials(text);

create function public.get_stream_credentials(p_event_id text)
returns table (
  whip_url      text,
  playback_url  text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  return query
  select
    es.whip_url,
    e.playback_url
  from public.event_streams es
  join public.events e on e.id = es.event_id
  where es.event_id = p_event_id
    and e.creator_id = v_user_id
    and e.status in ('scheduled', 'live');

  if not found then
    raise exception 'Stream credentials unavailable for this event'
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.get_stream_credentials(text)
  to authenticated;

-- Refresh the PostgREST schema cache so the RPC's new return shape is
-- picked up without waiting for the slow background reload.
notify pgrst, 'reload schema';
