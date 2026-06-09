-- LiveRush — split MAX_BET into per-outcome + aggregate-per-round.
--
-- Original spec called for two layered caps the previous migration
-- conflated:
--
--   • MAX_BET ($10): the most a viewer can stake on a SINGLE
--     outcome.
--   • MAX_ROUND_STAKE ($30): the sum across all of a viewer's bets
--     on different outcomes in one round.
--
-- 20260610_000001 used MAX_BET ($10) as the aggregate cap, which
-- collapsed multi-outcome betting into the same $10 budget the
-- old single-bet flow had. The fix: restore the per-bet MAX_BET
-- check as a per-OUTCOME ceiling, and add a separate aggregate
-- check at MAX_ROUND_STAKE ($30). The result:
--
--   ✓ $10 on Outcome A                            → ok
--   ✓ $10 on A + $10 on B + $10 on C              → ok (sum $30)
--   ✗ $11 on A (single bet > MAX_BET)             → max_bet
--   ✗ $10 on A + $10 on B + $10 on C + $1 on D    → max_round_stake_exceeded
--     (sum $31 > $30)
--
-- Daily cap stays at $100 across all events (sum via user_bet_caps).

begin;

-- ---------------------------------------------------------------------------
-- 1. get_betting_constants — add max_round_stake_cents OUT column
-- ---------------------------------------------------------------------------
-- The OUT column signature changes, so we drop the old function first.
-- Callers that destructure `min_bet_cents, max_bet_cents, rake_bps,
-- daily_cap_cents` (place_bet) keep working — they ignore the new
-- column. settle_round / settle_event also keep their reads
-- byte-identical (no max_round_stake reference there).

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
  betting_window_min_min       integer,
  betting_window_min_max       integer,
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
    3          as min_unique_bettors,
    2          as min_outcomes_with_bets,
    5          as betting_window_min_min,
    30         as betting_window_min_max,
    10000      as daily_cap_cents,
    3          as min_pool_max_bet_multiplier,
    3000       as min_pool_floor_cents,
    15         as stale_result_grace_minutes;
$$;
grant execute on function public.get_betting_constants() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. place_bet — enforce per-bet MAX_BET + per-round MAX_ROUND_STAKE
-- ---------------------------------------------------------------------------

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
  from public.get_betting_constants();

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

commit;

notify pgrst, 'reload schema';
