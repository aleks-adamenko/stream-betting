-- LiveRush — scope get_event_progress to the current betting round.
--
-- The original RPC (20260529_000004_event_progress.sql) was written
-- before multi-round events existed. It counted unique bettors and
-- distinct outcomes-with-bets across the *whole* bets table for the
-- event — fine when every event was single-round, but wrong now:
--
--   • event_outcomes.pool_cents resets to 0 on advance_round (per
--     the 20260607_000001_multi_round.sql contract). The pool guard
--     was always per-round.
--   • bets carry a round_index, but this RPC didn't filter by it.
--     Round-1 winners settle to status 'won' or 'won_pending_payout'
--     — both of which still match the `status in (...)` clause —
--     so their user_id and outcome_id kept counting toward round 2's
--     minimums. Result: round 2 reads minimumsMet=true with zero
--     round-2 bets, the user-app shows live odds (which are 1.00×
--     because the pool is 0), and the streamer's readiness panel
--     stays green from the prior round.
--
-- Fix: read events.current_round and filter the bets aggregation by
-- `round_index = current_round`. The pool aggregation already reads
-- event_outcomes.pool_cents which is per-round, so no change there.
-- Single-round events stay correct: current_round = 1 forever and
-- every bet they ever had has round_index = 1.
--
-- No signature change — the return shape is identical. Hooks
-- (`useEventProgress`) refetch on event_outcomes UPDATE, which fires
-- when advance_round zeros pool_cents, so the studio's readiness
-- panel and the user-app's readiness gating flip back to red the
-- instant the new round opens.

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
  from public.get_betting_constants() as c;

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
