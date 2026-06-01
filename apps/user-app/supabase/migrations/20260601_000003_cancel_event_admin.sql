-- LiveRush — admin Settle event was bouncing with "Not allowed" (42501).
--
-- The path:
--   1. Admin clicks Settle event in admin-app on a pending_moderation
--      row whose pool / unique-bettors / outcomes-with-bets numbers
--      don't clear the settle guards, OR whose declared winner has
--      no bets on it.
--   2. settle_event wrapper passes the is_admin() check (added in
--      20260531_000001_admin_app.sql) and forwards to
--      settle_event_internal.
--   3. settle_event_internal hits one of its auto-cancel branches
--      and calls `perform public.cancel_event(p_event_id, ...)`.
--   4. cancel_event's auth check (added 20260529_000002 to keep
--      random viewers from cancelling other people's events) does:
--         if auth.uid() is not null and creator_id <> auth.uid()
--           raise 'Not allowed' using errcode = '42501';
--      SECURITY DEFINER doesn't reset auth.uid(); the admin's id is
--      not the event creator → boom.
--
-- Fix: widen cancel_event's guard so the same three call patterns
-- that already work for settle_event pass through:
--   • service_role / Edge Functions (auth.uid() is null) — keeps
--     close-betting-windows + end-stream Edge Function flows working
--   • The event's own creator (cancel during own broadcast) — keeps
--     the streamer-side "Cancel stream" button working
--   • super_admin (admin-app) — NEW
--
-- Everything else (function body, refund loop, ledger writes) stays
-- byte-for-byte identical to 20260529_000002's definition.

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

  -- Permission: service_role / system calls pass through
  -- (auth.uid() is null when invoked from an Edge Function or SQL
  -- Editor). Creator calls must match the event's creator_id.
  -- Admin callers (super_admin web app) pass via is_admin(). Any
  -- other authenticated caller is rejected.
  if v_user_id is not null then
    if not (
      v_event.creator_id = v_user_id
      or public.is_admin()
    ) then
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

-- Keep the existing authenticated grant — admins inherit it via
-- the `authenticated` role, the in-body is_admin() check is what
-- actually gates them.
grant execute on function public.cancel_event(text, text) to authenticated;

notify pgrst, 'reload schema';
