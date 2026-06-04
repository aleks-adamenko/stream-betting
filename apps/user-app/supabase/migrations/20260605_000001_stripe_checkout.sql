-- LiveRush — Stripe Checkout integration for the Coins IAP flow.
--
-- Before this migration the user-app's CheckoutModal was a fake card
-- form that immediately called `top_up_balance` to credit the balance —
-- no actual payment processor. This migration adds the server-side
-- pieces a real Stripe Checkout flow needs:
--
--   • `top_up_attempts` table — one row per started checkout session.
--     Acts as the idempotency anchor for the webhook (stripe_session_id
--     is unique). Status flips pending → completed | expired | failed.
--   • `create_top_up_attempt` — called from the create-checkout-session
--     edge function. Resolves coins + price server-side from
--     `coin_packs` so the client can't tamper with the amount.
--   • `attach_stripe_session` — sets the session id on the row after
--     Stripe returns the Checkout Session.
--   • `complete_top_up_attempt` — called from the stripe-webhook edge
--     function on `checkout.session.completed`. Idempotent: returns
--     `{idempotent_replay: true}` on duplicate deliveries. Inlines the
--     existing ledger-write math from `top_up_balance` so it doesn't
--     need an `auth.uid()` and runs cleanly as service_role.
--   • `mark_top_up_attempt_failed` — for `checkout.session.expired` and
--     `payment_intent.payment_failed`; flips the row's status.
--
-- Stripe is the source of truth for whether a payment succeeded; the
-- client-side redirect-return is only a UX cue to start polling. AUD
-- only — no FX, no multi-currency Prices.

-- =========================================================================
-- 1) top_up_attempts table + RLS
-- =========================================================================

create table if not exists public.top_up_attempts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  coin_pack_id          uuid not null references public.coin_packs(id) on delete restrict,
  -- Snapshotted at attempt-creation time, NOT looked up at webhook time.
  -- Prevents weird outcomes if the operator edits the pack price
  -- between session create and session complete.
  coins                 integer not null check (coins > 0),
  cash_cents            bigint  not null check (cash_cents > 0),
  -- Set by `attach_stripe_session` immediately after the Stripe API
  -- call. Unique so the webhook can use it as the dedupe key.
  stripe_session_id     text unique,
  status                text not null default 'pending'
                          check (status in ('pending','completed','expired','failed')),
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);

create index if not exists top_up_attempts_user_idx
  on public.top_up_attempts(user_id, created_at desc);

-- Partial index — fastest path for the "is this attempt still
-- outstanding?" check the webhook does on every fire.
create index if not exists top_up_attempts_pending_idx
  on public.top_up_attempts(status)
  where status = 'pending';

alter table public.top_up_attempts enable row level security;

-- Users see their own attempts. The user-app uses this for the
-- "Processing…" banner after redirect-return.
drop policy if exists "Users read own top_up_attempts" on public.top_up_attempts;
create policy "Users read own top_up_attempts"
  on public.top_up_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Admins see every attempt — needed for ops investigations.
drop policy if exists "Admins read all top_up_attempts" on public.top_up_attempts;
create policy "Admins read all top_up_attempts"
  on public.top_up_attempts
  for select
  to authenticated
  using (public.is_admin());

-- No INSERT / UPDATE / DELETE policies — all writes go through the
-- SECURITY DEFINER RPCs below.

-- =========================================================================
-- 2) create_top_up_attempt — authenticated, resolves price server-side
-- =========================================================================
--
-- Returns { attempt_id, user_id, coins, cash_cents, stripe_product_id }
-- so the edge function can build a Stripe Checkout Session with no
-- extra round-trip. The user_id is echoed back so the function can
-- stuff it into Stripe `metadata` for the webhook side.

create or replace function public.create_top_up_attempt(p_coin_pack_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_pack       public.coin_packs%rowtype;
  v_attempt_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Confirm the pack is active. Inactive packs shouldn't be on the
  -- Coins page, but a stale client cache could request one.
  select * into v_pack
  from public.coin_packs
  where id = p_coin_pack_id;
  if v_pack.id is null then
    raise exception 'Coin pack not found' using errcode = '23503';
  end if;
  if not v_pack.is_active then
    raise exception 'Coin pack is not available' using errcode = '22023';
  end if;
  if v_pack.stripe_product_id is null or v_pack.stripe_product_id = '' then
    -- Hard fail with a useful message — operator forgot to paste the
    -- prod_… id into admin Settings.
    raise exception 'Coin pack is missing its Stripe product id' using errcode = '22023';
  end if;

  insert into public.top_up_attempts (
    user_id, coin_pack_id, coins, cash_cents
  ) values (
    v_user_id, v_pack.id, v_pack.coins, v_pack.price_dollar_cents
  )
  returning id into v_attempt_id;

  return json_build_object(
    'attempt_id', v_attempt_id,
    'user_id', v_user_id,
    'coins', v_pack.coins,
    'cash_cents', v_pack.price_dollar_cents,
    'stripe_product_id', v_pack.stripe_product_id
  );
end;
$$;

grant execute on function public.create_top_up_attempt(uuid) to authenticated;

-- =========================================================================
-- 3) attach_stripe_session — fills in the session id after Stripe replies
-- =========================================================================
--
-- The edge function calls this right after `stripe.checkout.sessions.create`
-- so subsequent webhook lookups by session_id can find the row. Only the
-- attempt's owner (or service_role) can update the row.

create or replace function public.attach_stripe_session(
  p_attempt_id uuid,
  p_session_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_owner       uuid;
  v_existing_id text;
begin
  if p_session_id is null or p_session_id = '' then
    raise exception 'Session id required' using errcode = '22023';
  end if;

  select user_id, stripe_session_id into v_owner, v_existing_id
  from public.top_up_attempts
  where id = p_attempt_id
  for update;

  if v_owner is null then
    raise exception 'Attempt not found' using errcode = '23503';
  end if;
  -- Caller must own the attempt; service_role calls bypass auth.uid().
  if v_user_id is not null and v_user_id <> v_owner then
    raise exception 'Not the attempt owner' using errcode = '42501';
  end if;
  -- Don't allow re-attaching once a session id is set — keeps the
  -- 1:1 attempt ↔ session invariant the webhook depends on.
  if v_existing_id is not null then
    raise exception 'Attempt already has a session id' using errcode = '22023';
  end if;

  update public.top_up_attempts
  set stripe_session_id = p_session_id
  where id = p_attempt_id;
end;
$$;

grant execute on function public.attach_stripe_session(uuid, text) to authenticated;

-- =========================================================================
-- 4) complete_top_up_attempt — webhook-only, idempotent ledger write
-- =========================================================================
--
-- Called by stripe-webhook on `checkout.session.completed`. Looks up
-- the attempt by stripe_session_id, and if it's still pending writes
-- the two paired ledger rows + flips status to completed.
--
-- Duplicate deliveries return `{idempotent_replay: true}` with no
-- side effects. This is the *only* path that writes to the user's
-- balance in production — the existing top_up_balance RPC stays as a
-- dev/admin affordance.

create or replace function public.complete_top_up_attempt(p_session_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt      public.top_up_attempts%rowtype;
  v_amount_cents bigint;
  v_new_balance  bigint;
begin
  if p_session_id is null or p_session_id = '' then
    raise exception 'Session id required' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.top_up_attempts
  where stripe_session_id = p_session_id
  for update;

  if v_attempt.id is null then
    raise exception 'Attempt not found for session %', p_session_id
      using errcode = '23503';
  end if;

  -- Idempotent: webhook replays land here. No-op + signal back so the
  -- caller can log it.
  if v_attempt.status = 'completed' then
    return json_build_object(
      'idempotent_replay', true,
      'attempt_id', v_attempt.id,
      'session_id', p_session_id
    );
  end if;
  if v_attempt.status <> 'pending' then
    raise exception 'Attempt is in terminal state %', v_attempt.status
      using errcode = '22023';
  end if;

  v_amount_cents := v_attempt.coins::bigint * 100;

  -- Credit the user's balance. Mirrors the math in top_up_balance —
  -- intentionally inlined so this RPC doesn't depend on auth.uid().
  update public.profiles
    set balance_cents = balance_cents + v_amount_cents
    where id = v_attempt.user_id
    returning balance_cents into v_new_balance;

  if v_new_balance is null then
    raise exception 'Profile not found for attempt %', v_attempt.id
      using errcode = 'P0002';
  end if;

  -- User-side ledger row. reference_id = stripe_session_id so the
  -- user-app can match the webhook-driven row back to the redirect
  -- return URL without polling for an extra column.
  insert into public.ledger_entries (
    account, type, amount_cents, balance_after_cents,
    amount_cash_cents, reference_id
  ) values (
    'user:' || v_attempt.user_id::text,
    'top_up',
    v_amount_cents,
    v_new_balance,
    v_attempt.cash_cents,
    p_session_id
  );

  -- Platform-side cash inflow.
  insert into public.ledger_entries (
    account, type, amount_cents,
    amount_cash_cents, reference_id
  ) values (
    'platform_cash',
    'top_up_received',
    0,
    v_attempt.cash_cents,
    p_session_id
  );

  -- Same friendly notification top_up_balance writes, so the in-app
  -- notifications feed lights up the same way whether the credit
  -- came from Stripe or the dev affordance.
  insert into public.notifications (user_id, type, title, body) values (
    v_attempt.user_id,
    'top_up',
    '+' || to_char(v_attempt.coins, 'FM999,990') || ' coins added to your balance',
    'Payment received — thanks for the support.'
  );

  update public.top_up_attempts
  set status = 'completed',
      completed_at = now()
  where id = v_attempt.id;

  return json_build_object(
    'idempotent_replay', false,
    'attempt_id', v_attempt.id,
    'session_id', p_session_id,
    'coins', v_attempt.coins,
    'cash_cents', v_attempt.cash_cents,
    'new_balance_cents', v_new_balance
  );
end;
$$;

-- Service-role only — clients must NEVER be able to call this directly,
-- they could synthesise a session id and credit themselves. Revoke the
-- default public grant, leave grant for service_role implicit (it
-- bypasses RLS / grant tables anyway).
revoke execute on function public.complete_top_up_attempt(text) from public;
revoke execute on function public.complete_top_up_attempt(text) from authenticated;
revoke execute on function public.complete_top_up_attempt(text) from anon;

-- =========================================================================
-- 5) mark_top_up_attempt_failed — webhook-only status flip
-- =========================================================================
--
-- For `checkout.session.expired` (user abandoned the Stripe page) and
-- `payment_intent.payment_failed` (card declined / 3DS abort). No
-- ledger writes — nothing was credited so nothing needs reversing.

create or replace function public.mark_top_up_attempt_failed(
  p_session_id text,
  p_status     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.top_up_attempts%rowtype;
begin
  if p_session_id is null or p_session_id = '' then
    raise exception 'Session id required' using errcode = '22023';
  end if;
  if p_status not in ('expired', 'failed') then
    raise exception 'Status must be expired or failed (got %)', p_status
      using errcode = '22023';
  end if;

  select * into v_attempt
  from public.top_up_attempts
  where stripe_session_id = p_session_id
  for update;

  if v_attempt.id is null then
    -- Stripe can send expiry events for sessions we never tracked
    -- (very unlikely, but Stripe sometimes replays old events on
    -- webhook reconfiguration). Silent no-op rather than failing the
    -- webhook reply — Stripe would otherwise retry forever.
    return;
  end if;

  -- Already terminal — leave it alone (e.g. expired then re-fires).
  if v_attempt.status in ('completed', 'expired', 'failed') then
    return;
  end if;

  update public.top_up_attempts
  set status = p_status
  where id = v_attempt.id;
end;
$$;

revoke execute on function public.mark_top_up_attempt_failed(text, text) from public;
revoke execute on function public.mark_top_up_attempt_failed(text, text) from authenticated;
revoke execute on function public.mark_top_up_attempt_failed(text, text) from anon;

notify pgrst, 'reload schema';
