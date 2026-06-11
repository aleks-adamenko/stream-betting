-- LiveRush — admin-editable betting parameters.
--
-- Until now every betting limit, minimum, rake split, odds cap, and
-- window bound was a hardcoded literal: server-side inside the
-- `immutable` get_betting_constants() (latest def 20260610_000006) plus
-- one inline min_payout floor in request_payout, and client-side as
-- static @liverush/lib constants. Tuning any of them meant a code change
-- + migration + redeploy.
--
-- This migration makes the SERVER source of those numbers a singleton
-- config table that an admin can edit through gated RPCs, while keeping
-- in-flight events on the rules they started with. The mechanism:
--
--   1. `betting_config` — one editable row, with table-level CHECK
--      constraints encoding every cross-field guardrail. This is the
--      un-bypassable DB-level backstop: no write path (the RPC, a direct
--      SQL update, future code) can persist an invalid row.
--   2. get_betting_constants() flips from `immutable` literals to a
--      `stable security definer` read of that row (+ two new OUT cols:
--      betting_window_default_sec, min_payout_coins). Drop-in for every
--      existing caller, which destructure by name.
--   3. New events FREEZE the live config into events.betting_constants
--      (jsonb) at go-live; get_event_constants(event_id) returns the
--      snapshot-or-live. The settlement-critical reads (place_bet,
--      settle_round, get_event_progress, compute_live_odds) swap to the
--      snapshot so an in-flight event lives by its own rules end-to-end:
--      what the viewer sees == what place_bet/settlement enforce.
--   4. Admin get_betting_config() / update_betting_config() — is_admin()
--      gated, re-validate the same guardrails with friendly 22023
--      messages (the table CHECKs sit underneath as the hard backstop).
--
-- Saved changes therefore affect NEW events only; events already live
-- keep their frozen snapshot.

begin;

-- ---------------------------------------------------------------------------
-- 1. betting_config — singleton row + hard CHECK backstop
-- ---------------------------------------------------------------------------
-- `id` is pinned to 1 so there is exactly one row. RLS is enabled with
-- NO policies — all access goes through the security-definer RPCs below,
-- which is the equivalent of an "API on write" here (there is no edge
-- function for config). The CHECK constraints encode every invariant; a
-- direct `update public.betting_config set …` to a bad value is rejected
-- by the constraint (23514) even if it never goes through the RPC.

create table if not exists public.betting_config (
  id                           integer primary key default 1,

  -- Stake limits
  min_bet_cents                integer not null,
  max_bet_cents                integer not null,
  max_round_stake_cents        integer not null,

  -- Minimums
  min_unique_bettors           integer not null,
  min_outcomes_with_bets       integer not null,
  min_pool_max_bet_multiplier  integer not null,
  min_pool_floor_cents         integer not null,

  -- Odds & rake
  max_odds_cap                 numeric not null,
  rake_bps                     integer not null,
  rake_platform_bps            integer not null,
  rake_streamer_bps            integer not null,

  -- Betting window
  betting_window_min_sec       integer not null,
  betting_window_max_sec       integer not null,
  betting_window_default_sec   integer not null,

  -- Daily / payout
  daily_cap_cents              integer not null,
  min_payout_coins             integer not null,
  stale_result_grace_minutes   integer not null,

  -- Audit
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid,

  -- ---- guardrails (same-row invariants, so expressible as CHECK) ----
  constraint betting_config_singleton
    check (id = 1),
  constraint betting_config_positive
    check (
      min_bet_cents > 0 and max_bet_cents > 0 and max_round_stake_cents > 0
      and daily_cap_cents > 0 and min_payout_coins > 0
      and min_unique_bettors > 0 and min_outcomes_with_bets > 0
      and min_pool_max_bet_multiplier > 0 and stale_result_grace_minutes > 0
    ),
  constraint betting_config_stake_order
    check (min_bet_cents <= max_bet_cents
           and max_bet_cents <= max_round_stake_cents),
  constraint betting_config_rake_split
    check (rake_platform_bps + rake_streamer_bps = rake_bps),
  constraint betting_config_rake_range
    check (rake_bps between 0 and 10000
           and rake_platform_bps >= 0 and rake_streamer_bps >= 0),
  constraint betting_config_odds_cap
    check (max_odds_cap > 1),
  constraint betting_config_window_order
    check (betting_window_min_sec <= betting_window_default_sec
           and betting_window_default_sec <= betting_window_max_sec),
  constraint betting_config_window_bounds
    check (betting_window_min_sec >= 1 and betting_window_max_sec <= 1800),
  constraint betting_config_minimums
    check (min_unique_bettors >= 1 and min_outcomes_with_bets >= 2
           and min_pool_max_bet_multiplier >= 1 and min_pool_floor_cents >= 0),
  constraint betting_config_daily_cap
    check (daily_cap_cents >= max_round_stake_cents),
  constraint betting_config_payout_floor
    check (min_payout_coins >= 1 and stale_result_grace_minutes >= 1)
);

alter table public.betting_config enable row level security;
-- No policies on purpose: only SECURITY DEFINER RPCs touch this table.

-- Seed today's exact production values (from 20260610_000006 +
-- the inline request_payout floor of 1000 coins).
insert into public.betting_config (
  id,
  min_bet_cents, max_bet_cents, max_round_stake_cents,
  min_unique_bettors, min_outcomes_with_bets,
  min_pool_max_bet_multiplier, min_pool_floor_cents,
  max_odds_cap, rake_bps, rake_platform_bps, rake_streamer_bps,
  betting_window_min_sec, betting_window_max_sec, betting_window_default_sec,
  daily_cap_cents, min_payout_coins, stale_result_grace_minutes
) values (
  1,
  100, 1000, 3000,
  2, 2,
  2, 2000,
  15.0, 1000, 500, 500,
  10, 1800, 60,
  10000, 1000, 15
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. events.betting_constants — per-event frozen snapshot
-- ---------------------------------------------------------------------------
-- Stamped at go-live (see start_event / publish_event below). Null on
-- older / not-yet-started events → get_event_constants falls back to the
-- live config.

alter table public.events
  add column if not exists betting_constants jsonb;

comment on column public.events.betting_constants is
  'Frozen snapshot of get_betting_constants() taken at go-live. NULL → '
  'fall back to the live config. Makes an in-flight event immune to '
  'later admin edits (it lives by its own rules end-to-end).';

-- ---------------------------------------------------------------------------
-- 3. get_betting_constants — literals → table read (+2 OUT columns)
-- ---------------------------------------------------------------------------
-- Drop+recreate: the OUT column set changes (two appended) and the
-- volatility/security flips immutable → stable security definer (the
-- table read needs security definer so anon keeps working without a
-- public policy on betting_config). Existing callers destructure by name
-- and use subsets, so the two appended columns are safe.

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
  stale_result_grace_minutes   integer,
  betting_window_default_sec   integer,
  min_payout_coins             integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.min_bet_cents,
    c.max_bet_cents,
    c.max_round_stake_cents,
    c.max_odds_cap,
    c.rake_bps,
    c.rake_platform_bps,
    c.rake_streamer_bps,
    c.min_unique_bettors,
    c.min_outcomes_with_bets,
    c.betting_window_min_sec,
    c.betting_window_max_sec,
    c.daily_cap_cents,
    c.min_pool_max_bet_multiplier,
    c.min_pool_floor_cents,
    c.stale_result_grace_minutes,
    c.betting_window_default_sec,
    c.min_payout_coins
  from public.betting_config c
  where c.id = 1;
$$;
grant execute on function public.get_betting_constants() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_event_constants — snapshot-or-live, same shape as constants
-- ---------------------------------------------------------------------------
-- For each field: the event's frozen snapshot value if present, else the
-- live config. LEFT JOIN events so an unknown / not-yet-started event id
-- still returns one row of live config (callers like place_bet read this
-- before the event-existence check).

create or replace function public.get_event_constants(p_event_id text)
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
  stale_result_grace_minutes   integer,
  betting_window_default_sec   integer,
  min_payout_coins             integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((e.betting_constants->>'min_bet_cents')::integer,                c.min_bet_cents),
    coalesce((e.betting_constants->>'max_bet_cents')::integer,                c.max_bet_cents),
    coalesce((e.betting_constants->>'max_round_stake_cents')::integer,        c.max_round_stake_cents),
    coalesce((e.betting_constants->>'max_odds_cap')::numeric,                 c.max_odds_cap),
    coalesce((e.betting_constants->>'rake_bps')::integer,                     c.rake_bps),
    coalesce((e.betting_constants->>'rake_platform_bps')::integer,            c.rake_platform_bps),
    coalesce((e.betting_constants->>'rake_streamer_bps')::integer,            c.rake_streamer_bps),
    coalesce((e.betting_constants->>'min_unique_bettors')::integer,           c.min_unique_bettors),
    coalesce((e.betting_constants->>'min_outcomes_with_bets')::integer,       c.min_outcomes_with_bets),
    coalesce((e.betting_constants->>'betting_window_min_sec')::integer,       c.betting_window_min_sec),
    coalesce((e.betting_constants->>'betting_window_max_sec')::integer,       c.betting_window_max_sec),
    coalesce((e.betting_constants->>'daily_cap_cents')::integer,              c.daily_cap_cents),
    coalesce((e.betting_constants->>'min_pool_max_bet_multiplier')::integer,  c.min_pool_max_bet_multiplier),
    coalesce((e.betting_constants->>'min_pool_floor_cents')::integer,         c.min_pool_floor_cents),
    coalesce((e.betting_constants->>'stale_result_grace_minutes')::integer,   c.stale_result_grace_minutes),
    coalesce((e.betting_constants->>'betting_window_default_sec')::integer,   c.betting_window_default_sec),
    coalesce((e.betting_constants->>'min_payout_coins')::integer,             c.min_payout_coins)
  from public.get_betting_constants() c
  left join public.events e on e.id = p_event_id;
$$;
grant execute on function public.get_event_constants(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. start_event — freeze the snapshot on the scheduled/live transition
-- ---------------------------------------------------------------------------
-- Identical to 20260610_000006 except the go-live UPDATE now also stamps
-- betting_constants = coalesce(betting_constants, <live config jsonb>),
-- so the snapshot is frozen on the FIRST transition to live and never
-- overwritten afterwards.

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
                          ),
      betting_constants = coalesce(
                            betting_constants,
                            (select to_jsonb(c) from public.get_betting_constants() c)
                          )
  where id = p_event_id
    and creator_id = v_user_id
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.start_event(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. publish_event — freeze the snapshot on the draft → live path
-- ---------------------------------------------------------------------------
-- Identical to 20260610_000006 except the `v_new_status = 'live'` UPDATE
-- now also stamps betting_constants. The scheduled branch does NOT go
-- live yet, so it snapshots later via start_event.

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
                            ),
        betting_constants = coalesce(
                              betting_constants,
                              (select to_jsonb(c) from public.get_betting_constants() c)
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
-- 7. place_bet — read the event SNAPSHOT instead of live config
-- ---------------------------------------------------------------------------
-- Byte-identical to 20260610_000003 except the constants read swaps
-- get_betting_constants() → get_event_constants(p_event_id), so the
-- enforced min/max/round-stake/rake/daily-cap match the event's frozen
-- snapshot (what the viewer was shown).

create or replace function public.place_bet(
  p_event_id        text,
  p_outcome_id      text,
  p_amount_cents    integer,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_balance bigint;
  v_event public.events%rowtype;
  v_outcome public.event_outcomes%rowtype;
  v_min integer;
  v_max integer;
  v_max_round_stake integer;
  v_rake_bps integer;
  v_daily_cap integer;
  v_bet_id uuid;
  v_existing_bet public.bets%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_day_total bigint;
  v_new_balance bigint;
  v_new_pool bigint;
  v_total_pool bigint;
  v_live_odds numeric;
  v_existing_round_stake bigint;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  -- Idempotency replay short-circuit. Unchanged.
  select * into v_existing_bet
  from public.bets
  where user_id = v_user_id
    and idempotency_key = p_idempotency_key;
  if v_existing_bet.id is not null then
    select coalesce(sum(pool_cents), 0) into v_total_pool
    from public.event_outcomes where event_id = v_existing_bet.event_id;
    select pool_cents into v_new_pool
    from public.event_outcomes where id = v_existing_bet.outcome_id;
    select balance_cents into v_new_balance from public.profiles where id = v_user_id;
    return json_build_object(
      'bet_id', v_existing_bet.id,
      'idempotent_replay', true,
      'new_balance_cents', v_new_balance,
      'live_odds', v_existing_bet.odds_snapshot,
      'total_pool_cents', v_total_pool,
      'outcome_pool_cents', v_new_pool,
      'round_index', v_existing_bet.round_index
    );
  end if;

  select min_bet_cents, max_bet_cents, max_round_stake_cents,
         rake_bps, daily_cap_cents
    into v_min, v_max, v_max_round_stake,
         v_rake_bps, v_daily_cap
  from public.get_event_constants(p_event_id);

  -- Per-bet MIN_BET / MAX_BET (per-OUTCOME ceiling). Each individual
  -- bet must sit between $1 and $10.
  if p_amount_cents < v_min then
    raise exception 'min_bet: stake must be ≥ % cents', v_min using errcode = '22023';
  end if;
  if p_amount_cents > v_max then
    raise exception 'max_bet: stake must be ≤ % cents (per outcome)', v_max
      using errcode = '22023';
  end if;

  select * into v_outcome from public.event_outcomes
  where id = p_outcome_id
  for update;
  if v_outcome.id is null then
    raise exception 'Outcome not found' using errcode = '23503';
  end if;
  if v_outcome.event_id <> p_event_id then
    raise exception 'Outcome does not belong to event' using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;

  if v_event.status <> 'live' then
    raise exception 'window_closed: event is not live' using errcode = '22023';
  end if;
  if v_event.betting_closes_at is not null and now() > v_event.betting_closes_at then
    raise exception 'window_closed: betting cutoff passed' using errcode = '22023';
  end if;
  if v_event.creator_id is not null and v_event.creator_id = v_user_id then
    raise exception 'Streamers cannot bet on their own event' using errcode = '42501';
  end if;

  -- Per-outcome uniqueness — DB-level UNIQUE INDEX
  -- (bets_user_event_round_outcome_active_uniq) is the backstop. The
  -- explicit EXISTS gives a friendlier error message.
  if exists (
    select 1 from public.bets
    where user_id = v_user_id
      and event_id = p_event_id
      and round_index = v_event.current_round
      and outcome_id = p_outcome_id
  ) then
    raise exception 'already_bet_outcome: you have already bet on this outcome this round'
      using errcode = '22023';
  end if;

  -- Aggregate MAX_ROUND_STAKE check. Sum the user's existing
  -- stakes in this round (any non-refunded status), add the incoming
  -- bet, compare to MAX_ROUND_STAKE. Pre-format both values via
  -- to_char() because Postgres `raise exception` doesn't grok
  -- printf-style precision specifiers.
  select coalesce(sum(amount_cents), 0) into v_existing_round_stake
  from public.bets
  where user_id = v_user_id
    and event_id = p_event_id
    and round_index = v_event.current_round
    and status in ('placed', 'open', 'won_pending_payout', 'won');

  if v_existing_round_stake + p_amount_cents > v_max_round_stake then
    raise exception 'max_round_stake_exceeded: total stake this round would be %, max is %',
      to_char((v_existing_round_stake + p_amount_cents)::numeric / 100, 'FM999990.00'),
      to_char(v_max_round_stake::numeric / 100, 'FM999990.00')
      using errcode = '22023';
  end if;

  -- Daily cap (stub KYC) — unchanged. Event-agnostic across all the
  -- user's bets in a single calendar day.
  select coalesce(total_cents, 0) into v_day_total
  from public.user_bet_caps where user_id = v_user_id and day = v_today;
  if coalesce(v_day_total, 0) + p_amount_cents > v_daily_cap then
    raise exception 'daily_cap_exceeded: % cents over daily limit',
      coalesce(v_day_total, 0) + p_amount_cents - v_daily_cap
      using errcode = '22023';
  end if;

  select balance_cents into v_balance
  from public.profiles where id = v_user_id
  for update;
  if v_balance is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if v_balance < p_amount_cents then
    raise exception 'insufficient_balance' using errcode = '22023';
  end if;

  update public.profiles
  set balance_cents = balance_cents - p_amount_cents
  where id = v_user_id;
  v_new_balance := v_balance - p_amount_cents;

  update public.event_outcomes
  set pool_cents = pool_cents + p_amount_cents
  where id = p_outcome_id
  returning pool_cents into v_new_pool;

  select coalesce(sum(pool_cents), 0) into v_total_pool
  from public.event_outcomes where event_id = p_event_id;
  v_live_odds := case
    when v_new_pool = 0 or v_total_pool = 0 then null
    else round(
      (v_total_pool::numeric * (10000 - v_rake_bps) / 10000.0) / v_new_pool::numeric,
      2
    )
  end;

  insert into public.bets (
    user_id, event_id, outcome_id, amount_cents, odds_decimal,
    odds_snapshot, status, idempotency_key, round_index
  ) values (
    v_user_id, p_event_id, p_outcome_id, p_amount_cents,
    coalesce(v_live_odds, 1.01),
    v_live_odds, 'placed', p_idempotency_key, v_event.current_round
  )
  returning id into v_bet_id;

  insert into public.ledger_entries (account, type, amount_cents, balance_after_cents, reference_id)
  values
    ('user:' || v_user_id::text, 'bet', -p_amount_cents, v_new_balance, v_bet_id::text),
    ('event_pool:' || p_event_id, 'bet', p_amount_cents, v_total_pool, v_bet_id::text);

  insert into public.user_bet_caps (user_id, day, total_cents)
  values (v_user_id, v_today, p_amount_cents)
  on conflict (user_id, day) do update
    set total_cents = user_bet_caps.total_cents + excluded.total_cents;

  return json_build_object(
    'bet_id', v_bet_id,
    'idempotent_replay', false,
    'new_balance_cents', v_new_balance,
    'live_odds', v_live_odds,
    'total_pool_cents', v_total_pool,
    'outcome_pool_cents', v_new_pool,
    'round_index', v_event.current_round
  );
end;
$$;
grant execute on function public.place_bet(text, text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. settle_round — read the event SNAPSHOT instead of live config
-- ---------------------------------------------------------------------------
-- Byte-identical to 20260608_000004 except the constants read swaps
-- get_betting_constants() → get_event_constants(p_event_id), so rake /
-- odds cap / minimums / min-pool used at settlement match the snapshot.

create or replace function public.settle_round(
  p_event_id        text,
  p_round_index     integer,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_total bigint;
  v_winning_pool bigint;
  v_rake bigint;
  v_rake_streamer bigint;
  v_rake_platform bigint;
  v_distributable bigint;
  v_capped_odds numeric;
  v_payout_sum bigint := 0;
  v_residual bigint;
  v_min_unique_bettors integer;
  v_min_outcomes integer;
  v_rake_bps integer;
  v_rake_streamer_bps integer;
  v_max_odds numeric;
  v_unique_bettors integer;
  v_outcomes_with_bets integer;
  v_payout_id uuid;
  v_payout_count integer := 0;
  b record;
  v_winner_total bigint;
  v_min_bet integer;
  v_max_bet integer;
  v_min_pool_multiplier integer;
  v_min_pool_floor integer;
  v_num_outcomes integer;
  v_min_pool bigint;
  v_refund_count integer;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;

  if exists (
    select 1 from public.payouts
    where event_id = p_event_id and idempotency_key = p_idempotency_key
  ) then
    return json_build_object(
      'idempotent_replay', true,
      'event_id', p_event_id,
      'round_index', p_round_index
    );
  end if;

  select rake_bps, rake_streamer_bps, max_odds_cap,
         min_unique_bettors, min_outcomes_with_bets,
         min_bet_cents, max_bet_cents,
         min_pool_max_bet_multiplier, min_pool_floor_cents
    into v_rake_bps, v_rake_streamer_bps, v_max_odds,
         v_min_unique_bettors, v_min_outcomes,
         v_min_bet, v_max_bet,
         v_min_pool_multiplier, v_min_pool_floor
  from public.get_event_constants(p_event_id);

  select count(distinct user_id), count(distinct outcome_id)
    into v_unique_bettors, v_outcomes_with_bets
  from public.bets
  where event_id = p_event_id
    and round_index = p_round_index
    and status = 'placed';

  if coalesce(v_unique_bettors, 0) < v_min_unique_bettors
     or coalesce(v_outcomes_with_bets, 0) < v_min_outcomes then
    v_refund_count := public.refund_round(p_event_id, p_round_index);
    return json_build_object(
      'refunded', true,
      'reason', 'minimums_not_met',
      'unique_bettors', coalesce(v_unique_bettors, 0),
      'outcomes_with_bets', coalesce(v_outcomes_with_bets, 0),
      'refund_count', v_refund_count,
      'round_index', p_round_index
    );
  end if;

  select coalesce(sum(amount_cents), 0) into v_total
  from public.bets
  where event_id = p_event_id
    and round_index = p_round_index
    and status = 'placed';

  select count(*) into v_num_outcomes
  from public.event_outcomes where event_id = p_event_id;
  v_min_pool := greatest(
    (v_max_bet * v_min_pool_multiplier)::bigint,
    (v_num_outcomes * v_min_bet)::bigint,
    v_min_pool_floor::bigint
  );
  if v_total < v_min_pool then
    v_refund_count := public.refund_round(p_event_id, p_round_index);
    return json_build_object(
      'refunded', true,
      'reason', 'min_pool',
      'total_pool_cents', v_total,
      'min_pool_cents', v_min_pool,
      'refund_count', v_refund_count,
      'round_index', p_round_index
    );
  end if;

  if v_event.winning_outcome_ids is null
     or array_length(v_event.winning_outcome_ids, 1) is null then
    raise exception 'No winning outcomes declared for round %', p_round_index
      using errcode = '22023';
  end if;

  select coalesce(sum(amount_cents), 0) into v_winning_pool
  from public.bets
  where event_id = p_event_id
    and round_index = p_round_index
    and outcome_id = any(v_event.winning_outcome_ids)
    and status = 'placed';

  if v_winning_pool = 0 then
    v_refund_count := public.refund_round(p_event_id, p_round_index);
    return json_build_object(
      'refunded', true,
      'reason', 'no_bets_on_winner',
      'refund_count', v_refund_count,
      'round_index', p_round_index
    );
  end if;

  v_rake := (v_total * v_rake_bps) / 10000;
  v_rake_streamer := (v_total * v_rake_streamer_bps) / 10000;
  v_rake_platform := v_rake - v_rake_streamer;
  v_distributable := v_total - v_rake;
  v_capped_odds := least(v_max_odds, v_distributable::numeric / v_winning_pool::numeric);

  for b in
    select * from public.bets
    where event_id = p_event_id
      and round_index = p_round_index
      and outcome_id = any(v_event.winning_outcome_ids)
      and status = 'placed'
  loop
    v_winner_total := floor(b.amount_cents::numeric * v_capped_odds)::bigint;
    if v_winner_total < 0 then v_winner_total := 0; end if;
    v_payout_sum := v_payout_sum + v_winner_total;

    insert into public.payouts (
      type, recipient_id, recipient_kind, amount_cents,
      event_id, bet_id, status, idempotency_key, round_index
    ) values (
      'winner', b.user_id, 'viewer', v_winner_total,
      p_event_id, b.id, 'pending',
      public.derive_payout_key(p_idempotency_key, b.id::text),
      p_round_index
    )
    returning id into v_payout_id;

    update public.bets set status = 'won_pending_payout' where id = b.id;
    v_payout_count := v_payout_count + 1;

    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_winner_total, v_payout_id::text);
  end loop;

  update public.bets
  set status = 'lost', settled_at = now()
  where event_id = p_event_id
    and round_index = p_round_index
    and status = 'placed'
    and not (outcome_id = any(v_event.winning_outcome_ids));

  if v_rake_streamer > 0 and v_event.creator_id is not null then
    insert into public.payouts (
      type, recipient_id, recipient_kind, amount_cents,
      event_id, status, idempotency_key, round_index
    ) values (
      'rake_streamer', v_event.creator_id, 'streamer', v_rake_streamer,
      p_event_id, 'pending',
      public.derive_payout_key(p_idempotency_key, 'rake_streamer_r' || p_round_index),
      p_round_index
    )
    returning id into v_payout_id;
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_rake_streamer, v_payout_id::text);
  end if;

  if v_rake_platform > 0 then
    insert into public.payouts (
      type, recipient_kind, amount_cents,
      event_id, status, idempotency_key, round_index
    ) values (
      'rake_platform', 'platform', v_rake_platform,
      p_event_id, 'pending',
      public.derive_payout_key(p_idempotency_key, 'rake_platform_r' || p_round_index),
      p_round_index
    )
    returning id into v_payout_id;
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_rake_platform, v_payout_id::text);
  end if;

  v_residual := v_distributable - v_payout_sum;
  if v_residual > 0 then
    insert into public.payouts (
      type, recipient_kind, amount_cents,
      event_id, status, idempotency_key, round_index
    ) values (
      'residual', 'platform', v_residual,
      p_event_id, 'pending',
      public.derive_payout_key(p_idempotency_key, 'residual_r' || p_round_index),
      p_round_index
    )
    returning id into v_payout_id;
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_residual, v_payout_id::text);
  end if;

  return json_build_object(
    'refunded', false,
    'event_id', p_event_id,
    'round_index', p_round_index,
    'total_pool_cents', v_total,
    'min_pool_cents', v_min_pool,
    'winning_pool_cents', v_winning_pool,
    'rake_cents', v_rake,
    'distributable_cents', v_distributable,
    'capped_odds', v_capped_odds,
    'winner_payouts', v_payout_count,
    'residual_cents', greatest(v_residual, 0)
  );
end;
$$;
grant execute on function public.settle_round(text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. get_event_progress — read the event SNAPSHOT instead of live config
-- ---------------------------------------------------------------------------
-- Byte-identical to 20260608_000001 except the constants read swaps
-- get_betting_constants() → get_event_constants(p_event_id), so the
-- readiness gauge's minimums track the event's frozen snapshot.

create or replace function public.get_event_progress(p_event_id text)
returns table (
  unique_bettors_count        integer,
  outcomes_with_bets_count    integer,
  total_pool_cents            bigint,
  num_outcomes                integer,
  min_unique_bettors          integer,
  min_outcomes_with_bets      integer,
  min_pool_cents              bigint,
  minimums_met                boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min_unique integer;
  v_min_outcomes integer;
  v_min_bet integer;
  v_max_bet integer;
  v_min_pool_multiplier integer;
  v_min_pool_floor integer;
  v_num_outcomes integer;
  v_total_pool bigint;
  v_unique integer;
  v_outcomes_with_bets integer;
  v_min_pool bigint;
  v_current_round integer;
begin
  select c.min_unique_bettors, c.min_outcomes_with_bets,
         c.min_bet_cents, c.max_bet_cents,
         c.min_pool_max_bet_multiplier, c.min_pool_floor_cents
    into v_min_unique, v_min_outcomes,
         v_min_bet, v_max_bet,
         v_min_pool_multiplier, v_min_pool_floor
  from public.get_event_constants(p_event_id) as c;

  -- Per-round scoping. coalesce in case an event row predates the
  -- multi-round migration somehow (it shouldn't — the migration
  -- defaults the column — but defensive cheap).
  select coalesce(current_round, 1) into v_current_round
  from public.events where id = p_event_id;

  select count(*) into v_num_outcomes
  from public.event_outcomes where event_id = p_event_id;

  -- Pool is already per-round (event_outcomes.pool_cents is reset
  -- on advance_round) — no filter needed.
  select coalesce(sum(pool_cents), 0) into v_total_pool
  from public.event_outcomes where event_id = p_event_id;

  -- Unique bettors / distinct outcomes-with-bets must be scoped to
  -- the current round, otherwise prior-round winners keep counting.
  select
    count(distinct user_id)::integer,
    count(distinct outcome_id)::integer
    into v_unique, v_outcomes_with_bets
  from public.bets
  where event_id = p_event_id
    and round_index = v_current_round
    and status in ('placed', 'open', 'won_pending_payout', 'won');

  v_min_pool := greatest(
    (v_max_bet * v_min_pool_multiplier)::bigint,
    (v_num_outcomes * v_min_bet)::bigint,
    v_min_pool_floor::bigint
  );

  return query
    select
      coalesce(v_unique, 0),
      coalesce(v_outcomes_with_bets, 0),
      v_total_pool,
      v_num_outcomes,
      v_min_unique,
      v_min_outcomes,
      v_min_pool,
      (coalesce(v_unique, 0) >= v_min_unique
         and coalesce(v_outcomes_with_bets, 0) >= v_min_outcomes
         and v_total_pool >= v_min_pool);
end;
$$;
grant execute on function public.get_event_progress(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. compute_live_odds — read the event SNAPSHOT rake
-- ---------------------------------------------------------------------------
-- Byte-identical to 20260529_000001 except the rake read swaps
-- get_betting_constants() → get_event_constants(p_event_id), so an
-- in-flight event's indicative odds use the snapshot rake — matching
-- what settlement will actually pay.

create or replace function public.compute_live_odds(p_event_id text)
returns table (
  outcome_id        text,
  pool_cents        bigint,
  total_pool_cents  bigint,
  live_odds         numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_rake_bps integer;
begin
  select rake_bps into v_rake_bps from public.get_event_constants(p_event_id);

  select coalesce(sum(o.pool_cents), 0) into v_total
  from public.event_outcomes o
  where o.event_id = p_event_id;

  return query
    select
      o.id::text,
      o.pool_cents,
      v_total,
      case
        when o.pool_cents = 0 or v_total = 0 then null::numeric
        else round(
          (v_total::numeric * (10000 - v_rake_bps) / 10000.0) / o.pool_cents::numeric,
          2
        )
      end as live_odds
    from public.event_outcomes o
    where o.event_id = p_event_id
    order by o.sort_order asc, o.id asc;
end;
$$;
grant execute on function public.compute_live_odds(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. request_payout — read min_payout_coins from config
-- ---------------------------------------------------------------------------
-- Byte-identical to 20260604_000001 except the inline `< 1000` floor is
-- replaced by a read of get_betting_constants().min_payout_coins, so the
-- payout minimum is admin-tunable platform-wide. (Payout is not
-- event-scoped, so it reads the live config, not a snapshot.)

create or replace function public.request_payout(p_coins integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_cash_cents  bigint;
  v_new_balance bigint;
  v_payout_id   uuid;
  v_amount_cents bigint;
  v_min_payout_coins integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select min_payout_coins into v_min_payout_coins
  from public.get_betting_constants();

  if p_coins is null or p_coins < v_min_payout_coins then
    raise exception 'Minimum payout is % coins', v_min_payout_coins
      using errcode = '22023';
  end if;

  v_amount_cents := p_coins::bigint * 100;
  v_cash_cents := p_coins::bigint * 10;  -- 1 coin = 10 dollar cents ($0.10)

  -- Atomic debit guarded by the balance check inside the UPDATE — if
  -- the user doesn't have enough coins, no row matches and the RETURNING
  -- clause returns NULL.
  update public.profiles
    set balance_cents = balance_cents - v_amount_cents
    where id = v_user_id
      and balance_cents >= v_amount_cents
    returning balance_cents into v_new_balance;

  if v_new_balance is null then
    raise exception 'Insufficient balance' using errcode = '22023';
  end if;

  insert into public.payouts (
    type, recipient_id, recipient_kind, amount_cents,
    event_id, status
  ) values (
    'rake_streamer', v_user_id, 'streamer', v_amount_cents,
    null, 'pending'
  ) returning id into v_payout_id;

  insert into public.ledger_entries (
    account, type, amount_cents, balance_after_cents,
    amount_cash_cents, reference_id
  ) values (
    'user:' || v_user_id::text,
    'payout_request',
    -v_amount_cents,
    v_new_balance,
    -v_cash_cents,
    v_payout_id::text
  );

  return json_build_object(
    'payout_id', v_payout_id,
    'coins', p_coins,
    'cash_cents', v_cash_cents,
    'new_balance_cents', v_new_balance
  );
end;
$$;
grant execute on function public.request_payout(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Admin RPCs: get_betting_config / update_betting_config
-- ---------------------------------------------------------------------------
-- is_admin() gated. get returns the full row incl. audit columns;
-- update re-validates the SAME invariants the table CHECKs enforce, but
-- with friendly 22023 messages so the admin gets "rake split must equal
-- total" rather than a raw 23514. The CHECKs remain the hard backstop.

create or replace function public.get_betting_config()
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
  stale_result_grace_minutes   integer,
  betting_window_default_sec   integer,
  min_payout_coins             integer,
  updated_at                   timestamptz,
  updated_by                   uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select
    c.min_bet_cents, c.max_bet_cents, c.max_round_stake_cents, c.max_odds_cap,
    c.rake_bps, c.rake_platform_bps, c.rake_streamer_bps,
    c.min_unique_bettors, c.min_outcomes_with_bets,
    c.betting_window_min_sec, c.betting_window_max_sec,
    c.daily_cap_cents, c.min_pool_max_bet_multiplier, c.min_pool_floor_cents,
    c.stale_result_grace_minutes, c.betting_window_default_sec, c.min_payout_coins,
    c.updated_at, c.updated_by
  from public.betting_config c
  where c.id = 1;
end;
$$;
grant execute on function public.get_betting_config() to authenticated;

create or replace function public.update_betting_config(
  p_min_bet_cents               integer,
  p_max_bet_cents               integer,
  p_max_round_stake_cents       integer,
  p_min_unique_bettors          integer,
  p_min_outcomes_with_bets      integer,
  p_min_pool_max_bet_multiplier integer,
  p_min_pool_floor_cents        integer,
  p_max_odds_cap                numeric,
  p_rake_bps                    integer,
  p_rake_platform_bps           integer,
  p_rake_streamer_bps           integer,
  p_betting_window_min_sec      integer,
  p_betting_window_max_sec      integer,
  p_betting_window_default_sec  integer,
  p_daily_cap_cents             integer,
  p_min_payout_coins            integer,
  p_stale_result_grace_minutes  integer
)
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
  stale_result_grace_minutes   integer,
  betting_window_default_sec   integer,
  min_payout_coins             integer,
  updated_at                   timestamptz,
  updated_by                   uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  -- Friendly re-validation. The table CHECK constraints below are the
  -- hard backstop; these just translate the same rules into operator-
  -- readable messages before the write.
  if p_min_bet_cents <= 0 or p_max_bet_cents <= 0 or p_max_round_stake_cents <= 0
     or p_daily_cap_cents <= 0 or p_min_payout_coins <= 0
     or p_min_unique_bettors <= 0 or p_min_outcomes_with_bets <= 0
     or p_min_pool_max_bet_multiplier <= 0 or p_stale_result_grace_minutes <= 0 then
    raise exception 'All stake, cap, count and payout values must be positive'
      using errcode = '22023';
  end if;
  if p_min_bet_cents > p_max_bet_cents then
    raise exception 'Min bet must be ≤ max bet' using errcode = '22023';
  end if;
  if p_max_bet_cents > p_max_round_stake_cents then
    raise exception 'Max bet must be ≤ max round stake' using errcode = '22023';
  end if;
  if p_rake_bps < 0 or p_rake_bps > 10000 then
    raise exception 'Rake must be between 0 and 10000 bps (0–100%%)'
      using errcode = '22023';
  end if;
  if p_rake_platform_bps < 0 or p_rake_streamer_bps < 0 then
    raise exception 'Rake split values cannot be negative' using errcode = '22023';
  end if;
  if p_rake_platform_bps + p_rake_streamer_bps <> p_rake_bps then
    raise exception 'Rake split must equal total rake: platform % + streamer % ≠ total %',
      p_rake_platform_bps, p_rake_streamer_bps, p_rake_bps
      using errcode = '22023';
  end if;
  if p_max_odds_cap <= 1 then
    raise exception 'Max odds cap must be greater than 1' using errcode = '22023';
  end if;
  if p_betting_window_min_sec < 1 then
    raise exception 'Betting window minimum must be ≥ 1 second' using errcode = '22023';
  end if;
  if p_betting_window_max_sec > 1800 then
    raise exception 'Betting window maximum must be ≤ 1800 seconds' using errcode = '22023';
  end if;
  if p_betting_window_min_sec > p_betting_window_default_sec
     or p_betting_window_default_sec > p_betting_window_max_sec then
    raise exception 'Betting window default must sit between min and max'
      using errcode = '22023';
  end if;
  if p_min_outcomes_with_bets < 2 then
    raise exception 'Minimum outcomes with bets must be ≥ 2' using errcode = '22023';
  end if;
  if p_min_pool_floor_cents < 0 then
    raise exception 'Min-pool floor cannot be negative' using errcode = '22023';
  end if;
  if p_daily_cap_cents < p_max_round_stake_cents then
    raise exception 'Daily cap must be ≥ max round stake' using errcode = '22023';
  end if;

  update public.betting_config set
    min_bet_cents               = p_min_bet_cents,
    max_bet_cents               = p_max_bet_cents,
    max_round_stake_cents       = p_max_round_stake_cents,
    min_unique_bettors          = p_min_unique_bettors,
    min_outcomes_with_bets      = p_min_outcomes_with_bets,
    min_pool_max_bet_multiplier = p_min_pool_max_bet_multiplier,
    min_pool_floor_cents        = p_min_pool_floor_cents,
    max_odds_cap                = p_max_odds_cap,
    rake_bps                    = p_rake_bps,
    rake_platform_bps           = p_rake_platform_bps,
    rake_streamer_bps           = p_rake_streamer_bps,
    betting_window_min_sec      = p_betting_window_min_sec,
    betting_window_max_sec      = p_betting_window_max_sec,
    betting_window_default_sec  = p_betting_window_default_sec,
    daily_cap_cents             = p_daily_cap_cents,
    min_payout_coins            = p_min_payout_coins,
    stale_result_grace_minutes  = p_stale_result_grace_minutes,
    updated_at                  = now(),
    updated_by                  = auth.uid()
  where id = 1;

  return query
  select
    c.min_bet_cents, c.max_bet_cents, c.max_round_stake_cents, c.max_odds_cap,
    c.rake_bps, c.rake_platform_bps, c.rake_streamer_bps,
    c.min_unique_bettors, c.min_outcomes_with_bets,
    c.betting_window_min_sec, c.betting_window_max_sec,
    c.daily_cap_cents, c.min_pool_max_bet_multiplier, c.min_pool_floor_cents,
    c.stale_result_grace_minutes, c.betting_window_default_sec, c.min_payout_coins,
    c.updated_at, c.updated_by
  from public.betting_config c
  where c.id = 1;
end;
$$;
grant execute on function public.update_betting_config(
  integer, integer, integer, integer, integer, integer, integer,
  numeric, integer, integer, integer,
  integer, integer, integer, integer, integer, integer
) to authenticated;

commit;

notify pgrst, 'reload schema';
