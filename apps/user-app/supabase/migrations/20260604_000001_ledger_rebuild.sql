-- LiveRush — Ledger rebuild for the coin economy.
--
-- Three flows still bypass `ledger_entries` today:
--
--   1. `top_up_balance` silently bumps `profiles.balance_cents` without
--      writing a row, and the user-app Coins page top-up history is a
--      hard-coded MOCK_TOP_UPS array.
--   2. The 100-coin starter balance is a `profiles.balance_cents
--      default 10000` — fires on profile insert (before email verify),
--      with no ledger trail tying the credit to a user event.
--   3. Streamer payouts are a mock — `payouts.type='rake_streamer'`
--      rows exist but the studio Withdraw button is a toast. The
--      streamer can never convert collected coins to dollars.
--
-- This migration plugs all three. It also lifts the 6-pack IAP catalogue
-- out of the user-app code into a DB-backed `coin_packs` table so the
-- admin app can edit pricing without a front-end deploy.
--
-- Currency model (locked):
--   • 1 coin = 100 balance_cents internally (unchanged from the betting
--     MVP — the ledger's `amount_cents` is coin × 100).
--   • 1 coin = $0.10 on the storefront and cashout. 100 coins = $10.
--   • Minimum payout request = 1,000 coins = $100. Below that, the
--     studio Profile button stays disabled.
--   • Currency is shown as generic "$" everywhere — actual currency
--     code (USD/AUD/etc.) is deferred. Column names use neutral words
--     (`amount_cash_cents`, `price_dollar_cents`) so we don't have to
--     rename anything when we pick.
--
-- Forward-only: existing balances + ledger rows are NOT rewritten.
-- The 10000 balance_cents that today reads "$100 fiat-think" is
-- reinterpreted as "100 coins" — same integer, new label.

-- =========================================================================
-- 1) Extend ledger_entries — cash side + soft event reference + new types
-- =========================================================================
--
-- `amount_cash_cents` records the dollar-cent side of a top-up or
-- payout. Null for pure coin movements (bet/refund/rake/etc.) so we
-- don't pollute the existing pari-mutuel rows.
--
-- `event_id` is a free-text soft reference. NO FK — that's deliberate.
-- The old place_bet / settle_event flows already encode the event in
-- the `account` string (`event_pool:<id>`); this column is purely for
-- the admin Ledger UI's "Event" column on the new rows.
--
-- Both columns are deliberately excluded from the hash-chain trigger
-- (see ledger_entry_chain) — adding them to the hash would invalidate
-- every prior row's `self_hash`. They are display columns, not chain
-- inputs. Old rows continue to verify; new rows chain on the same
-- inputs.

alter table public.ledger_entries
  add column if not exists amount_cash_cents bigint,
  add column if not exists event_id          text;

alter table public.ledger_entries
  drop constraint if exists ledger_entries_type_check;

alter table public.ledger_entries
  add constraint ledger_entries_type_check check (type in (
    -- Phase 1 betting MVP types (unchanged):
    'deposit', 'bet', 'withdrawal',
    'payout_pending', 'payout_credit', 'payout_reverse',
    'refund', 'rake', 'residual', 'adjustment',
    -- NEW for the coin economy:
    'top_up',          -- user buys coins; account='user:<uid>', amount_cents=+coins*100, amount_cash_cents=+dollar_paid
    'top_up_received', -- platform cash inflow; account='platform_cash', amount_cents=0, amount_cash_cents=+dollar_paid
    'starter_grant',   -- 100 coins on email verification; account='user:<uid>', amount_cents=+10000
    'payout_request',  -- streamer requests cashout; account='user:<uid>', amount_cents=-coins*100, amount_cash_cents=-dollar_owed
    'payout_paid'      -- moderator approves cashout; account='platform_cash', amount_cents=0, amount_cash_cents=-dollar_paid_out
  ));

create index if not exists ledger_entries_event_idx
  on public.ledger_entries(event_id)
  where event_id is not null;

-- =========================================================================
-- 2) Drop the column default — starter balance moves to a verified-email
--    trigger so the credit is auditable. Existing rows are not touched.
-- =========================================================================

alter table public.profiles
  alter column balance_cents drop default;

-- Set unconfirmed-user default to 0 so new sign-ups land at 0 until
-- email_confirmed_at flips. Existing users keep whatever balance they
-- had.
alter table public.profiles
  alter column balance_cents set default 0;

-- =========================================================================
-- 3) handle_new_user — drop the 10000 seed; balance lands at 0
-- =========================================================================
--
-- Welcome notification still goes out, copy updated to reflect that
-- the 100 starter coins land after email verification.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display text;
begin
  v_display := coalesce(
    new.raw_user_meta_data->>'display_name',
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, display_name, balance_cents)
  values (new.id, v_display, 0)
  on conflict (id) do nothing;

  insert into public.notifications (user_id, type, title, body, event_id, read, created_at) values
    (
      new.id, 'welcome',
      'Welcome to LiveRush ⚡',
      'Confirm your email to claim 100 starter coins and place your first bet on a live challenge!',
      null, false, now()
    );

  return new;
end;
$$;

-- =========================================================================
-- 4) handle_email_confirmed — fires once when a user verifies their
--    email, credits 100 coins, writes the starter_grant ledger row.
-- =========================================================================
--
-- Trigger guard: only fire on the first null→not-null transition of
-- `email_confirmed_at`. Re-confirms / unrelated UPDATEs do nothing.

create or replace function public.handle_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance bigint;
begin
  if new.email_confirmed_at is not null
     and old.email_confirmed_at is null then
    update public.profiles
      set balance_cents = balance_cents + 10000  -- 100 coins
      where id = new.id
      returning balance_cents into v_new_balance;

    -- Profile row may not exist yet on edge cases; guard the ledger
    -- write rather than crashing the email-confirm flow.
    if v_new_balance is not null then
      insert into public.ledger_entries (
        account, type, amount_cents, balance_after_cents, reference_id
      ) values (
        'user:' || new.id::text,
        'starter_grant',
        10000,
        v_new_balance,
        'signup:' || new.id::text
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_email_confirmed on auth.users;
create trigger on_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.handle_email_confirmed();

-- =========================================================================
-- 5) top_up_balance — rewritten signature: (coins, cash_cents)
-- =========================================================================
--
-- Old: top_up_balance(p_amount_cents integer) — silent, no ledger row.
-- New: top_up_balance(p_coins integer, p_cash_cents integer)
--
-- Writes two ledger rows in one transaction:
--   • user_side: account='user:<uid>', type='top_up',
--                amount_cents=+p_coins*100, amount_cash_cents=+p_cash_cents
--   • platform_side: account='platform_cash', type='top_up_received',
--                    amount_cents=0, amount_cash_cents=+p_cash_cents
--
-- Returns coins_added + new_balance_cents + cash_cents for the toast.

-- Drop the old signature first so signatures don't collide.
drop function if exists public.top_up_balance(integer);

create or replace function public.top_up_balance(
  p_coins      integer,
  p_cash_cents integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid;
  v_new_balance  bigint;
  v_topup_id     uuid := gen_random_uuid();
  v_amount_cents bigint;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_coins is null or p_coins <= 0 then
    raise exception 'Top-up coin count must be positive' using errcode = '22023';
  end if;
  if p_cash_cents is null or p_cash_cents <= 0 then
    raise exception 'Top-up cash amount must be positive' using errcode = '22023';
  end if;

  -- Sanity caps — $10,000 single top-up, 100k coins single top-up.
  if p_cash_cents > 1000000 then
    raise exception 'Exceeds top-up limit ($10,000)' using errcode = '22023';
  end if;
  if p_coins > 100000 then
    raise exception 'Exceeds top-up limit (100,000 coins)' using errcode = '22023';
  end if;

  v_amount_cents := p_coins::bigint * 100;

  update public.profiles
    set balance_cents = balance_cents + v_amount_cents
    where id = v_user_id
    returning balance_cents into v_new_balance;

  if v_new_balance is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  -- User-side ledger row: coins in + cash paid recorded.
  insert into public.ledger_entries (
    account, type, amount_cents, balance_after_cents,
    amount_cash_cents, reference_id
  ) values (
    'user:' || v_user_id::text,
    'top_up',
    v_amount_cents,
    v_new_balance,
    p_cash_cents,
    v_topup_id::text
  );

  -- Platform-side ledger row: cash inflow recorded on a separate
  -- 'platform_cash' account so it doesn't mix with rake earnings.
  -- amount_cents=0 because no coin movement on the platform side.
  insert into public.ledger_entries (
    account, type, amount_cents,
    amount_cash_cents, reference_id
  ) values (
    'platform_cash',
    'top_up_received',
    0,
    p_cash_cents,
    v_topup_id::text
  );

  -- Friendly notification — copy uses bare digits so the front-end
  -- Notifications page glyph-substitution lands the coin icon.
  insert into public.notifications (user_id, type, title, body) values (
    v_user_id,
    'top_up',
    '+' || to_char(p_coins, 'FM999,990') || ' coins added to your balance',
    'Virtual prototype balance — no real money is taken.'
  );

  return json_build_object(
    'topup_id', v_topup_id,
    'coins_added', p_coins,
    'amount_cents', v_amount_cents,
    'cash_cents', p_cash_cents,
    'new_balance_cents', v_new_balance
  );
end;
$$;

grant execute on function public.top_up_balance(integer, integer) to authenticated;

-- =========================================================================
-- 6) payouts.event_id — allow null for cashout requests
-- =========================================================================
--
-- Streamer-initiated cashout requests live in the same `payouts` table
-- as per-event rake payouts (so the admin Approve flow stays one code
-- path) but they don't belong to any single event. Drop the NOT NULL
-- constraint so a `request_payout` can write a row with null event_id.

alter table public.payouts
  alter column event_id drop not null;

-- =========================================================================
-- 7) request_payout — streamer initiates a coin → dollar cashout
-- =========================================================================
--
-- Validates: signed-in user, ≥ MIN_PAYOUT_COINS (1000), sufficient
-- balance. Atomically:
--   • debits the user's profile balance
--   • writes a `payout_request` ledger row on user:<uid> with the
--     negative coin amount + negative cash amount
--   • inserts a `payouts` row with type='rake_streamer',
--     recipient_kind='streamer', event_id=null, status='pending'
--
-- Admin approval is handled by the existing approve_payout flow (with
-- a new branch added below that writes the platform_cash debit).

create or replace function public.request_payout(p_coins integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_cash_cents  bigint;
  v_new_balance bigint;
  v_payout_id   uuid;
  v_amount_cents bigint;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_coins is null or p_coins < 1000 then
    raise exception 'Minimum payout is 1,000 coins ($100)' using errcode = '22023';
  end if;

  v_amount_cents := p_coins::bigint * 100;
  v_cash_cents := p_coins::bigint * 10;  -- 1 coin = 10 dollar cents ($0.10)

  -- Atomic debit guarded by the balance check inside the UPDATE — if
  -- the user doesn't have enough coins, no row matches and the RETURNING
  -- clause returns NULL.
  update public.profiles
    set balance_cents = balance_cents - v_amount_cents
    where id = v_user_id
      and balance_cents >= v_amount_cents
    returning balance_cents into v_new_balance;

  if v_new_balance is null then
    raise exception 'Insufficient balance' using errcode = '22023';
  end if;

  insert into public.payouts (
    type, recipient_id, recipient_kind, amount_cents,
    event_id, status
  ) values (
    'rake_streamer', v_user_id, 'streamer', v_amount_cents,
    null, 'pending'
  ) returning id into v_payout_id;

  insert into public.ledger_entries (
    account, type, amount_cents, balance_after_cents,
    amount_cash_cents, reference_id
  ) values (
    'user:' || v_user_id::text,
    'payout_request',
    -v_amount_cents,
    v_new_balance,
    -v_cash_cents,
    v_payout_id::text
  );

  return json_build_object(
    'payout_id', v_payout_id,
    'coins', p_coins,
    'cash_cents', v_cash_cents,
    'new_balance_cents', v_new_balance
  );
end;
$$;

grant execute on function public.request_payout(integer) to authenticated;

-- =========================================================================
-- 8) approve_payout_internal — extend to handle cashout requests
-- =========================================================================
--
-- The admin Approve flow already credits the recipient's profile +
-- writes a payout_credit ledger row when the recipient is a viewer or
-- streamer. For cashout requests (event_id is null), the user's
-- balance was ALREADY debited by request_payout — so we must NOT
-- double-debit, and instead write a `payout_paid` row against
-- platform_cash to record the cash outflow.

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

  -- A cashout request is a `rake_streamer` payout with null event_id:
  -- request_payout already debited the user, so we just record the
  -- platform-cash outflow.
  v_is_cashout := (
    v_payout.event_id is null
    and v_payout.type = 'rake_streamer'
  );

  if v_is_cashout then
    -- Platform-cash debit. 1 coin = $0.10, so coins → cash cents = ×10
    -- relative to the amount_cents=coins*100 stored on the payout row,
    -- or equivalently amount_cents / 10.
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
  elsif v_payout.recipient_kind in ('viewer', 'streamer')
        and v_payout.recipient_id is not null then
    -- Per-event payout: credit the recipient's balance.
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
    -- Platform bucket — rake / residual / refund.
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
    'is_cashout', v_is_cashout
  );
end;
$$;

-- =========================================================================
-- 9) reject_payout_internal — handle cashout-request rejection
-- =========================================================================
--
-- The default reject path reverses the payout_pending on the event
-- pool. For cashout requests there's no event pool; instead, refund
-- the user by re-crediting their balance + writing a positive ledger
-- row tied to the payout id, so the chain stays balanced.

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
  v_new_balance bigint;
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
    -- Refund the user's coins. 1 coin = $0.10, so amount_cash_cents
    -- mirrors the original sign on `request_payout` (positive here
    -- because we're undoing the negative).
    v_cash_cents := v_payout.amount_cents / 10;
    update public.profiles
      set balance_cents = balance_cents + v_payout.amount_cents
      where id = v_payout.recipient_id
      returning balance_cents into v_new_balance;

    insert into public.ledger_entries (
      account, type, amount_cents, balance_after_cents,
      amount_cash_cents, reference_id
    ) values (
      'user:' || v_payout.recipient_id::text,
      'refund',
      v_payout.amount_cents,
      v_new_balance,
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
-- 10) coin_packs — IAP catalogue table editable by admins
-- =========================================================================
--
-- Replaces the hard-coded COIN_PACKS array in
-- apps/user-app/src/pages/user/Coins.tsx. Per-row Stripe product_id is
-- a free-text field — leave blank until Stripe is wired.

create table if not exists public.coin_packs (
  id                 uuid primary key default gen_random_uuid(),
  coins              integer not null check (coins > 0),
  price_dollar_cents bigint  not null check (price_dollar_cents > 0),
  stripe_product_id  text,
  sort_order         integer not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists coin_packs_active_idx
  on public.coin_packs(sort_order)
  where is_active = true;

alter table public.coin_packs enable row level security;

drop policy if exists "Anyone reads active coin packs" on public.coin_packs;
create policy "Anyone reads active coin packs"
  on public.coin_packs
  for select
  to authenticated
  using (is_active = true);

drop policy if exists "Admins read all coin packs" on public.coin_packs;
create policy "Admins read all coin packs"
  on public.coin_packs
  for select
  to authenticated
  using (public.is_admin());

-- Seed the 6 flat-rate packs at $0.10/coin baseline. Operator can edit
-- + add + delete from the admin Settings page.
insert into public.coin_packs (coins, price_dollar_cents, sort_order)
select * from (values
  (100,    1000::bigint,   1),
  (500,    5000::bigint,   2),
  (1000,   10000::bigint,  3),
  (2500,   25000::bigint,  4),
  (5000,   50000::bigint,  5),
  (10000,  100000::bigint, 6)
) as seed(coins, price_dollar_cents, sort_order)
where not exists (select 1 from public.coin_packs limit 1);

-- Realtime publication so the user-app Coins page picks up admin
-- edits without a refresh.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table public.coin_packs;
  end if;
exception
  when duplicate_object then null;
end$$;

-- =========================================================================
-- 11) Coin-pack admin RPCs (SECURITY DEFINER, is_admin() gated)
-- =========================================================================

create or replace function public.list_coin_packs()
returns table (
  id                 uuid,
  coins              integer,
  price_dollar_cents bigint,
  stripe_product_id  text,
  sort_order         integer,
  is_active          boolean,
  dollar_per_coin_cents numeric,
  created_at         timestamptz,
  updated_at         timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.coins, p.price_dollar_cents, p.stripe_product_id,
    p.sort_order, p.is_active,
    -- price_dollar_cents / coins — surfaced so the admin UI doesn't
    -- recompute the per-coin rate row-by-row.
    round(p.price_dollar_cents::numeric / nullif(p.coins, 0)::numeric, 4)
      as dollar_per_coin_cents,
    p.created_at, p.updated_at
  from public.coin_packs p
  order by p.sort_order asc, p.created_at asc;
end;
$$;

grant execute on function public.list_coin_packs() to authenticated;

create or replace function public.upsert_coin_pack(
  p_id                 uuid,
  p_coins              integer,
  p_price_dollar_cents bigint,
  p_stripe_product_id  text,
  p_sort_order         integer,
  p_is_active          boolean
)
returns public.coin_packs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.coin_packs;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_coins is null or p_coins <= 0 then
    raise exception 'coins must be positive' using errcode = '22023';
  end if;
  if p_price_dollar_cents is null or p_price_dollar_cents <= 0 then
    raise exception 'price must be positive' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.coin_packs (
      coins, price_dollar_cents, stripe_product_id, sort_order, is_active
    ) values (
      p_coins, p_price_dollar_cents, p_stripe_product_id,
      coalesce(p_sort_order, 0), coalesce(p_is_active, true)
    ) returning * into v_row;
  else
    update public.coin_packs set
      coins              = p_coins,
      price_dollar_cents = p_price_dollar_cents,
      stripe_product_id  = p_stripe_product_id,
      sort_order         = coalesce(p_sort_order, sort_order),
      is_active          = coalesce(p_is_active, is_active),
      updated_at         = now()
    where id = p_id
    returning * into v_row;

    if v_row.id is null then
      raise exception 'coin pack not found' using errcode = '23503';
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function public.upsert_coin_pack(
  uuid, integer, bigint, text, integer, boolean
) to authenticated;

create or replace function public.delete_coin_pack(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.coin_packs where id = p_id;
end;
$$;

grant execute on function public.delete_coin_pack(uuid) to authenticated;

-- =========================================================================
-- 12) get_platform_cash_treasury — cash side of the admin Wallet split
-- =========================================================================
--
-- Lifetime cash net = sum(amount_cash_cents) where account='platform_cash'.
-- top_up_received adds, payout_paid subtracts. Distinct from
-- get_platform_earnings (which sums rake/residual coin earnings on the
-- 'platform' account).

create or replace function public.get_platform_cash_treasury()
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_net_cents bigint;
  v_inflow_cents bigint;
  v_outflow_cents bigint;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select coalesce(sum(amount_cash_cents), 0)
    into v_net_cents
  from public.ledger_entries
  where account = 'platform_cash';

  select coalesce(sum(amount_cash_cents), 0)
    into v_inflow_cents
  from public.ledger_entries
  where account = 'platform_cash'
    and type = 'top_up_received';

  select coalesce(-sum(amount_cash_cents), 0)
    into v_outflow_cents
  from public.ledger_entries
  where account = 'platform_cash'
    and type = 'payout_paid';

  return json_build_object(
    'net_cash_cents', v_net_cents,
    'inflow_cents',   v_inflow_cents,
    'outflow_cents',  v_outflow_cents
  );
end;
$$;

grant execute on function public.get_platform_cash_treasury() to authenticated;

-- =========================================================================
-- 13) list_admin_ledger — surface amount_cash_cents + event_id columns
-- =========================================================================
--
-- Same keyset pagination, same role resolution. Additions:
--   • amount_cash_cents projected straight through
--   • event_id resolution prefers the new soft column when present
--   • platform_cash account gets its own role label so the UI can
--     style cash-side rows distinctly from coin-side platform rows.

drop function if exists public.list_admin_ledger(integer, timestamptz);

create function public.list_admin_ledger(
  p_limit  integer default 50,
  p_cursor timestamptz default null
)
returns table (
  id                uuid,
  account           text,
  account_role      text,
  account_label     text,
  account_id        text,
  type              text,
  amount_cents      bigint,
  amount_cash_cents bigint,
  reference_id      text,
  event_id          text,
  event_title       text,
  created_at        timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  with raw as (
    select
      l.id,
      l.account,
      l.type,
      l.amount_cents,
      l.amount_cash_cents,
      l.balance_after_cents,
      l.reference_id,
      l.event_id as explicit_event_id,
      l.created_at,
      case
        when l.account = 'platform'      then 'platform'
        when l.account = 'platform_cash' then 'platform_cash'
        when l.account like 'event_pool:%' then 'event_pool'
        when l.account like 'user:%'      then 'user'
        else 'unknown'
      end as kind,
      case
        when l.account like 'user:%' or l.account like 'event_pool:%'
          then split_part(l.account, ':', 2)
        else null
      end as ident
    from public.ledger_entries l
    where p_cursor is null or l.created_at < p_cursor
    order by l.created_at desc, l.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ),
  enriched as (
    select
      r.*,
      coalesce(
        r.explicit_event_id,
        case when r.kind = 'event_pool' then r.ident end,
        (select p.event_id from public.payouts p
          where p.id::text = r.reference_id limit 1),
        (select b.event_id from public.bets b
          where b.id::text = r.reference_id limit 1)
      ) as resolved_event_id,
      case
        when r.kind = 'user' and r.type = 'payout_credit' and exists (
          select 1 from public.payouts p
          where p.id::text = r.reference_id
            and p.type = 'rake_streamer'
        ) then 'creator'
        when r.kind = 'user' then 'viewer'
        else r.kind
      end as resolved_role
    from raw r
  )
  select
    e.id,
    e.account,
    e.resolved_role,
    case
      when e.resolved_role = 'platform'      then 'Platform'
      when e.resolved_role = 'platform_cash' then 'Platform cash'
      when e.resolved_role = 'event_pool'    then 'Event pool'
      when e.resolved_role = 'creator' then (
        select coalesce(c.display_name, '@' || c.handle)
        from public.creator_profiles c
        where c.id::text = e.ident
      )
      when e.resolved_role = 'viewer' then coalesce(
        (select p.display_name from public.profiles p where p.id::text = e.ident),
        (select u.email::text from auth.users u where u.id::text = e.ident),
        'Viewer'
      )
      else e.account
    end as account_label,
    case
      when e.kind in ('user', 'event_pool') then e.ident
      else null
    end as account_id,
    e.type,
    e.amount_cents,
    e.amount_cash_cents,
    e.reference_id,
    e.resolved_event_id,
    (select ev.title from public.events ev where ev.id = e.resolved_event_id),
    e.created_at
  from enriched e
  order by e.created_at desc, e.id desc;
end;
$$;

grant execute on function public.list_admin_ledger(integer, timestamptz) to authenticated;

-- =========================================================================
-- Done. Operator next steps:
--   1. Run this migration in Supabase SQL Editor.
--   2. Regenerate the TS types:
--        pnpm supabase gen types typescript --project-id <id> \
--          --schema public > apps/user-app/src/integrations/supabase/types.ts
--      Then mirror the file to apps/studio + apps/admin-app.
--   3. No data backfill required — old balances + ledger rows are
--      untouched; new flows write proper rows from here on.
-- =========================================================================

notify pgrst, 'reload schema';
