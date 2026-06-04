-- LiveRush — undo the Stripe Checkout integration.
--
-- The 20260605_000001_stripe_checkout.sql migration added real-money
-- payment plumbing (top_up_attempts table, 4 SECURITY DEFINER RPCs,
-- plus a stripe_product_id column on coin_packs via the earlier
-- 20260604_000001_ledger_rebuild.sql).
--
-- Business decision: real card payments don't fit the
-- entertainment-currency model — Rush Coins explicitly have no
-- monetary value (see Terms §1.2). Charging real money would muddy
-- the non-gambling position and create regulatory exposure. Reverting
-- to the mock-checkout flow that credits balance instantly.
--
-- What this migration does:
--   • Drops the 4 Stripe-only RPCs.
--   • Drops the `top_up_attempts` table (RLS policies + indexes
--     cascade automatically).
--   • Drops the `coin_packs.stripe_product_id` column.
--   • Recreates `list_coin_packs` and `upsert_coin_pack` WITHOUT the
--     stripe_product_id plumbing.
--
-- What it leaves alone (deliberately):
--   • `ledger_entries` rows with `reference_id LIKE 'cs_test_%'` —
--     real record of real (test-mode) payments from the sandbox
--     smoke test. Useful audit trail.
--   • The `top_up_balance(p_coins, p_cash_cents)` RPC — still in
--     use by the restored mock CheckoutModal. Predates the Stripe
--     work; the revert puts it back on the hot path.
--   • The `coin_packs` Realtime publication and admin/user reads —
--     just one fewer column to project.

-- =========================================================================
-- 1) Drop Stripe-only RPCs
-- =========================================================================

drop function if exists public.complete_top_up_attempt(text);
drop function if exists public.mark_top_up_attempt_failed(text, text);
drop function if exists public.attach_stripe_session(uuid, text);
drop function if exists public.create_top_up_attempt(uuid);

-- =========================================================================
-- 2) Drop the top_up_attempts table
-- =========================================================================
--
-- CASCADE not needed — there are no foreign keys pointing INTO this
-- table from anywhere else. RLS policies + indexes drop with the
-- table automatically.

drop table if exists public.top_up_attempts;

-- =========================================================================
-- 3) Drop stripe_product_id from coin_packs
-- =========================================================================
--
-- Has to come AFTER the RPC drops above (list_coin_packs returned
-- this column; while the RPC still existed, dropping the column
-- would invalidate its return type).

alter table public.coin_packs drop column if exists stripe_product_id;

-- =========================================================================
-- 4) Recreate list_coin_packs without stripe_product_id
-- =========================================================================
--
-- Need to DROP first — postgres won't allow a RETURNS-table shape
-- change via CREATE OR REPLACE.

drop function if exists public.list_coin_packs();

create or replace function public.list_coin_packs()
returns table (
  id                    uuid,
  coins                 integer,
  price_dollar_cents    bigint,
  sort_order            integer,
  is_active             boolean,
  dollar_per_coin_cents numeric,
  created_at            timestamptz,
  updated_at            timestamptz
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
    p.id, p.coins, p.price_dollar_cents,
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

-- =========================================================================
-- 5) Recreate upsert_coin_pack with 5 params instead of 6
-- =========================================================================
--
-- DROP the old 6-arg version first — postgres treats arg-count as
-- part of the signature, and we want the old signature gone so
-- nothing in the codebase accidentally calls it with the now-stale
-- shape.

drop function if exists public.upsert_coin_pack(
  uuid, integer, bigint, text, integer, boolean
);

create or replace function public.upsert_coin_pack(
  p_id                 uuid,
  p_coins              integer,
  p_price_dollar_cents bigint,
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
      coins, price_dollar_cents, sort_order, is_active
    ) values (
      p_coins, p_price_dollar_cents,
      coalesce(p_sort_order, 0), coalesce(p_is_active, true)
    ) returning * into v_row;
  else
    update public.coin_packs set
      coins              = p_coins,
      price_dollar_cents = p_price_dollar_cents,
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
  uuid, integer, bigint, integer, boolean
) to authenticated;

notify pgrst, 'reload schema';
