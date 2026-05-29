-- LiveRush — Phase 1 betting polish hotfix
--
-- Three small adjustments to the betting MVP shipped in
-- 20260529_000001_betting_mvp.sql:
--
--   1. Enforce one bet per (user, event) inside place_bet. The
--      MAX_BET=$10 stake cap only enforces per-bet; without a
--      per-event guard a user could multi-bet to dominate a small
--      pool. Refunded/lost bets don't block — only active positions.
--
--   2. Fix the cancel_event recursion: when settle_event calls
--      cancel_event, the inner status check rejected the cancellation
--      because the event was in `pending_moderation`. Loosen the
--      blocker so settle_event's auto-cancel branch works.
--
--   3. Fully-qualify the digest() calls in the trigger + helper —
--      same as the 20260529_000001 hotfix applied via SQL Editor.
--      This makes the migration file repeat-safe when applied to a
--      fresh database.

-- =========================================================================
-- 1) place_bet: one bet per (user, event)
-- =========================================================================

drop function if exists public.place_bet(text, text, integer, uuid);

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

  -- Idempotency replay short-circuit on (user, idempotency_key).
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
      'outcome_pool_cents', v_new_pool
    );
  end if;

  -- One bet per (user, event). Refunded / lost bets don't block —
  -- only an active position does (status in placed/won_pending_payout/won/open).
  if exists (
    select 1 from public.bets
    where user_id = v_user_id
      and event_id = p_event_id
      and status in ('open', 'placed', 'won_pending_payout', 'won')
  ) then
    raise exception 'already_bet: only one bet per event allowed'
      using errcode = '22023';
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
    odds_snapshot, status, idempotency_key
  ) values (
    v_user_id, p_event_id, p_outcome_id, p_amount_cents,
    coalesce(v_live_odds, 1.01),
    v_live_odds, 'placed', p_idempotency_key
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
    'outcome_pool_cents', v_new_pool
  );
end;
$$;
grant execute on function public.place_bet(text, text, integer, uuid) to authenticated;

-- =========================================================================
-- 2) cancel_event: accept the pending_moderation entry path
-- =========================================================================
--
-- settle_event calls cancel_event when MIN_UNIQUE_BETTORS or
-- MIN_OUTCOMES_WITH_BETS fail. At that point the event is in
-- 'pending_moderation', not 'live'. The original guard rejected this.

create or replace function public.cancel_event(
  p_event_id text,
  p_reason   text default 'cancelled'
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event public.events%rowtype;
  v_payout_id uuid;
  v_new_balance bigint;
  v_pool_remaining bigint;
  b record;
  v_row public.events;
begin
  v_user_id := auth.uid();
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;

  if v_user_id is not null then
    if v_event.creator_id is null or v_event.creator_id <> v_user_id then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
  end if;

  if v_event.status = 'cancelled' then
    return v_event;
  end if;
  if v_event.status = 'settled' then
    raise exception 'Cannot cancel a settled event' using errcode = '22023';
  end if;

  select coalesce(sum(pool_cents), 0) into v_pool_remaining
  from public.event_outcomes where event_id = p_event_id;

  for b in
    select * from public.bets
    where event_id = p_event_id
      and status in ('open', 'placed', 'won_pending_payout')
  loop
    update public.profiles
    set balance_cents = balance_cents + b.amount_cents
    where id = b.user_id
    returning balance_cents into v_new_balance;

    insert into public.payouts (
      type, recipient_id, recipient_kind, amount_cents,
      event_id, bet_id, status, completed_at
    ) values (
      'refund', b.user_id, 'viewer', b.amount_cents,
      p_event_id, b.id, 'completed', now()
    )
    returning id into v_payout_id;

    update public.bets
    set status = 'refunded', settled_at = now(), payout_cents = b.amount_cents
    where id = b.id;

    v_pool_remaining := v_pool_remaining - b.amount_cents;

    insert into public.ledger_entries (account, type, amount_cents, balance_after_cents, reference_id)
    values
      ('event_pool:' || p_event_id, 'refund', -b.amount_cents, greatest(v_pool_remaining, 0), v_payout_id::text),
      ('user:' || b.user_id::text, 'refund',  b.amount_cents, v_new_balance, v_payout_id::text);
  end loop;

  update public.event_outcomes set pool_cents = 0 where event_id = p_event_id;

  update public.events
  set status           = 'cancelled',
      cancelled_at     = now(),
      cancelled_reason = coalesce(p_reason, 'cancelled')
  where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.cancel_event(text, text) to authenticated;

-- =========================================================================
-- 3) digest() fully-qualified (idempotent — already applied in prod)
-- =========================================================================

create or replace function public.ledger_entry_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;
  if new.created_at is null then
    new.created_at := now();
  end if;

  select last_hash into v_prev_hash
  from public.ledger_chain_tail
  where account = new.account
  for update;

  new.prev_hash := coalesce(v_prev_hash, '');
  new.self_hash := encode(
    extensions.digest(
      new.id::text || '|' ||
      new.account || '|' ||
      new.type || '|' ||
      new.amount_cents::text || '|' ||
      coalesce(new.balance_after_cents::text, '') || '|' ||
      coalesce(new.reference_id, '') || '|' ||
      to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      new.prev_hash,
      'sha256'
    ),
    'hex'
  );

  insert into public.ledger_chain_tail (account, last_hash, last_id, updated_at)
  values (new.account, new.self_hash, new.id, now())
  on conflict (account) do update
    set last_hash  = excluded.last_hash,
        last_id    = excluded.last_id,
        updated_at = now();

  return new;
end;
$$;

create or replace function public.derive_payout_key(
  p_parent uuid,
  p_name   text
)
returns uuid
language sql
immutable
as $$
  select (
    substr(h, 1, 8)  || '-' ||
    substr(h, 9, 4)  || '-' ||
    substr(h, 13, 4) || '-' ||
    substr(h, 17, 4) || '-' ||
    substr(h, 21, 12)
  )::uuid
  from (
    select encode(extensions.digest(p_parent::text || ':' || p_name, 'sha256'), 'hex') as h
  ) s;
$$;

revoke execute on function public.ledger_entry_chain() from public, anon, authenticated;
revoke execute on function public.derive_payout_key(uuid, text) from public, anon, authenticated;

-- =========================================================================
-- Done.
-- =========================================================================
