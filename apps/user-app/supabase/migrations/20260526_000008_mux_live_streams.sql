-- LiveRush — Mux Video integration: per-event live-stream credentials.
--
-- Splits the data along trust boundaries:
--
--   • `events.mux_playback_id` — public-readable (anyone with the column
--     value can build a Mux HLS URL). Lives on `events` so the existing
--     `Public reads non-draft events` RLS policy makes it visible to
--     anon viewers without extra plumbing.
--
--   • `event_streams.{mux_live_stream_id, mux_stream_key, whip_url}` —
--     creator-only. Anyone who gets the stream_key can publish on
--     behalf of the creator, so it must NEVER leak. New table with
--     restrictive RLS: only the owning creator can read.
--
-- Writes to event_streams are handled by the Edge Functions running
-- with the service-role key (which bypasses RLS); the SQL layer
-- doesn't grant INSERT/UPDATE/DELETE to authenticated users.

-- =========================================================================
-- 1) events.mux_playback_id
-- =========================================================================

alter table public.events
  add column if not exists mux_playback_id text;

-- =========================================================================
-- 2) event_streams — per-event Mux state, creator-only
-- =========================================================================

create table if not exists public.event_streams (
  event_id            text primary key
                      references public.events(id) on delete cascade,
  mux_live_stream_id  text not null,
  mux_stream_key      text not null,
  whip_url            text not null,
  created_at          timestamptz not null default now()
);

create index if not exists event_streams_live_stream_idx
  on public.event_streams(mux_live_stream_id);

alter table public.event_streams enable row level security;

-- Read: only the owning creator. The webhook + Edge Functions use the
-- service-role key, which bypasses RLS entirely; this policy only
-- governs direct client reads (e.g. the studio fetching its own row
-- via the get_stream_credentials RPC below).
drop policy if exists "Creator reads own event_streams" on public.event_streams;
create policy "Creator reads own event_streams"
  on public.event_streams
  for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_streams.event_id
        and e.creator_id = auth.uid()
    )
  );

-- No INSERT / UPDATE / DELETE policies — writes are done only by the
-- Edge Functions with service-role.

-- =========================================================================
-- 3) get_stream_credentials RPC
--    Returns the WHIP url + stream_key for a specific event, but ONLY
--    when called by the event's creator and the event is in a
--    streamable status. Used by the studio's LiveStream page at the
--    moment the creator clicks "Start stream".
-- =========================================================================

create or replace function public.get_stream_credentials(p_event_id text)
returns table (
  whip_url       text,
  stream_key     text,
  playback_id    text
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
    es.mux_stream_key,
    e.mux_playback_id
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
