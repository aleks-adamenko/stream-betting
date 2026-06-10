-- LiveRush — lower betting minimums + move the betting window to seconds.
--
-- Three operator-driven tuning changes, plus the second-based betting
-- window that underpins the new live-round UX:
--
--   1. min_unique_bettors 3 → 2. Easier to clear settlement with a
--      small audience.
--   2. Effective MIN_POOL $30 → $20. The floor alone wasn't the binding
--      term — `min_pool = greatest(MAX_BET × multiplier, n × MIN_BET,
--      floor)` and MAX_BET($10) × 3 = $30 dominated. Dropping BOTH the
--      multiplier (3 → 2) and the floor ($30 → $20) makes the effective
--      minimum land on $20 for a typical event.
--   3. Betting window expressed in SECONDS (min 10s, default 60s, max
--      1800s / 30 min) instead of integer minutes (5–30). A new
--      `betting_window_seconds` column becomes the runtime source of
--      truth; every place that stamped `betting_closes_at` via
--      `make_interval(mins => …)` now uses `make_interval(secs => …)`.
--
-- settle_round (20260608_000004) and get_event_progress (20260608_000001)
-- already read the bettor / multiplier / floor values straight from
-- get_betting_constants(), so #1 and #2 propagate to settlement AND the
-- live readiness gauges with no further edits.

begin;

-- ---------------------------------------------------------------------------
-- 1. get_betting_constants — lower bettors + pool, window OUT cols → seconds
-- ---------------------------------------------------------------------------
-- Drop+recreate because two OUT column names change. Callers
-- (place_bet / settle_round / get_event_progress) destructure by name
-- and reference only the columns they need, none of which are the
-- renamed window columns — so they keep working unchanged.

drop function if exists public.get_betting_constants();

create or replace function public.get_betting_constants()
returns table (
  min_bet_cents                integer,
  max_bet_cents                integer,
  max_round_stake_cents        integer,
  max_odds_cap                 numeric,
  rake_bps                     integer,
  rake_platform_bps            integer,
  rake_streamer_bps            integer,
  min_unique_bettors           integer,
  min_outcomes_with_bets       integer,
  betting_window_min_sec       integer,
  betting_window_max_sec       integer,
  daily_cap_cents              integer,
  min_pool_max_bet_multiplier  integer,
  min_pool_floor_cents         integer,
  stale_result_grace_minutes   integer
)
language sql
immutable
as $$
  select
    100        as min_bet_cents,
    1000       as max_bet_cents,            -- $10 per-outcome ceiling
    3000       as max_round_stake_cents,    -- $30 aggregate per round
    15.0::numeric as max_odds_cap,
    1000       as rake_bps,
    500        as rake_platform_bps,
    500        as rake_streamer_bps,
    2          as min_unique_bettors,       -- was 3
    2          as min_outcomes_with_bets,
    10         as betting_window_min_sec,   -- was 5 (minutes)
    1800       as betting_window_max_sec,   -- was 30 (minutes)
    10000      as daily_cap_cents,
    2          as min_pool_max_bet_multiplier,  -- was 3  ($10×2 = $20)
    2000       as min_pool_floor_cents,         -- was 3000  ($20)
    15         as stale_result_grace_minutes;
$$;
grant execute on function public.get_betting_constants() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. betting_window_seconds column + backfill
-- ---------------------------------------------------------------------------
-- New authoritative window column. The legacy betting_window_minutes
-- column is left in place (no longer read at runtime) so nothing that
-- still selects it breaks mid-deploy.

alter table public.events
  add column if not exists betting_window_seconds integer
    check (betting_window_seconds is null
           or betting_window_seconds between 10 and 1800);

comment on column public.events.betting_window_seconds is
  'Betting window length in seconds (10–1800). Runtime source of truth '
  'for betting_closes_at. Supersedes the legacy betting_window_minutes '
  'column. NULL → functions fall back to 60s.';

-- One-time conversion from the old minutes column.
update public.events
set betting_window_seconds = coalesce(betting_window_minutes, 10) * 60
where betting_window_seconds is null;

-- ---------------------------------------------------------------------------
-- 3. set_event_betting_window — minutes → seconds
-- ---------------------------------------------------------------------------
-- Param NAME changes (p_minutes → p_seconds), so create-or-replace
-- can't be used — drop first. Writes betting_window_seconds only; the
-- legacy minutes column is intentionally left untouched (its 5–30 CHECK
-- can't represent a 10s window anyway).

drop function if exists public.set_event_betting_window(text, integer);

create or replace function public.set_event_betting_window(
  p_event_id text,
  p_seconds  integer
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_seconds is not null and (p_seconds < 10 or p_seconds > 1800) then
    raise exception 'Betting window must be between 10 and 1800 seconds'
      using errcode = '22023';
  end if;

  update public.events
  set betting_window_seconds = p_seconds
  where id = p_event_id
    and creator_id = v_user_id
    and status in ('draft', 'scheduled')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not editable'
      using errcode = '42501';
  end if;
  return v_row;
end;
$$;
grant execute on function public.set_event_betting_window(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. start_event — stamp betting_closes_at from seconds
-- ---------------------------------------------------------------------------
-- Mirrors 20260529_000008 line-for-line except it reads
-- betting_window_seconds (coalesce 60) and uses make_interval(secs=>).

create or replace function public.start_event(p_event_id text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_creator_status text;
  v_window_secs integer;
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

  select status, coalesce(betting_window_seconds, 60)
    into v_current_status, v_window_secs
  from public.events
  where id = p_event_id and creator_id = v_user_id;

  if v_current_status is null then
    raise exception 'Event not found or not yours' using errcode = '42501';
  end if;

  if v_current_status not in ('scheduled', 'live') then
    raise exception 'Event must be scheduled or live to start (got %)', v_current_status
      using errcode = '42501';
  end if;

  update public.events
  set status            = 'live',
      started_at        = coalesce(started_at, now()),
      betting_opens_at  = coalesce(betting_opens_at, now()),
      betting_closes_at = coalesce(
                            betting_closes_at,
                            now() + make_interval(secs => v_window_secs)
                          )
  where id = p_event_id
    and creator_id = v_user_id
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.start_event(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. publish_event — go-live path stamps betting_closes_at from seconds
-- ---------------------------------------------------------------------------

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
  v_window_secs    integer;
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

  select scheduled_at, coalesce(betting_window_seconds, 60)
    into v_scheduled_at, v_window_secs
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

  if v_new_status = 'live' then
    update public.events
    set status            = 'live',
        started_at        = coalesce(started_at, now()),
        betting_opens_at  = coalesce(betting_opens_at, now()),
        betting_closes_at = coalesce(
                              betting_closes_at,
                              now() + make_interval(secs => v_window_secs)
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

-- ---------------------------------------------------------------------------
-- 6. advance_round — reopen next window from seconds
-- ---------------------------------------------------------------------------

create or replace function public.advance_round(
  p_event_id        text,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event public.events%rowtype;
  v_settle_result json;
  v_window_secs integer;
  v_next_round integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;
  if v_event.creator_id is null or v_event.creator_id <> v_user_id then
    raise exception 'Only the event creator can advance rounds'
      using errcode = '42501';
  end if;
  if v_event.round_format <> 'multi' then
    raise exception 'advance_round only applies to multi-round events'
      using errcode = '22023';
  end if;
  if v_event.status <> 'live' then
    raise exception 'Event must be live to advance rounds (got %)', v_event.status
      using errcode = '22023';
  end if;
  if v_event.is_final_round then
    raise exception 'This event has already been marked as final — call finish_event next'
      using errcode = '22023';
  end if;

  -- Settle current round (winners may already be on the row, or it
  -- may auto-refund if minimums aren't met).
  v_settle_result := public.settle_round(
    p_event_id, v_event.current_round, p_idempotency_key
  );

  -- Reset per-round state and open the next betting window.
  v_next_round := v_event.current_round + 1;
  v_window_secs := coalesce(v_event.betting_window_seconds, 60);

  update public.event_outcomes set pool_cents = 0 where event_id = p_event_id;

  update public.events
  set current_round         = v_next_round,
      winning_outcome_ids   = null,
      betting_opens_at      = now(),
      betting_closes_at     = now() + make_interval(secs => v_window_secs),
      betting_window_closed_at = null
  where id = p_event_id;

  return json_build_object(
    'event_id', p_event_id,
    'previous_round', v_event.current_round,
    'current_round', v_next_round,
    'settlement', v_settle_result,
    'betting_window_seconds', v_window_secs
  );
end;
$$;
grant execute on function public.advance_round(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. mark_final_round — settle + advance + reopen final window from seconds
-- ---------------------------------------------------------------------------

create or replace function public.mark_final_round(
  p_event_id        text,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event public.events%rowtype;
  v_settle_result json;
  v_window_secs integer;
  v_next_round integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;
  if v_event.creator_id is null or v_event.creator_id <> v_user_id then
    raise exception 'Only the event creator can mark the final round'
      using errcode = '42501';
  end if;
  if v_event.round_format <> 'multi' then
    raise exception 'mark_final_round only applies to multi-round events'
      using errcode = '22023';
  end if;
  if v_event.status <> 'live' then
    raise exception 'Event must be live to mark final round (got %)', v_event.status
      using errcode = '22023';
  end if;
  if v_event.is_final_round then
    raise exception 'This event is already marked as final'
      using errcode = '22023';
  end if;

  -- Settle the round we're leaving (may auto-refund if minimums
  -- weren't met). Same call advance_round uses.
  v_settle_result := public.settle_round(
    p_event_id, v_event.current_round, p_idempotency_key
  );

  -- Advance to the next round AND mark it as the final one. Fresh
  -- pools, fresh betting window, no carried-over winning_outcome_ids
  -- from the just-settled round.
  v_next_round := v_event.current_round + 1;
  v_window_secs := coalesce(v_event.betting_window_seconds, 60);

  update public.event_outcomes set pool_cents = 0 where event_id = p_event_id;

  update public.events
  set current_round            = v_next_round,
      is_final_round           = true,
      winning_outcome_ids      = null,
      betting_opens_at         = now(),
      betting_closes_at        = now() + make_interval(secs => v_window_secs),
      betting_window_closed_at = null
  where id = p_event_id;

  return json_build_object(
    'event_id', p_event_id,
    'previous_round', v_event.current_round,
    'current_round', v_next_round,
    'is_final_round', true,
    'settlement', v_settle_result,
    'betting_window_seconds', v_window_secs
  );
end;
$$;
grant execute on function public.mark_final_round(text, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
