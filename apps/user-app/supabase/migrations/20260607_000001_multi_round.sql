-- Multi-round streams — schema + RPC support.
--
-- Renames the legacy `round_format = 'time'` value to `'multi'` and
-- retires `events.round_duration_sec` (no per-round timer in
-- multi-round; the streamer controls round advancement manually).
-- Adds `events.current_round`, `events.is_final_round`, and
-- `bets.round_index` so per-round bet pools, settlements, and
-- payouts can co-exist on a single events row.
--
-- New RPCs: `settle_round`, `refund_round`, `advance_round`,
-- `mark_final_round`. Existing `place_bet`, `declare_winner`,
-- `settle_event`, `finish_event`, and `close_expired_betting_windows`
-- gain multi-round branches but keep single-round behaviour
-- byte-identical (defaults of `current_round=1`, `round_index=1`,
-- `is_final_round=false`).

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

alter table public.events drop constraint if exists events_round_format_check;
update public.events set round_format = 'multi' where round_format = 'time';
alter table public.events
  add constraint events_round_format_check
  check (round_format in ('event', 'multi'));

-- The per-round timer column was only used by the legacy
-- 'time' format; multi-round has no built-in round duration.
alter table public.events drop column if exists round_duration_sec;

-- Round counters live on the events row. Existing rows default to
-- (1, false) which matches the single-round semantics they already
-- have, so this migration is a no-op for them.
alter table public.events
  add column if not exists current_round integer not null default 1
  check (current_round >= 1);
alter table public.events
  add column if not exists is_final_round boolean not null default false;

-- Bets carry the round they belong to. Existing rows backfill to 1.
alter table public.bets
  add column if not exists round_index integer not null default 1
  check (round_index >= 1);

create index if not exists bets_event_round_idx
  on public.bets (event_id, round_index);

-- ---------------------------------------------------------------------------
-- 2. place_bet — writes round_index from event.current_round
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
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  -- Idempotency replay short-circuit.
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

  if p_amount_cents < v_min then
    raise exception 'min_bet: stake must be ≥ % cents', v_min using errcode = '22023';
  end if;
  if p_amount_cents > v_max then
    raise exception 'max_bet: stake must be ≤ % cents', v_max using errcode = '22023';
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

  -- One bet per (user, event, round_index). Outcome can differ
  -- across rounds. For single-round events round_index stays 1.
  if exists (
    select 1 from public.bets
    where user_id = v_user_id
      and event_id = p_event_id
      and round_index = v_event.current_round
  ) then
    raise exception 'already_bet: you have already placed a bet for this round'
      using errcode = '22023';
  end if;

  -- Daily cap (stub KYC).
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

-- ---------------------------------------------------------------------------
-- 3. declare_winner — multi-round stays 'live'
-- ---------------------------------------------------------------------------

create or replace function public.declare_winner(
  p_event_id            text,
  p_winning_outcome_ids text[]
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event public.events%rowtype;
  v_invalid_ids int;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;
  if v_event.creator_id is null or v_event.creator_id <> v_user_id then
    raise exception 'Only the event creator can declare a winner'
      using errcode = '42501';
  end if;
  if v_event.status <> 'live' then
    raise exception 'Event must be live to declare a winner' using errcode = '22023';
  end if;
  if v_event.betting_closes_at is not null and now() < v_event.betting_closes_at then
    raise exception 'Betting window has not closed yet' using errcode = '22023';
  end if;
  if p_winning_outcome_ids is null or array_length(p_winning_outcome_ids, 1) is null then
    raise exception 'Must pick at least one winning outcome' using errcode = '22023';
  end if;

  -- All winners must belong to this event.
  select count(*) into v_invalid_ids
  from unnest(p_winning_outcome_ids) as wid
  where not exists (
    select 1 from public.event_outcomes
    where id = wid and event_id = p_event_id
  );
  if v_invalid_ids > 0 then
    raise exception '% winning outcome id(s) do not belong to this event', v_invalid_ids
      using errcode = '22023';
  end if;

  -- Multi-round events keep going after each round's winners are
  -- declared, so we stay in 'live' and only stamp winning_outcome_ids
  -- for the current round. advance_round / mark_final_round consume
  -- it and clear (advance_round only — mark_final_round leaves the
  -- final-round winners on the row for read-only reference).
  if v_event.round_format = 'multi' then
    if v_event.winning_outcome_ids is not null
       and array_length(v_event.winning_outcome_ids, 1) is not null then
      raise exception 'Round % already has declared winners — call advance_round or mark_final_round next',
        v_event.current_round
        using errcode = '22023';
    end if;
    update public.events
    set winning_outcome_ids = p_winning_outcome_ids
    where id = p_event_id
    returning * into v_row;
    return v_row;
  end if;

  -- Single-round path (round_format = 'event'): flip to
  -- pending_moderation as before.
  update public.events
  set status              = 'pending_moderation',
      winning_outcome_ids = p_winning_outcome_ids
  where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. settle_round — per-round payout logic
-- ---------------------------------------------------------------------------
-- Extracted from settle_event so both the single-round end-of-event
-- settlement and the multi-round per-round advancement share the
-- same payout math. Does NOT change event.status — callers handle
-- status transitions.

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
  from public.get_betting_constants();

  -- Cancellation guard #1: unique bettors + distinct outcomes
  -- (scoped to this round).
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

  -- Total pool for THIS round only.
  select coalesce(sum(amount_cents), 0) into v_total
  from public.bets
  where event_id = p_event_id
    and round_index = p_round_index
    and status = 'placed';

  -- Cancellation guard #2: MIN_POOL.
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

  -- Winning pool for THIS round only.
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
      event_id, bet_id, status, idempotency_key
    ) values (
      'winner', b.user_id, 'viewer', v_winner_total,
      p_event_id, b.id, 'pending',
      public.derive_payout_key(p_idempotency_key, b.id::text)
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
      event_id, status, idempotency_key
    ) values (
      'rake_streamer', v_event.creator_id, 'streamer', v_rake_streamer,
      p_event_id, 'pending',
      public.derive_payout_key(p_idempotency_key, 'rake_streamer_r' || p_round_index)
    )
    returning id into v_payout_id;
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_rake_streamer, v_payout_id::text);
  end if;

  if v_rake_platform > 0 then
    insert into public.payouts (
      type, recipient_kind, amount_cents,
      event_id, status, idempotency_key
    ) values (
      'rake_platform', 'platform', v_rake_platform,
      p_event_id, 'pending',
      public.derive_payout_key(p_idempotency_key, 'rake_platform_r' || p_round_index)
    )
    returning id into v_payout_id;
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_rake_platform, v_payout_id::text);
  end if;

  v_residual := v_distributable - v_payout_sum;
  if v_residual > 0 then
    insert into public.payouts (
      type, recipient_kind, amount_cents,
      event_id, status, idempotency_key
    ) values (
      'residual', 'platform', v_residual,
      p_event_id, 'pending',
      public.derive_payout_key(p_idempotency_key, 'residual_r' || p_round_index)
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

-- ---------------------------------------------------------------------------
-- 5. refund_round — refund all bets in a given round
-- ---------------------------------------------------------------------------
-- Returns the number of refunded bets. Credits balances, marks bets
-- as 'refunded', writes ledger entries. Does NOT change event.status.

create or replace function public.refund_round(
  p_event_id    text,
  p_round_index integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  b record;
  v_new_balance bigint;
begin
  for b in
    select * from public.bets
    where event_id = p_event_id
      and round_index = p_round_index
      and status = 'placed'
  loop
    update public.profiles
    set balance_cents = balance_cents + b.amount_cents
    where id = b.user_id
    returning balance_cents into v_new_balance;

    update public.bets
    set status = 'refunded', settled_at = now(), payout_cents = b.amount_cents
    where id = b.id;

    insert into public.ledger_entries (account, type, amount_cents, balance_after_cents, reference_id)
    values
      ('event_pool:' || p_event_id, 'refund', -b.amount_cents, null, b.id::text),
      ('user:' || b.user_id::text, 'refund', b.amount_cents, v_new_balance, b.id::text);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. settle_event — refactored to call settle_round for round 1
-- ---------------------------------------------------------------------------
-- Single-round end-of-event settlement. Required event status is
-- still 'pending_moderation' (set by declare_winner for single
-- rounds). Flips to 'settled' at the end. For multi-round events
-- this isn't the right entry point — they use advance_round /
-- mark_final_round per round, then finish_event.

create or replace function public.settle_event(
  p_event_id        text,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_result json;
  v_refunded boolean;
  v_reason text;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;
  if v_event.status <> 'pending_moderation' then
    raise exception 'Event must be pending_moderation to settle (got %)', v_event.status
      using errcode = '22023';
  end if;
  if v_event.round_format <> 'event' then
    raise exception 'settle_event only handles single-round events. Use advance_round / mark_final_round for multi-round.'
      using errcode = '22023';
  end if;

  v_result := public.settle_round(p_event_id, 1, p_idempotency_key);

  v_refunded := coalesce((v_result->>'refunded')::boolean, false);
  if v_refunded then
    v_reason := v_result->>'reason';
    perform public.cancel_event(p_event_id,
      coalesce('auto_cancel: ' || v_reason, 'auto_cancel: settlement guard'));
    return json_build_object(
      'cancelled', true,
      'reason', v_reason,
      'round_settlement', v_result
    );
  end if;

  update public.events
  set status = 'settled', settled_at = now()
  where id = p_event_id;

  return json_build_object(
    'cancelled', false,
    'event_id', p_event_id,
    'round_settlement', v_result
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. advance_round — settle current round + bump to next
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
  v_window_min integer;
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
  v_window_min := coalesce(v_event.betting_window_minutes, 10);

  update public.event_outcomes set pool_cents = 0 where event_id = p_event_id;

  update public.events
  set current_round         = v_next_round,
      winning_outcome_ids   = null,
      betting_opens_at      = now(),
      betting_closes_at     = now() + make_interval(mins => v_window_min),
      betting_window_closed_at = null
  where id = p_event_id;

  return json_build_object(
    'event_id', p_event_id,
    'previous_round', v_event.current_round,
    'current_round', v_next_round,
    'settlement', v_settle_result,
    'betting_window_minutes', v_window_min
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. mark_final_round — settle current round + mark this as final
-- ---------------------------------------------------------------------------
-- After mark_final_round the event stays 'live' (the streamer is
-- still doing post-game commentary / closing the stream) but no
-- more rounds can be advanced. The streamer then calls finish_event
-- to close the stream.

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

  v_settle_result := public.settle_round(
    p_event_id, v_event.current_round, p_idempotency_key
  );

  update public.events
  set is_final_round = true
  where id = p_event_id;

  return json_build_object(
    'event_id', p_event_id,
    'final_round', v_event.current_round,
    'is_final_round', true,
    'settlement', v_settle_result
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. finish_event — multi-round branch
-- ---------------------------------------------------------------------------
-- Single-round behaviour unchanged (live with no winner → cancel
-- via cancel_event). Multi-round: refund any in-flight bets for
-- the current round if it wasn't settled, then flip status to
-- 'settled' (so the betting flow is closed) and 'finished'.

create or replace function public.finish_event(p_event_id text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_row        public.events;
  v_event      public.events%rowtype;
  v_has_bets   boolean;
  v_has_winner boolean;
  v_refund_count integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select *
  into v_event
  from public.events
  where id = p_event_id
    and creator_id = v_user_id
    and status = 'live';

  if v_event.id is null then
    raise exception 'Event not found, not yours, or not in live state'
      using errcode = '42501';
  end if;

  -- Multi-round: refund any un-settled bets in the current round.
  -- Previously-settled rounds keep their payouts.
  if v_event.round_format = 'multi' then
    v_refund_count := public.refund_round(p_event_id, v_event.current_round);

    update public.events
    set status              = 'finished',
        settled_at          = coalesce(settled_at, now()),
        winning_outcome_ids = null
    where id = p_event_id
    returning * into v_row;

    return v_row;
  end if;

  -- Single-round path (unchanged from prior behaviour).
  select exists (
    select 1 from public.bets b where b.event_id = v_event.id
  ) into v_has_bets;

  v_has_winner := coalesce(array_length(v_event.winning_outcome_ids, 1), 0) > 0;

  if v_has_bets and not v_has_winner then
    return public.cancel_event(
      p_event_id,
      'auto_cancel: creator ended stream without declaring a winner'
    );
  end if;

  update public.events
  set status = 'finished'
  where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. close_expired_betting_windows — multi-round per-round refund
-- ---------------------------------------------------------------------------
-- Single-round: still auto-cancels on stale events (no winner
-- declared > grace minutes past cutoff). Multi-round: refunds the
-- current round's bets and clears the round's open state but keeps
-- the event live so the streamer can manually call advance_round /
-- mark_final_round / finish_event when they're back.

create or replace function public.close_expired_betting_windows()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grace_minutes integer;
  v_closed_ids text[];
  v_stale_ids text[];
  v_stale_id text;
  v_stale_event public.events%rowtype;
  v_refund_count integer;
  v_multi_refund_count integer := 0;
begin
  select stale_result_grace_minutes
    into v_grace_minutes
  from public.get_betting_constants();

  -- (a) Stamp betting_window_closed_at on live events past cutoff.
  with closed as (
    update public.events
    set betting_window_closed_at = now()
    where status = 'live'
      and betting_closes_at is not null
      and now() > betting_closes_at
      and betting_window_closed_at is null
    returning id
  )
  select coalesce(array_agg(id), '{}'::text[]) into v_closed_ids from closed;

  -- (b) Find live events the streamer abandoned past grace.
  select coalesce(array_agg(id), '{}'::text[]) into v_stale_ids
  from public.events
  where status = 'live'
    and winning_outcome_ids is null
    and betting_closes_at is not null
    and now() > betting_closes_at + make_interval(mins => v_grace_minutes);

  -- (c) Per-event handling: multi-round refunds just the current
  -- round, single-round still cancels the whole event.
  foreach v_stale_id in array v_stale_ids loop
    select * into v_stale_event from public.events where id = v_stale_id;
    if v_stale_event.round_format = 'multi' then
      v_refund_count := public.refund_round(
        v_stale_id, v_stale_event.current_round
      );
      v_multi_refund_count := v_multi_refund_count + 1;
      -- Reset the round's outcome pools and clear the closed timestamp
      -- so the streamer can re-open a fresh window via advance_round.
      update public.event_outcomes set pool_cents = 0 where event_id = v_stale_id;
      update public.events
      set betting_window_closed_at = null
      where id = v_stale_id;
    else
      perform public.cancel_event(
        v_stale_id,
        'auto_cancel: streamer did not declare result within grace window'
      );
    end if;
  end loop;

  return json_build_object(
    'closed_count', coalesce(array_length(v_closed_ids, 1), 0),
    'closed_ids', v_closed_ids,
    'stale_count', coalesce(array_length(v_stale_ids, 1), 0),
    'stale_ids', v_stale_ids,
    'multi_round_refund_count', v_multi_refund_count,
    'grace_minutes', v_grace_minutes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. create_event / update_event — drop p_round_duration_sec param
-- ---------------------------------------------------------------------------
-- Both RPCs previously took p_round_duration_sec to populate the
-- now-retired events.round_duration_sec column. The new multi-round
-- format has no per-round timer, so the param is gone too. The
-- round_format check is widened to accept 'event' | 'multi'.
--
-- Old signatures must be DROPped explicitly because Postgres treats
-- function overloads as distinct objects keyed by argument types.

drop function if exists public.create_event(
  text, text, text, text, text, text, integer, timestamptz, text,
  text, integer, integer, text, text, text, integer
);

create or replace function public.create_event(
  p_title text,
  p_cover_url text,
  p_description text,
  p_rules text,
  p_category text,
  p_round_format text,
  p_scheduled_at timestamptz,
  p_video_url text,
  p_void_conditions text default null,
  p_min_bet_cents integer default null,
  p_max_bet_cents integer default null,
  p_bet_window_opens text default null,
  p_bet_window_locks text default null,
  p_source_type text default null,
  p_broadcast_delay_sec integer default null
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event_id text;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.creator_profiles where id = v_user_id) then
    raise exception 'Creator profile required' using errcode = '42501';
  end if;

  if p_title is null or char_length(trim(p_title)) between 3 and 120 is not true then
    raise exception 'Title must be 3-120 characters' using errcode = '22023';
  end if;
  if p_round_format not in ('event','multi') then
    raise exception 'round_format must be ''event'' or ''multi''' using errcode = '22023';
  end if;
  if p_scheduled_at is null then
    raise exception 'scheduled_at is required' using errcode = '22023';
  end if;
  if p_category is null or char_length(trim(p_category)) = 0 then
    raise exception 'Category is required' using errcode = '22023';
  end if;

  v_event_id := 'evt_' ||
    nullif(regexp_replace(lower(substr(p_title, 1, 30)), '[^a-z0-9]+', '_', 'g'), '') ||
    '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.events (
    id, creator_id, title, cover_url, description, rules,
    category, round_format, status,
    scheduled_at, video_url,
    void_conditions,
    min_bet_cents, max_bet_cents,
    bet_window_opens, bet_window_locks,
    source_type, broadcast_delay_sec
  ) values (
    v_event_id, v_user_id, trim(p_title),
    nullif(p_cover_url, ''), nullif(p_description, ''), nullif(p_rules, ''),
    trim(p_category), p_round_format,
    'draft', p_scheduled_at, nullif(p_video_url, ''),
    nullif(p_void_conditions, ''),
    p_min_bet_cents, p_max_bet_cents,
    p_bet_window_opens, p_bet_window_locks,
    p_source_type, p_broadcast_delay_sec
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_event(
  text, text, text, text, text, text, timestamptz, text,
  text, integer, integer, text, text, text, integer
) to authenticated;

drop function if exists public.update_event(
  text, text, text, text, text, text, text, integer, timestamptz, text,
  text, integer, integer, text, text, text, integer
);

create or replace function public.update_event(
  p_event_id text,
  p_title text,
  p_cover_url text,
  p_description text,
  p_rules text,
  p_category text,
  p_round_format text,
  p_scheduled_at timestamptz,
  p_video_url text,
  p_void_conditions text default null,
  p_min_bet_cents integer default null,
  p_max_bet_cents integer default null,
  p_bet_window_opens text default null,
  p_bet_window_locks text default null,
  p_source_type text default null,
  p_broadcast_delay_sec integer default null
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
  if p_round_format not in ('event','multi') then
    raise exception 'round_format must be ''event'' or ''multi''' using errcode = '22023';
  end if;

  update public.events
  set title                = trim(p_title),
      cover_url            = nullif(p_cover_url, ''),
      description          = nullif(p_description, ''),
      rules                = nullif(p_rules, ''),
      category             = trim(p_category),
      round_format         = p_round_format,
      scheduled_at         = p_scheduled_at,
      video_url            = nullif(p_video_url, ''),
      void_conditions      = nullif(p_void_conditions, ''),
      min_bet_cents        = p_min_bet_cents,
      max_bet_cents        = p_max_bet_cents,
      bet_window_opens     = p_bet_window_opens,
      bet_window_locks     = p_bet_window_locks,
      source_type          = p_source_type,
      broadcast_delay_sec  = p_broadcast_delay_sec
  where id = p_event_id
    and creator_id = v_user_id
    and status in ('draft','scheduled')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not editable' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

grant execute on function public.update_event(
  text, text, text, text, text, text, text, timestamptz, text,
  text, integer, integer, text, text, text, integer
) to authenticated;

commit;
