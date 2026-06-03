-- LiveRush — split streamer earnings off `profiles.balance_cents`.
--
-- Bug surfaced on the studio Profile "Available to cash out" card:
-- it was reading `profiles.balance_cents`, but that column is one pot
-- mixing TWO different things:
--
--   • Spendable coins — top-ups + starter grant + bet winnings +
--     refunds. The user-app uses these to place bets. NOT withdrawable.
--   • Earned rake — 5% streamer commission on each settled event pool.
--     Should be withdrawable via `request_payout`.
--
-- The Phase 1 betting MVP credited `rake_streamer` payouts into
-- `balance_cents` because there was no cashout flow yet. Now that the
-- ledger rebuild lit up Request payout, the two pots have to come
-- apart — otherwise a streamer can withdraw money they were "given"
-- via the starter grant or won by betting on someone else's stream.
--
-- This migration adds `profiles.withdrawable_cents` as the canonical
-- cashable pot and rewires the three Phase-1 RPCs to use it. Existing
-- streamers get a one-time backfill so their already-earned rake
-- moves out of `balance_cents` into the new column.

-- =========================================================================
-- 1) New column — cashable balance
-- =========================================================================

alter table public.profiles
  add column if not exists withdrawable_cents bigint not null default 0
    check (withdrawable_cents >= 0);

-- =========================================================================
-- 2) Backfill — pull historical rake earnings out of balance_cents
-- =========================================================================
--
-- For every profile that has ever received a completed rake_streamer
-- payout, sum the amount and:
--   • set `withdrawable_cents` to that sum (their cashable rake)
--   • subtract the same amount from `balance_cents` (capped at 0 so
--     creators who already spent rake on bets don't go negative)
--
-- After this, `balance_cents` reflects ONLY spending money, and
-- `withdrawable_cents` reflects ONLY earned rake. Going forward, the
-- two pots stay separate via the RPC changes below.

with rake_sum as (
  select
    recipient_id as user_id,
    sum(amount_cents)::bigint as earned_cents
  from public.payouts
  where type = 'rake_streamer'
    and status = 'completed'
    and recipient_id is not null
  group by recipient_id
)
update public.profiles p
set
  withdrawable_cents = rake_sum.earned_cents,
  balance_cents      = greatest(0, p.balance_cents - rake_sum.earned_cents)
from rake_sum
where p.id = rake_sum.user_id;

-- =========================================================================
-- 3) approve_payout_internal — rake_streamer per-event credits go to
--    `withdrawable_cents`, not `balance_cents`. Winner / viewer-side
--    payouts keep landing on `balance_cents` (still spendable).
-- =========================================================================

create or replace function public.approve_payout_internal(
  p_payout_id       uuid,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout      public.payouts%rowtype;
  v_new_balance bigint;
  v_account     text;
  v_cash_cents  bigint;
  v_is_cashout  boolean;
  v_is_rake     boolean;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  select * into v_payout from public.payouts where id = p_payout_id for update;
  if v_payout.id is null then
    raise exception 'Payout not found' using errcode = '23503';
  end if;

  if v_payout.status = 'completed' then
    return json_build_object('idempotent_replay', true, 'payout_id', p_payout_id);
  end if;
  if v_payout.status <> 'pending' and v_payout.status <> 'approved' then
    raise exception 'Payout is not pending (got %)', v_payout.status
      using errcode = '22023';
  end if;

  -- Cashout request: rake_streamer with null event_id. The user's
  -- withdrawable_cents was already debited by request_payout — just
  -- record the platform-cash outflow.
  v_is_cashout := (
    v_payout.event_id is null
    and v_payout.type = 'rake_streamer'
  );

  -- Per-event streamer rake: credit withdrawable_cents (the cashable
  -- pot), NOT balance_cents (spending money).
  v_is_rake := (
    v_payout.event_id is not null
    and v_payout.type = 'rake_streamer'
    and v_payout.recipient_id is not null
  );

  if v_is_cashout then
    v_cash_cents := v_payout.amount_cents / 10;
    insert into public.ledger_entries (
      account, type, amount_cents,
      amount_cash_cents, reference_id
    ) values (
      'platform_cash',
      'payout_paid',
      0,
      -v_cash_cents,
      v_payout.id::text
    );
  elsif v_is_rake then
    -- Earned rake → cashable pot. Ledger row still goes on user:<id>
    -- so the chain stays continuous for that account; `balance_after_cents`
    -- is left NULL because the credit lands on withdrawable_cents, not
    -- balance_cents, and we don't denormalize cashable totals onto
    -- every row (the running total is in profiles.withdrawable_cents).
    update public.profiles
    set withdrawable_cents = withdrawable_cents + v_payout.amount_cents
    where id = v_payout.recipient_id;

    v_account := 'user:' || v_payout.recipient_id::text;
    insert into public.ledger_entries (
      account, type, amount_cents, reference_id
    ) values (
      v_account, 'payout_credit', v_payout.amount_cents, v_payout.id::text
    );
  elsif v_payout.recipient_kind in ('viewer', 'streamer')
        and v_payout.recipient_id is not null then
    -- Viewer payout (bet winnings) or non-rake streamer payout:
    -- credit spendable balance.
    update public.profiles
    set balance_cents = balance_cents + v_payout.amount_cents
    where id = v_payout.recipient_id
    returning balance_cents into v_new_balance;

    v_account := 'user:' || v_payout.recipient_id::text;
    insert into public.ledger_entries (
      account, type, amount_cents, balance_after_cents, reference_id
    ) values (
      v_account, 'payout_credit', v_payout.amount_cents, v_new_balance, v_payout.id::text
    );
  else
    -- Platform bucket — rake_platform / residual / refund.
    v_account := 'platform';
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values (
      v_account,
      case when v_payout.type = 'rake_platform' then 'rake'
           when v_payout.type = 'residual'      then 'residual'
           else 'payout_credit' end,
      v_payout.amount_cents,
      v_payout.id::text
    );
  end if;

  update public.payouts
  set status        = 'completed',
      approved_at   = coalesce(approved_at, now()),
      completed_at  = now(),
      idempotency_key = coalesce(idempotency_key, p_idempotency_key)
  where id = p_payout_id;

  if v_payout.type = 'winner' and v_payout.bet_id is not null then
    update public.bets
    set status        = 'won',
        settled_at    = now(),
        payout_cents  = v_payout.amount_cents
    where id = v_payout.bet_id;
  end if;

  return json_build_object(
    'idempotent_replay', false,
    'payout_id', p_payout_id,
    'new_balance_cents', v_new_balance,
    'is_cashout', v_is_cashout,
    'is_rake', v_is_rake
  );
end;
$$;

-- =========================================================================
-- 4) request_payout — debit withdrawable_cents, not balance_cents
-- =========================================================================

create or replace function public.request_payout(p_coins integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
  v_cash_cents     bigint;
  v_amount_cents   bigint;
  v_new_withdrawable bigint;
  v_payout_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_coins is null or p_coins < 1000 then
    raise exception 'Minimum payout is 1,000 coins ($100)' using errcode = '22023';
  end if;

  v_amount_cents := p_coins::bigint * 100;
  v_cash_cents   := p_coins::bigint * 10;

  update public.profiles
    set withdrawable_cents = withdrawable_cents - v_amount_cents
    where id = v_user_id
      and withdrawable_cents >= v_amount_cents
    returning withdrawable_cents into v_new_withdrawable;

  if v_new_withdrawable is null then
    raise exception 'Insufficient cashable balance' using errcode = '22023';
  end if;

  insert into public.payouts (
    type, recipient_id, recipient_kind, amount_cents,
    event_id, status
  ) values (
    'rake_streamer', v_user_id, 'streamer', v_amount_cents,
    null, 'pending'
  ) returning id into v_payout_id;

  -- Ledger row records the cashout request on the user's account.
  -- balance_after_cents is left NULL because this debit is against
  -- withdrawable_cents (the cashable pot), not balance_cents — and we
  -- don't denormalize the cashable running total onto every row.
  insert into public.ledger_entries (
    account, type, amount_cents,
    amount_cash_cents, reference_id
  ) values (
    'user:' || v_user_id::text,
    'payout_request',
    -v_amount_cents,
    -v_cash_cents,
    v_payout_id::text
  );

  return json_build_object(
    'payout_id', v_payout_id,
    'coins', p_coins,
    'cash_cents', v_cash_cents,
    'new_withdrawable_cents', v_new_withdrawable
  );
end;
$$;

grant execute on function public.request_payout(integer) to authenticated;

-- =========================================================================
-- 5) reject_payout_internal — refund cashout requests to withdrawable_cents
-- =========================================================================

create or replace function public.reject_payout_internal(
  p_payout_id uuid,
  p_reason    text,
  p_notes     text default null
)
returns public.payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout      public.payouts%rowtype;
  v_row         public.payouts;
  v_cash_cents  bigint;
  v_is_cashout  boolean;
begin
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if v_payout.id is null then
    raise exception 'Payout not found' using errcode = '23503';
  end if;
  if v_payout.status not in ('pending', 'approved') then
    raise exception 'Payout cannot be rejected from status %', v_payout.status
      using errcode = '22023';
  end if;

  v_is_cashout := (
    v_payout.event_id is null
    and v_payout.type = 'rake_streamer'
  );

  update public.payouts
  set status        = 'rejected',
      reject_reason = coalesce(p_reason, 'unspecified'),
      reject_notes  = p_notes
  where id = p_payout_id
  returning * into v_row;

  if v_is_cashout then
    -- Refund cashout: re-credit withdrawable_cents (not balance_cents),
    -- and write a positive ledger row tied to the payout id so the
    -- chain stays balanced.
    v_cash_cents := v_payout.amount_cents / 10;
    update public.profiles
      set withdrawable_cents = withdrawable_cents + v_payout.amount_cents
      where id = v_payout.recipient_id;

    insert into public.ledger_entries (
      account, type, amount_cents,
      amount_cash_cents, reference_id
    ) values (
      'user:' || v_payout.recipient_id::text,
      'refund',
      v_payout.amount_cents,
      v_cash_cents,
      v_payout.id::text
    );
  else
    -- Per-event payout: reverse the pending on the pool.
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values (
      'event_pool:' || v_payout.event_id,
      'payout_reverse',
      v_payout.amount_cents,
      v_payout.id::text
    );
  end if;

  return v_row;
end;
$$;

-- =========================================================================
-- Done. Operator next steps:
--   1. Run this migration in Supabase SQL Editor.
--   2. No code regen needed beyond the studio reading the new
--      `profiles.withdrawable_cents` column (front-end commit ships
--      together with this migration).
-- =========================================================================

notify pgrst, 'reload schema';
