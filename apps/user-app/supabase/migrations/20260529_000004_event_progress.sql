-- LiveRush — get_event_progress RPC for the bet-panel readiness UX.
--
-- Surfaces the three settle_event guards (unique bettors, distinct
-- outcomes with bets, MIN_POOL) as a single read so the user-app can
-- render "Open" everywhere + a "min N bettors · min M outcomes ·
-- min $X pool" caption until the event is ready to settle.
--
-- Why a separate RPC and not part of compute_live_odds: unique
-- bettors is a scalar that doesn't belong on every outcome row, and
-- bundling MIN_POOL math into the odds query muddles two concerns.
-- Keep compute_live_odds focused on per-outcome math; this RPC owns
-- the readiness gauge.

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
begin
  -- Alias `c` because the OUT columns of this function shadow the
  -- column names returned by get_betting_constants() — without the
  -- alias plpgsql can't tell which `min_unique_bettors` is meant.
  select c.min_unique_bettors, c.min_outcomes_with_bets,
         c.min_bet_cents, c.max_bet_cents,
         c.min_pool_max_bet_multiplier, c.min_pool_floor_cents
    into v_min_unique, v_min_outcomes,
         v_min_bet, v_max_bet,
         v_min_pool_multiplier, v_min_pool_floor
  from public.get_betting_constants() as c;

  select count(*) into v_num_outcomes
  from public.event_outcomes where event_id = p_event_id;

  select coalesce(sum(pool_cents), 0) into v_total_pool
  from public.event_outcomes where event_id = p_event_id;

  -- "Active" bets only — refunded / lost don't count toward minimums.
  select
    count(distinct user_id)::integer,
    count(distinct outcome_id)::integer
    into v_unique, v_outcomes_with_bets
  from public.bets
  where event_id = p_event_id
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
