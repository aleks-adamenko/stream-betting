-- LiveRush — surface payout type + recipient on admin ledger rows.
--
-- When settle_round writes payout_pending ledger entries it always
-- sources them from the event_pool: account (it's a coin outflow
-- from the pool). The actual recipient — creator (rake_streamer),
-- platform (rake_platform), viewer (winner), or platform/viewer
-- (residual / refund) — lives one hop away in public.payouts via
-- ledger_entries.reference_id = payouts.id.
--
-- The admin /ledger UI was therefore showing two visually-identical
-- "Event pool · payout_pending · -X.XX" rows whenever a round
-- settled, leaving the operator unable to tell which one was the
-- streamer commission and which was the platform commission without
-- clicking into the ref. This RPC extension projects the payout
-- type + recipient role + recipient label so the UI can render a
-- "→ Creator (name)" / "→ Platform" / "→ Viewer (name)" annotation
-- on every payout-related ledger row.
--
-- New output columns:
--   payout_type             — payouts.type (rake_streamer / rake_platform /
--                             winner / residual / refund), null when
--                             reference_id doesn't resolve to a payout.
--   payout_recipient_role   — 'creator' / 'platform' / 'viewer', null
--                             when there's no linked payout.
--   payout_recipient_label  — resolved display name (creator_profiles or
--                             profiles), or 'Platform' for the bucket
--                             payouts, null otherwise.
--
-- Behaviour for non-payout rows (bets, top-ups, deposits, refunds
-- not linked to a payout row) is unchanged — the new columns are
-- null.

drop function if exists public.list_admin_ledger(integer, timestamptz);

create function public.list_admin_ledger(
  p_limit  integer default 50,
  p_cursor timestamptz default null
)
returns table (
  id                       uuid,
  account                  text,
  account_role             text,
  account_label            text,
  account_id               text,
  type                     text,
  amount_cents             bigint,
  amount_cash_cents        bigint,
  reference_id             text,
  event_id                 text,
  event_title              text,
  payout_type              text,
  payout_recipient_role    text,
  payout_recipient_label   text,
  created_at               timestamptz
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
      end as resolved_role,
      -- Payout link — null when reference_id doesn't resolve to a
      -- payouts row (bets, top-ups, etc.). Otherwise carries the
      -- destination type + recipient so the UI can disambiguate
      -- visually-identical event_pool outflows.
      (select p.type from public.payouts p
        where p.id::text = r.reference_id limit 1) as p_type,
      (select p.recipient_kind from public.payouts p
        where p.id::text = r.reference_id limit 1) as p_recipient_kind,
      (select p.recipient_id from public.payouts p
        where p.id::text = r.reference_id limit 1) as p_recipient_id
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
    -- Payout disambiguation columns.
    e.p_type as payout_type,
    e.p_recipient_kind as payout_recipient_role,
    case
      when e.p_recipient_kind = 'platform' then 'Platform'
      when e.p_recipient_kind = 'streamer' and e.p_recipient_id is not null then (
        select coalesce(c.display_name, '@' || c.handle)
        from public.creator_profiles c
        where c.id = e.p_recipient_id
      )
      when e.p_recipient_kind = 'viewer' and e.p_recipient_id is not null then coalesce(
        (select p.display_name from public.profiles p where p.id = e.p_recipient_id),
        (select u.email::text from auth.users u where u.id = e.p_recipient_id)
      )
      else null
    end as payout_recipient_label,
    e.created_at
  from enriched e
  order by e.created_at desc, e.id desc;
end;
$$;

grant execute on function public.list_admin_ledger(integer, timestamptz) to authenticated;
