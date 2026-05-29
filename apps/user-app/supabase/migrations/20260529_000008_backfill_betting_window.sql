-- LiveRush — backfill betting_closes_at on already-live events that
-- somehow missed start_event's stamp, and make start_event itself
-- self-healing so it can be called from the studio on any
-- scheduled-or-live event without skipping.
--
-- Why this bug existed: start_event used to gate on `status =
-- 'scheduled'`. If the event was already flipped to `live` (e.g. the
-- streamer's studio session crashed mid-start and they re-entered the
-- LiveStream page on a different device, or the data fetch returned
-- live before handleStart ran), start_event was skipped — and the
-- `betting_closes_at` column stayed NULL forever. The user-app then
-- can't render the countdown because the conditional checks
-- `event.bettingClosesAt`.

-- =========================================================================
-- 1) Backfill: for every live event whose closes_at is missing, stamp
--    it using started_at + betting_window_minutes (or +10 min default).
--    Seed events (no creator_id) get the same backfill so demo viewer
--    sessions also see a ticking countdown.
-- =========================================================================

update public.events
set
  betting_opens_at = coalesce(
    betting_opens_at,
    started_at,
    now()
  ),
  betting_closes_at = coalesce(
    betting_closes_at,
    coalesce(started_at, now())
      + make_interval(mins => coalesce(betting_window_minutes, 10))
  )
where status in ('live', 'pending_moderation')
  and betting_closes_at is null;

-- =========================================================================
-- 2) Make start_event idempotent — accept already-live events and
--    just patch missing timestamps, instead of raising. Studio can
--    safely call it on a refresh / reconnect path.
-- =========================================================================

create or replace function public.start_event(p_event_id text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_creator_status text;
  v_window_min integer;
  v_current_status text;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select status into v_creator_status
  from public.creator_profiles where id = v_user_id;
  if v_creator_status is null then
    raise exception 'Creator profile not found' using errcode = 'P0002';
  end if;
  if v_creator_status <> 'verified' then
    raise exception 'Your account must be verified to start an event'
      using errcode = '42501';
  end if;

  -- Verify ownership + grab the current state for the switch below.
  select status, coalesce(betting_window_minutes, 10)
    into v_current_status, v_window_min
  from public.events
  where id = p_event_id and creator_id = v_user_id;

  if v_current_status is null then
    raise exception 'Event not found or not yours' using errcode = '42501';
  end if;

  if v_current_status not in ('scheduled', 'live') then
    raise exception 'Event must be scheduled or live to start (got %)', v_current_status
      using errcode = '42501';
  end if;

  -- Flip to live + stamp the betting window. coalesce() means re-calls
  -- on already-live events only patch missing timestamps and leave
  -- existing ones alone (idempotent).
  update public.events
  set status            = 'live',
      started_at        = coalesce(started_at, now()),
      betting_opens_at  = coalesce(betting_opens_at, now()),
      betting_closes_at = coalesce(
                            betting_closes_at,
                            now() + make_interval(mins => v_window_min)
                          )
  where id = p_event_id
    and creator_id = v_user_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.start_event(text) to authenticated;

notify pgrst, 'reload schema';
