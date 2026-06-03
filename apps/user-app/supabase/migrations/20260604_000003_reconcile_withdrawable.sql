-- LiveRush — reconcile profiles.withdrawable_cents from the canonical
-- payouts table.
--
-- Bug observed on studio Profile: lifetime commissions card (Balance
-- page) showed 5 coins while the "Available to cash out" card (Profile
-- page) showed 2 coins. Both numbers should match for a streamer with
-- no outstanding cashout requests.
--
-- Root cause: migration 20260604_000002's backfill ran ONCE at apply
-- time, snapshotting whatever rake_streamer rows had status='completed'
-- at that moment. Approvals that landed afterwards via the OLD
-- approve_payout_internal definition (or via a manual SQL UPDATE on
-- payouts.status) credited profiles.balance_cents instead of
-- profiles.withdrawable_cents — leaving withdrawable_cents
-- under-reported.
--
-- Fix: re-derive withdrawable_cents from the source of truth (the
-- payouts table) and make this operation idempotent + safely re-runnable
-- via a SECURITY DEFINER RPC, so future drift can be cleaned up with a
-- single SQL Editor call (`select public.reconcile_withdrawable_cents();`)
-- without redeploying.
--
-- Formula:
--   withdrawable_cents = (rake earned and admin-approved)
--                       − (outstanding cashout requests)
-- where:
--   • "rake earned"        = rake_streamer rows with event_id IS NOT NULL
--                            AND status='completed'
--   • "outstanding cashout" = rake_streamer rows with event_id IS NULL
--                            AND status IN ('pending','approved','completed')
--                            (rejected cashouts get refunded back into
--                            withdrawable_cents via reject_payout_internal,
--                            so they're excluded.)

create or replace function public.reconcile_withdrawable_cents()
returns table (
  user_id            uuid,
  old_withdrawable   bigint,
  new_withdrawable   bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with rake_earned as (
    select
      recipient_id as uid,
      sum(amount_cents)::bigint as cents
    from public.payouts
    where type = 'rake_streamer'
      and event_id is not null
      and status = 'completed'
      and recipient_id is not null
    group by recipient_id
  ),
  cashouts_outstanding as (
    select
      recipient_id as uid,
      sum(amount_cents)::bigint as cents
    from public.payouts
    where type = 'rake_streamer'
      and event_id is null
      and status in ('pending', 'approved', 'completed')
      and recipient_id is not null
    group by recipient_id
  ),
  target as (
    -- Union both sides so a profile shows up in the update set even if
    -- it has only outstanding cashouts (no rake earned) or vice versa.
    select uid from rake_earned
    union
    select uid from cashouts_outstanding
  ),
  computed as (
    select
      t.uid,
      greatest(
        0,
        coalesce(re.cents, 0) - coalesce(co.cents, 0)
      )::bigint as cents
    from target t
    left join rake_earned        re on re.uid = t.uid
    left join cashouts_outstanding co on co.uid = t.uid
  ),
  updated as (
    update public.profiles p
    set withdrawable_cents = c.cents
    from computed c
    where p.id = c.uid
      and p.withdrawable_cents is distinct from c.cents
    returning p.id as uid, c.cents as new_cents
  )
  select
    u.uid,
    -- old value isn't returnable from the same UPDATE in a CTE, so
    -- emit just the new value alongside the user_id. (Diff is easy
    -- enough to inspect via a follow-up select if needed.)
    null::bigint as old_withdrawable,
    u.new_cents  as new_withdrawable
  from updated u;
end;
$$;

-- Admin-only execute (matches the other admin-tooling RPCs). Run it
-- once now to clean up the current drift; re-run any time as needed.
revoke execute on function public.reconcile_withdrawable_cents() from public;
grant execute on function public.reconcile_withdrawable_cents() to authenticated;

-- One-shot reconcile to fix the current observed drift. Service-role
-- execution from a migration is implicit; the function check is for
-- the runtime RPC path, not this migration apply.
select public.reconcile_withdrawable_cents();

-- =========================================================================
-- Add an admin gate at runtime so only super_admins can poke this from
-- the client. (Migrations run as service_role and bypass the check.)
-- =========================================================================

create or replace function public.reconcile_withdrawable_cents()
returns table (
  user_id            uuid,
  old_withdrawable   bigint,
  new_withdrawable   bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;

  return query
  with rake_earned as (
    select
      recipient_id as uid,
      sum(amount_cents)::bigint as cents
    from public.payouts
    where type = 'rake_streamer'
      and event_id is not null
      and status = 'completed'
      and recipient_id is not null
    group by recipient_id
  ),
  cashouts_outstanding as (
    select
      recipient_id as uid,
      sum(amount_cents)::bigint as cents
    from public.payouts
    where type = 'rake_streamer'
      and event_id is null
      and status in ('pending', 'approved', 'completed')
      and recipient_id is not null
    group by recipient_id
  ),
  target as (
    select uid from rake_earned
    union
    select uid from cashouts_outstanding
  ),
  computed as (
    select
      t.uid,
      greatest(
        0,
        coalesce(re.cents, 0) - coalesce(co.cents, 0)
      )::bigint as cents
    from target t
    left join rake_earned        re on re.uid = t.uid
    left join cashouts_outstanding co on co.uid = t.uid
  ),
  updated as (
    update public.profiles p
    set withdrawable_cents = c.cents
    from computed c
    where p.id = c.uid
      and p.withdrawable_cents is distinct from c.cents
    returning p.id as uid, c.cents as new_cents
  )
  select
    u.uid,
    null::bigint as old_withdrawable,
    u.new_cents  as new_withdrawable
  from updated u;
end;
$$;

notify pgrst, 'reload schema';
