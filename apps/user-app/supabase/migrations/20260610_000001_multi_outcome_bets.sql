-- LiveRush — multi-outcome betting per (event, round).
--
-- Before this migration, place_bet rejected any second bet a viewer
-- tried to place within the current round with `already_bet`. That
-- collapses the natural fan of "pick the outcome you believe in"
-- bets into a one-shot choice. The operator wants viewers to be
-- able to back any subset of an event's outcomes — from one bet up
-- through covering every outcome — with each bet stored as its
-- own independent row.
--
-- Two server-side changes make this safe:
--   1. Replace the round-level uniqueness check (and add a tighter
--      DB-level constraint) so the only thing the server still
--      rejects is a second bet on the SAME outcome within the same
--      round. The "increase my stake on outcome X" affordance is
--      explicitly out of scope for v1; the UI hides the stake chips
--      on outcomes the viewer already bet, and this constraint is
--      the defence-in-depth if someone bypasses the UI.
--   2. Replace the per-bet `max_bet` check with an aggregate one
--      summed across the user's stakes for THIS (event, round). So
--      a viewer can place $4 on outcome A + $6 on outcome B (total
--      $10 = MAX_BET) but the next $1 on outcome C raises
--      `max_bet_exceeded`. Each new round resets the cap.
--
-- Everything downstream — settle_round / refund_round / the
-- in-app notification triggers / get_event_progress — already
-- iterates per bet row, so no changes are needed there. The
-- pari-mutuel pool math (compute_live_odds) is per-outcome
-- pool_cents, which the existing place_bet already bumps per row.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tighter uniqueness — one ACTIVE bet per (user, event, round, outcome)
-- ---------------------------------------------------------------------------
-- Partial UNIQUE INDEX rather than a full UNIQUE constraint. The
-- historical data set carries a handful of duplicate
-- (user, event, round, outcome) rows from test seeding + refund
-- flows that re-opened rounds on early multi-round builds. Those
-- duplicates are all terminal (status in 'refunded' / 'lost' /
-- 'won') and don't represent live money — they shouldn't block
-- the migration.
--
-- The real invariant we care about is: "the viewer can't hold two
-- ACTIVE bets on the same outcome in the same round." Scoping the
-- unique index to the active statuses captures exactly that, and
-- the explicit EXISTS guard inside place_bet is unchanged (so a
-- refunded bet on the same outcome still raises
-- `already_bet_outcome` — defence in depth at the RPC level).

drop index if exists public.bets_user_event_round_outcome_unique;
alter table public.bets
  drop constraint if exists bets_user_event_round_outcome_unique;
drop index if exists public.bets_user_event_round_outcome_active_uniq;

create unique index bets_user_event_round_outcome_active_uniq
  on public.bets (user_id, event_id, round_index, outcome_id)
  where status in ('placed', 'open', 'won_pending_payout', 'won');

-- ---------------------------------------------------------------------------
-- 2. place_bet — drop single-bet guard, add aggregate MAX_BET
-- ---------------------------------------------------------------------------
-- Mirrors 20260607_000001_multi_round.sql line-for-line except:
--   • The `already_bet` EXISTS guard (matched on user+event+round)
--     becomes an `already_bet_outcome` guard that ALSO matches
--     outcome_id, so a second bet on a DIFFERENT outcome is
--     accepted. The new UNIQUE constraint above is defence in
--     depth — if the EXISTS check somehow misses, the INSERT
--     fails with the unique-violation SQLSTATE.
--   • The per-bet `max_bet` check is replaced by an aggregate
--     check that sums `amount_cents` across the user's existing
--     bets in this round (any non-refunded status) and adds the
--     incoming `p_amount_cents`. The aggregate must stay ≤
--     MAX_BET_CENTS. The MIN_BET check is still per-bet (each
--     individual bet still has to clear the $1 floor).
--   • Daily cap path stays as-is — `user_bet_caps` already
--     aggregates across every bet (event-agnostic).

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
  -- New: aggregate stake the user already has on this (event, round).
  -- Includes only "money the user actually has at risk" — i.e. not
  -- refunded. A previously-settled bet (won / lost) on an earlier
  -- ROUND wouldn't appear because we filter by current_round.
  v_existing_round_stake bigint;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  -- Idempotency replay short-circuit. Unchanged from the prior
  -- version — same key on a second call returns the original row
  -- without moving the pool.
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

  select min_bet_cents, max_bet_cents, rake_bps, daily_cap_cents
    into v_min, v_max, v_rake_bps, v_daily_cap
  from public.get_betting_constants();

  -- Per-bet MIN_BET still applies — each individual bet must
  -- clear the floor. MAX_BET is now aggregated per round (below)
  -- so we don't reject it here; the aggregate check catches both
  -- "single $20 bet" and "$6 + $5 split" the same way.
  if p_amount_cents < v_min then
    raise exception 'min_bet: stake must be ≥ % cents', v_min using errcode = '22023';
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

  -- Multi-outcome rule (replaces the prior `already_bet` guard):
  -- the viewer can place bets on as many DISTINCT outcomes as they
  -- like within a round, but never two bets on the same outcome.
  -- A future "add to existing bet" affordance would call a separate
  -- RPC (out of scope here).
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

  -- Aggregate MAX_BET per round. Sum the user's stakes already in
  -- this round (any non-refunded status — placed, open from the
  -- legacy fixed-odds flow, won_pending_payout, won), add the
  -- incoming bet, compare to MAX_BET. Each new round resets the
  -- cap because the round_index filter drops the prior round's
  -- bets entirely.
  select coalesce(sum(amount_cents), 0) into v_existing_round_stake
  from public.bets
  where user_id = v_user_id
    and event_id = p_event_id
    and round_index = v_event.current_round
    and status in ('placed', 'open', 'won_pending_payout', 'won');

  if v_existing_round_stake + p_amount_cents > v_max then
    raise exception 'max_bet_exceeded: total stake this round would be %.2f, max is %.2f',
      (v_existing_round_stake + p_amount_cents)::numeric / 100,
      v_max::numeric / 100
      using errcode = '22023';
  end if;

  -- Daily cap (stub KYC) — unchanged. Already event-agnostic so a
  -- viewer who bets $4 on one event then $6 on another sees the
  -- daily total cumulate correctly.
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

  -- event_outcomes.pool_cents tracks the CURRENT round only.
  -- advance_round resets these on round transitions.
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
