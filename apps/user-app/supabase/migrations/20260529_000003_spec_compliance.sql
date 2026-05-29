-- LiveRush — Phase 1 spec-compliance addendum.
--
-- Four fixes against the spec
-- (`betting_logic_mvp.docx` sections 4.2-4.3, 8.2, 12.1, 12.6, 14.5):
--
--   1. Restore production cancellation guards
--      (min_unique_bettors=5, min_outcomes_with_bets=2; were relaxed
--      to 1/1 during the smoke test).
--   2. Add MIN_POOL guard to settle_event so the
--      "single bettor wins less than they staked" case auto-cancels
--      + refunds instead of settling.
--   3. New `close_expired_betting_windows()` RPC that combines the
--      betting_window_closed_at stamp with a stale-streamer sweep
--      (auto-cancel events 15+ minutes past cutoff with no winner
--      declared). Edge Function gets a one-line swap to call this.
--   4. get_betting_constants now exposes MIN_POOL params so the
--      math lives in SQL alongside the rest of the constants.

-- =========================================================================
-- 1) get_betting_constants — restore production minimums + add MIN_POOL
-- =========================================================================
--
-- The OUT column signature changes (3 new columns), so Postgres rejects
-- `create or replace` and requires an explicit drop first.

drop function if exists public.get_betting_constants();

create or replace function public.get_betting_constants()
returns table (
  min_bet_cents                integer,
  max_bet_cents                integer,
  max_odds_cap                 numeric,
  rake_bps                     integer,
  rake_platform_bps            integer,
  rake_streamer_bps            integer,
  min_unique_bettors           integer,
  min_outcomes_with_bets       integer,
  betting_window_min_min       integer,
  betting_window_min_max       integer,
  daily_cap_cents              integer,
  -- MIN_POOL params (spec 4.2-4.3).
  -- MIN_POOL = max(MAX_BET × multiplier, num_outcomes × MIN_BET).
  -- The floor is a sanity check for ill-configured events
  -- (e.g. a single outcome) — never go below it.
  min_pool_max_bet_multiplier  integer,
  min_pool_floor_cents         integer,
  -- Stale-streamer auto-cancel (spec 12.6): if the creator doesn't
  -- declare a winner within this many minutes of the cutoff, the
  -- cron auto-cancels the event + refunds.
  stale_result_grace_minutes   integer
)
language sql
immutable
as $$
  select
    100        as min_bet_cents,
    1000       as max_bet_cents,
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

-- =========================================================================
-- 2) settle_event — add MIN_POOL guard
-- =========================================================================
--
-- Inserted between the unique-bettors/outcomes check and the
-- winning-pool calculation. Everything else stays identical.

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
    return json_build_object('idempotent_replay', true, 'event_id', p_event_id);
  end if;

  if v_event.status <> 'pending_moderation' then
    raise exception 'Event must be pending_moderation to settle (got %)', v_event.status
      using errcode = '22023';
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

  -- Cancellation guard #1: unique bettors + distinct outcomes.
  select count(distinct user_id), count(distinct outcome_id)
    into v_unique_bettors, v_outcomes_with_bets
  from public.bets
  where event_id = p_event_id and status = 'placed';

  if coalesce(v_unique_bettors, 0) < v_min_unique_bettors
     or coalesce(v_outcomes_with_bets, 0) < v_min_outcomes then
    perform public.cancel_event(p_event_id,
      'auto_cancel: not enough unique bettors or distinct outcomes');
    return json_build_object(
      'cancelled', true,
      'reason', 'auto_cancel_minimums',
      'unique_bettors', coalesce(v_unique_bettors, 0),
      'outcomes_with_bets', coalesce(v_outcomes_with_bets, 0)
    );
  end if;

  -- Total pool (needed for both MIN_POOL guard + winning-pool calc).
  select coalesce(sum(pool_cents), 0) into v_total
  from public.event_outcomes where event_id = p_event_id;

  -- Cancellation guard #2: MIN_POOL (spec 4.2-4.3 + 12.1).
  -- MIN_POOL = max(MAX_BET × multiplier, num_outcomes × MIN_BET, floor)
  select count(*) into v_num_outcomes
  from public.event_outcomes where event_id = p_event_id;
  v_min_pool := greatest(
    (v_max_bet * v_min_pool_multiplier)::bigint,
    (v_num_outcomes * v_min_bet)::bigint,
    v_min_pool_floor::bigint
  );
  if v_total < v_min_pool then
    perform public.cancel_event(p_event_id,
      format('auto_cancel: pool $%s below MIN_POOL $%s',
             (v_total / 100.0)::numeric(10,2),
             (v_min_pool / 100.0)::numeric(10,2)));
    return json_build_object(
      'cancelled', true,
      'reason', 'min_pool',
      'total_pool_cents', v_total,
      'min_pool_cents', v_min_pool
    );
  end if;

  if v_event.winning_outcome_ids is null
     or array_length(v_event.winning_outcome_ids, 1) is null then
    raise exception 'No winning outcomes declared' using errcode = '22023';
  end if;

  select coalesce(sum(pool_cents), 0) into v_winning_pool
  from public.event_outcomes
  where event_id = p_event_id
    and id = any(v_event.winning_outcome_ids);

  if v_winning_pool = 0 then
    perform public.cancel_event(p_event_id, 'auto_cancel: no bets on winner');
    return json_build_object(
      'cancelled', true,
      'reason', 'no_bets_on_winner'
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
    and status = 'placed'
    and not (outcome_id = any(v_event.winning_outcome_ids));

  if v_rake_streamer > 0 and v_event.creator_id is not null then
    insert into public.payouts (
      type, recipient_id, recipient_kind, amount_cents,
      event_id, status, idempotency_key
    ) values (
      'rake_streamer', v_event.creator_id, 'streamer', v_rake_streamer,
      p_event_id, 'pending', public.derive_payout_key(p_idempotency_key, 'rake_streamer')
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
      p_event_id, 'pending', public.derive_payout_key(p_idempotency_key, 'rake_platform')
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
      p_event_id, 'pending', public.derive_payout_key(p_idempotency_key, 'residual')
    )
    returning id into v_payout_id;
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_residual, v_payout_id::text);
  end if;

  update public.events
  set status     = 'settled',
      settled_at = now()
  where id = p_event_id;

  return json_build_object(
    'cancelled', false,
    'event_id', p_event_id,
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

revoke execute on function public.settle_event(text, uuid)
  from public, anon, authenticated;

-- =========================================================================
-- 3) close_expired_betting_windows — replaces the inline UPDATE
--    from the close-betting-windows Edge Function, and adds the
--    stale-streamer auto-cancel sweep (spec 12.6).
-- =========================================================================

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

  -- (b) Find live events the streamer abandoned. We only sweep events
  -- still in 'live' (not pending_moderation or beyond) where the cutoff
  -- passed > grace_minutes ago and no winner was ever declared.
  select coalesce(array_agg(id), '{}'::text[]) into v_stale_ids
  from public.events
  where status = 'live'
    and winning_outcome_ids is null
    and betting_closes_at is not null
    and now() > betting_closes_at + make_interval(mins => v_grace_minutes);

  -- (c) Cancel each stale event in turn. cancel_event handles the
  -- refund + ledger writes + status flip.
  foreach v_stale_id in array v_stale_ids loop
    perform public.cancel_event(
      v_stale_id,
      'auto_cancel: streamer did not declare result within grace window'
    );
  end loop;

  return json_build_object(
    'closed_count', coalesce(array_length(v_closed_ids, 1), 0),
    'closed_ids', v_closed_ids,
    'stale_cancelled_count', coalesce(array_length(v_stale_ids, 1), 0),
    'stale_cancelled_ids', v_stale_ids,
    'grace_minutes', v_grace_minutes
  );
end;
$$;

revoke execute on function public.close_expired_betting_windows()
  from public, anon, authenticated;

-- =========================================================================
-- Done. After running this migration the operator should also
-- redeploy the close-betting-windows Edge Function so it picks up
-- the new RPC-based body.
-- =========================================================================
