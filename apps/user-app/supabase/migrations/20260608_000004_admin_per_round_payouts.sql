-- LiveRush — per-round payouts + cumulative-pool admin RPC.
--
-- The admin /events page needs to show:
--   1. Cumulative total pool per event (across rounds). Today the
--      list reads event_outcomes.pool_cents which resets to 0 on
--      every advance_round, so multi-round events look smaller than
--      they are.
--   2. Per-round pool breakdown inside the event drawer (round 1
--      / round 2 / …) so an admin can see how much flowed through
--      each round.
--   3. Payouts grouped by the round they belong to so the operator
--      can approve "round 1's winner + rake_streamer + rake_platform"
--      together before moving to round 2.
--
-- (1) + (2) come from the bets table — bets carry round_index +
-- amount_cents, summed by round_index gives per-round pools and by
-- event gives cumulative. The pool_cents column on event_outcomes
-- stays accurate only for the *current* round and that's by design
-- (compute_live_odds uses it for the live betting window).
--
-- (3) needs a `round_index` projection on payouts so the admin
-- query can group by it. Today the only hint that a payout belongs
-- to round N is hidden in:
--   • bets.round_index → via payouts.bet_id (for type='winner' rows)
--   • idempotency_key suffix '…rake_streamer_rN' (rake_streamer)
--   • idempotency_key suffix '…rake_platform_rN' (rake_platform)
--   • idempotency_key suffix '…residual_rN' (residual)
-- Parsing key suffixes at read time is brittle, so we promote
-- round_index to a real column on `payouts`, populate it from
-- settle_round going forward, and backfill the existing rows via
-- the lookups above.

-- ---------------------------------------------------------------------------
-- 1. Schema: add payouts.round_index
-- ---------------------------------------------------------------------------
-- Nullable for legacy rows that predate the multi-round migration
-- entirely (no bets.round_index back then either). New rows always
-- get a value via the updated settle_round below.

alter table public.payouts
  add column if not exists round_index integer
    check (round_index is null or round_index >= 1);

create index if not exists payouts_event_round_idx
  on public.payouts (event_id, round_index);

-- ---------------------------------------------------------------------------
-- 2. Backfill existing rows
-- ---------------------------------------------------------------------------
--   • Winner payouts: bet_id → bets.round_index.
--   • rake_streamer / rake_platform / residual: parse the trailing
--     '_rN' fragment off idempotency_key.

update public.payouts p
set round_index = b.round_index
from public.bets b
where p.bet_id = b.id
  and p.round_index is null
  and p.type = 'winner';

-- For rake / residual rows the bet_id is null but the
-- idempotency_key carries the round number after the last `_r`.
-- Example: 'a1b2c3...rake_streamer_r2' → 2.
update public.payouts
set round_index = (regexp_match(idempotency_key::text, '_r(\d+)$'))[1]::integer
where round_index is null
  and idempotency_key is not null
  and type in ('rake_streamer', 'rake_platform', 'residual')
  and idempotency_key::text ~ '_r\d+$';

-- ---------------------------------------------------------------------------
-- 3. settle_round — set round_index on every new payouts row.
-- ---------------------------------------------------------------------------
-- Same body as 20260607_000001_multi_round.sql, with `round_index`
-- added to all four INSERT lists. Everything else (idempotency
-- guard, refund branches, ledger entries, return json) is byte-
-- identical — only the writes that create payout rows change.

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
-- 4. get_admin_event_totals — bulk cumulative pool lookup
-- ---------------------------------------------------------------------------
-- Used by the admin /events list to show "Total pool" correctly for
-- multi-round events. Sums bets.amount_cents across every round of
-- each requested event. We include bets in every non-cancelled
-- status (placed, won_pending_payout, won, lost, refunded) so a
-- refunded round still contributes to "how much flowed through this
-- event" — operator intuition is "total volume", not "net retained".

create or replace function public.get_admin_event_totals(
  p_event_ids text[]
)
returns table (
  event_id          text,
  total_pool_cents  bigint
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
    b.event_id,
    coalesce(sum(b.amount_cents), 0)::bigint as total_pool_cents
  from public.bets b
  where b.event_id = any(p_event_ids)
  group by b.event_id;
end;
$$;

grant execute on function public.get_admin_event_totals(text[]) to authenticated;
