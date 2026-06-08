-- LiveRush — per-round results summary for the FinishedPanel.
--
-- Multi-round events have one set of outcomes shared across every
-- round, but each round has its own pool, its own winners, and may
-- have refunded if the round's minimums weren't met. The
-- FinishedPanel needs to let the viewer switch between rounds and
-- see "Round 1 — X won, Round 2 — refunded" etc.
--
-- The events table only stores the LATEST round's
-- winning_outcome_ids (declare_winner overwrites it each call) and
-- event_outcomes.pool_cents resets to 0 on advance_round, so we
-- can't reconstruct round-by-round history from the events table
-- alone. The bets table is the source of truth — each bet carries
-- its round_index plus a status that encodes settlement outcome:
--
--   • status='won_pending_payout' / 'won'  → outcome was a winner
--                                            for that bet's round.
--   • status='lost'                        → outcome lost.
--   • status='refunded'                    → the whole round
--                                            refunded (settle_round
--                                            short-circuited on
--                                            min-bettors / outcomes
--                                            / pool).
--
-- This RPC returns one row per round_index with the aggregated
-- per-outcome pools (so the UI can recompute final odds with
-- liveOddsFor) and the derived winners + refunded flag.

create or replace function public.get_event_rounds_summary(p_event_id text)
returns table (
  round_index         integer,
  was_refunded        boolean,
  winning_outcome_ids text[],
  outcome_pools       jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  with bets_agg as (
    select
      b.round_index,
      b.outcome_id,
      sum(b.amount_cents)::bigint as pool_cents,
      bool_or(b.status in ('won_pending_payout', 'won')) as is_winner
    from public.bets b
    where b.event_id = p_event_id
    group by b.round_index, b.outcome_id
  ),
  round_refunds as (
    -- A round counts as refunded only when every bet in it has
    -- status='refunded'. A partially-refunded round (e.g. some
    -- viewers refunded for unrelated reasons later) is rare/edge,
    -- but the bool_and keeps it safe — we only flip the badge
    -- when the whole round genuinely refunded.
    select
      b.round_index,
      bool_and(b.status = 'refunded') as was_refunded
    from public.bets b
    where b.event_id = p_event_id
    group by b.round_index
  )
  select
    ba.round_index,
    coalesce(rr.was_refunded, false),
    array_agg(ba.outcome_id) filter (where ba.is_winner) as winning_outcome_ids,
    jsonb_agg(jsonb_build_object(
      'outcome_id', ba.outcome_id,
      'pool_cents', ba.pool_cents
    )) as outcome_pools
  from bets_agg ba
  join round_refunds rr on rr.round_index = ba.round_index
  group by ba.round_index, rr.was_refunded
  order by ba.round_index;
end;
$$;

grant execute on function public.get_event_rounds_summary(text) to anon, authenticated;
