-- LiveRush — publish_event has been quietly skipping betting_closes_at
-- on the "Go live now" path the whole time.
--
-- Flow that surfaced the bug:
--   1. Creator clicks Publish in EventEditor with "schedule for later"
--      OFF, so scheduled_at = now() and the goal is "go live
--      immediately + start streaming".
--   2. provision-stream Edge Function calls publish_event(eventId).
--   3. publish_event sees scheduled_at <= now() and flips status
--      directly to 'live' — without touching betting_opens_at or
--      betting_closes_at.
--   4. Studio LiveStream loads, status is already 'live', so the
--      "if status==scheduled then start_event" branch never fires.
--      betting_closes_at stays null forever → no countdown timer.
--
-- start_event is the only existing path that stamps the betting
-- window timestamps. Anything else that takes an event to 'live'
-- needs to mirror that work; otherwise the timer never appears for
-- streamers OR viewers.
--
-- Fix: when publish_event flips straight to 'live', stamp the
-- betting window the same way start_event does — defaulting
-- betting_window_minutes to 10 if it's null (matches start_event's
-- coalesce in 20260529_000008_backfill_betting_window.sql).
--
-- Backfill: any live event currently missing betting_closes_at gets
-- the same start_event-style stamp. Same idempotent SQL as 000008's
-- backfill section — re-running it is safe because coalesce()
-- preserves any non-null values.

-- =========================================================================
-- 1) Patch publish_event to stamp betting timestamps on the go-live path
-- =========================================================================

create or replace function public.publish_event(p_event_id text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid;
  v_creator_status text;
  v_outcome_count  integer;
  v_scheduled_at   timestamptz;
  v_window_min     integer;
  v_new_status     text;
  v_row            public.events;
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
    raise exception 'Your account must be verified to publish events'
      using errcode = '42501';
  end if;

  select scheduled_at, coalesce(betting_window_minutes, 10)
    into v_scheduled_at, v_window_min
  from public.events
  where id = p_event_id and creator_id = v_user_id and status = 'draft';
  if v_scheduled_at is null then
    raise exception 'Event not found or not in draft state' using errcode = '42501';
  end if;

  select count(*) into v_outcome_count
  from public.event_outcomes where event_id = p_event_id;
  if v_outcome_count < 2 then
    raise exception 'Event needs at least 2 outcomes before publishing'
      using errcode = '22023';
  end if;

  v_new_status := case when v_scheduled_at <= now() then 'live' else 'scheduled' end;

  -- The branched update keeps the scheduled path unchanged (no
  -- timestamps stamped yet — they get filled in when the creator
  -- later hits Start camera → start_event), but on the go-live path
  -- we stamp betting_opens_at + betting_closes_at the same way
  -- start_event would.
  if v_new_status = 'live' then
    update public.events
    set status            = 'live',
        started_at        = coalesce(started_at, now()),
        betting_opens_at  = coalesce(betting_opens_at, now()),
        betting_closes_at = coalesce(
                              betting_closes_at,
                              now() + make_interval(mins => v_window_min)
                            )
    where id = p_event_id and creator_id = v_user_id and status = 'draft'
    returning * into v_row;
  else
    update public.events
    set status     = 'scheduled',
        started_at = null
    where id = p_event_id and creator_id = v_user_id and status = 'draft'
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.publish_event(text) to authenticated;

-- =========================================================================
-- 2) Backfill any live events still missing betting_closes_at
-- =========================================================================
-- Same shape as 20260529_000008 but covers events that went through
-- the unpatched publish_event between then and now.

update public.events
set
  betting_opens_at  = coalesce(betting_opens_at, started_at, now()),
  betting_closes_at = coalesce(
    betting_closes_at,
    coalesce(started_at, now())
      + make_interval(mins => coalesce(betting_window_minutes, 10))
  )
where status in ('live', 'pending_moderation')
  and betting_closes_at is null;

notify pgrst, 'reload schema';
