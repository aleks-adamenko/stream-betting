-- LiveRush — Admin App Phase 1.
--
-- Adds the database surface a browser-based admin operator needs to:
--   • approve/reject creator applications (replacing manual SQL UPDATEs)
--   • settle events and approve/reject payouts from a web UI instead of
--     the Supabase SQL Editor
--   • browse users, creators, and the ledger
--   • read platform earnings
--
-- Privilege model: existing `profiles.role` enum already has the
-- 'super_admin' value (defined in 20260513_000003_auth.sql) but it's
-- been dormant up to now. This migration brings it to life as the
-- single source of truth for admin access — both inside RLS policies
-- and inside the three previously service-role-only mutation RPCs.
--
-- The settle_event / approve_payout / reject_payout RPCs keep their
-- public signatures so the existing pg_net + SQL Editor callers don't
-- break. Internally each is renamed to <name>_internal and wrapped by
-- a same-named admin-gated stub that forwards once the caller is
-- confirmed admin or service_role. That avoids copying 100+ lines of
-- function body into this migration just to bolt on a permission check.

-- =========================================================================
-- 1) is_admin() — the canonical "current user is super_admin" check.
--    Used by RLS policies, RPC gates, and the admin web app to decide
--    whether to render the protected layout.
-- =========================================================================

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'super_admin'
  );
$$;

grant execute on function public.is_admin() to authenticated, anon;
-- anon gets it so the sign-in page (pre-auth) can probe; returns false.

-- =========================================================================
-- 2) creator_profiles moderation audit columns
-- =========================================================================

alter table public.creator_profiles
  add column if not exists rejected_note text,
  add column if not exists moderated_by uuid references auth.users(id) on delete set null,
  add column if not exists moderated_at timestamptz;

-- =========================================================================
-- 3) approve_creator + reject_creator — replaces the manual
--    "UPDATE creator_profiles SET status = 'verified' WHERE id = '…'"
--    that operators run today.
-- =========================================================================

create or replace function public.approve_creator(p_creator_id uuid)
returns public.creator_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_row public.creator_profiles;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  update public.creator_profiles
  set
    status        = 'verified',
    rejected_note = null,         -- clear any prior rejection note
    moderated_by  = v_admin_id,
    moderated_at  = now()
  where id = p_creator_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Creator not found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

create or replace function public.reject_creator(
  p_creator_id uuid,
  p_note       text
)
returns public.creator_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_row public.creator_profiles;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'rejection note required' using errcode = '22023';
  end if;

  update public.creator_profiles
  set
    status        = 'rejected',
    rejected_note = trim(p_note),
    moderated_by  = v_admin_id,
    moderated_at  = now()
  where id = p_creator_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Creator not found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

grant execute on function public.approve_creator(uuid) to authenticated;
grant execute on function public.reject_creator(uuid, text) to authenticated;

-- =========================================================================
-- 4) list_admin_users — joined view of profiles + auth.users.email
-- =========================================================================
--
-- Returns the admin Users page's "Viewers" tab data: one row per
-- registered user. Includes creators (they're profiles too) — the UI
-- filters to whoever it wants to render.

-- NOTE on types: profiles.balance_cents is declared as integer (not
-- bigint) and auth.users.email as varchar(255) (not text). Postgres
-- rejects returns-table signatures with an exact-type mismatch, so we
-- align: balance_cents integer + email::text cast in the SELECT.
--
-- DROP-then-CREATE rather than CREATE OR REPLACE because Postgres
-- refuses to change OUT-parameter types via the latter; the explicit
-- drop avoids "cannot change return type of existing function" if
-- this migration is re-applied with a tweaked signature.

drop function if exists public.list_admin_users();

create function public.list_admin_users()
returns table (
  id              uuid,
  email           text,
  -- Raw profiles.role enum value ('user' | 'influencer' | 'super_admin').
  -- Kept for backwards compat; new clients should read role_label
  -- which collapses the legacy enum + creator_profiles membership into
  -- the three meaningful product roles.
  role            text,
  -- Derived role label: 'admin' | 'creator' | 'viewer'.
  --   super_admin → admin (super_admin wins even if they're also a
  --     creator on the platform).
  --   else if creator_profiles row exists → creator.
  --   else → viewer.
  role_label      text,
  display_name    text,
  avatar_url      text,
  balance_cents   integer,
  created_at      timestamptz
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

  -- auth.users.email is declared as varchar(255); cast to text so it
  -- matches our RETURNS TABLE signature. PostgREST rejects the call
  -- with errcode 42804 otherwise.
  return query
  select
    p.id,
    u.email::text,
    p.role,
    case
      when p.role = 'super_admin' then 'admin'
      when exists (
        select 1 from public.creator_profiles c where c.id = p.id
      ) then 'creator'
      else 'viewer'
    end as role_label,
    p.display_name,
    p.avatar_url,
    p.balance_cents,
    p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at desc;
end;
$$;

grant execute on function public.list_admin_users() to authenticated;

-- =========================================================================
-- 5) list_admin_creators — full creator dossier for the Creators tab
-- =========================================================================
--
-- Adds the moderation audit columns and the underlying user's email so
-- the admin can contact them out-of-band when reviewing.

-- DROP-then-CREATE rather than CREATE OR REPLACE because Postgres
-- refuses to change OUT-parameter types via the latter — and we're
-- about to add three columns (events_created, events_hosted, earned_cents).
drop function if exists public.list_admin_creators();

create function public.list_admin_creators()
returns table (
  id              uuid,
  email           text,
  handle          text,
  display_name    text,
  avatar_url      text,
  bio             text,
  social_links    jsonb,
  followers_count integer,
  status          text,
  commission_pct  numeric,
  rejected_note   text,
  moderated_by    uuid,
  moderated_at    timestamptz,
  created_at      timestamptz,
  -- Per-creator activity stats surfaced in the admin Users page.
  -- events_created = every event owned by the creator regardless of
  -- status (incl. drafts). events_hosted = events that actually went
  -- live at some point (started_at is not null). earned_cents = sum
  -- of completed rake_streamer payouts credited to their balance.
  events_created integer,
  events_hosted  integer,
  earned_cents   bigint
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

  -- Same email::text cast as list_admin_users — auth.users.email is
  -- varchar(255), our RETURNS TABLE declares text.
  return query
  select
    c.id,
    u.email::text,
    c.handle,
    c.display_name,
    c.avatar_url,
    c.bio,
    c.social_links,
    c.followers_count,
    c.status,
    c.commission_pct,
    c.rejected_note,
    c.moderated_by,
    c.moderated_at,
    c.created_at,
    -- Three correlated subqueries — cheap at admin-list scale (handful
    -- of creators); if the list ever grows to thousands we'd swap to
    -- a single LEFT JOIN ... GROUP BY, but the planner handles this
    -- fine today.
    coalesce((
      select count(*)::integer
      from public.events e
      where e.creator_id = c.id
    ), 0) as events_created,
    coalesce((
      select count(*)::integer
      from public.events e
      where e.creator_id = c.id
        and e.started_at is not null
    ), 0) as events_hosted,
    coalesce((
      select sum(p.amount_cents)
      from public.payouts p
      where p.recipient_id = c.id
        and p.type = 'rake_streamer'
        and p.status = 'completed'
    ), 0)::bigint as earned_cents
  from public.creator_profiles c
  join auth.users u on u.id = c.id
  -- Pending first (work queue at the top), then verified, then rejected.
  order by
    case c.status
      when 'pending'  then 0
      when 'verified' then 1
      when 'rejected' then 2
    end,
    c.created_at desc;
end;
$$;

grant execute on function public.list_admin_creators() to authenticated;

-- =========================================================================
-- 6) list_admin_ledger — keyset-paginated ledger entries
-- =========================================================================
--
-- Keyset over (created_at desc, id) so a "Load more" button can stream
-- through the entire ledger without offset-pagination drift. Pass
-- p_cursor=null for the first page; for subsequent pages pass the
-- created_at of the last row from the previous page.

-- DROP-then-CREATE rather than CREATE OR REPLACE because we're
-- adding columns to the RETURNS TABLE signature — see same pattern
-- on list_admin_users / list_admin_creators above.
drop function if exists public.list_admin_ledger(integer, timestamptz);

create function public.list_admin_ledger(
  p_limit  integer default 50,
  p_cursor timestamptz default null
)
returns table (
  id                  uuid,
  account             text,
  -- account_role: 'platform' | 'event_pool' | 'creator' | 'viewer'.
  -- Lets the UI distinguish a streamer's commission credit from a
  -- viewer's bet/refund without parsing the raw account string.
  -- Note: role is context-aware — a creator who places a bet shows
  -- up as 'viewer' for that ledger row even though they're a
  -- creator on the platform.
  account_role        text,
  -- account_label: human-readable name for the account. Replaces the
  -- raw `user:<uuid>` / `event_pool:<id>` strings with display name
  -- for creator/viewer rows, event title for the pool, or "Platform".
  account_label       text,
  -- account_id: the bare identifier (uuid for users, slug for pools).
  -- Lives in its own column so the admin UI can render it adjacent
  -- to the label + role badge without parsing strings.
  account_id          text,
  type                text,
  amount_cents        bigint,
  reference_id        text,
  -- event_id: resolved from `event_pool:<id>` account string OR from
  -- payouts/bets via reference_id. Null for ledger entries with no
  -- event link (deposits, withdrawals, manual adjustments).
  event_id            text,
  event_title         text,
  created_at          timestamptz
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
      l.balance_after_cents,
      l.reference_id,
      l.created_at,
      -- Split user:<uuid> / event_pool:<id> into role + payload once.
      case
        when l.account = 'platform' then 'platform'
        when l.account like 'event_pool:%' then 'event_pool'
        when l.account like 'user:%' then 'user'
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
      -- Resolve event_id three ways: (1) event_pool account, (2)
      -- payouts.event_id via reference_id, (3) bets.event_id via
      -- reference_id. First non-null wins.
      coalesce(
        case when r.kind = 'event_pool' then r.ident end,
        (select p.event_id from public.payouts p
          where p.id::text = r.reference_id limit 1),
        (select b.event_id from public.bets b
          where b.id::text = r.reference_id limit 1)
      ) as resolved_event_id,
      -- Role is context-aware, not identity-based: a creator who
      -- *bets* on someone else's event shows up as a Viewer in that
      -- row, even though their creator_profiles row exists. The
      -- only ledger.type that puts them in the Creator role is
      -- payout_credit where the underlying payouts.type =
      -- 'rake_streamer' (i.e. they're being paid their streamer cut).
      -- Everything else acting on a user account (bet, refund,
      -- deposit, withdrawal, top-up) is viewer behaviour.
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
    -- Account label = the resolved name. Uses creator_profiles only
    -- when the row's role IS creator (i.e. this row is a streamer
    -- payout); for viewer rows we go through profiles → email so
    -- the name reads naturally without "@handle" decoration.
    case
      when e.resolved_role = 'platform' then 'Platform'
      when e.resolved_role = 'event_pool' then 'Event pool'
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
    -- Bare account identifier (uuid / event slug). Surfaced as its
    -- own column so the admin UI can render it in its own slot
    -- instead of cramming it into the raw `account` string.
    case
      when e.kind in ('user', 'event_pool') then e.ident
      else null
    end as account_id,
    e.type,
    e.amount_cents,
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
-- 7) get_platform_earnings — lifetime + 30-day platform rake/residual sum
-- =========================================================================
--
-- One round trip → both the big lifetime number and the 30-day chart
-- data for the Wallet page. Daily breakdown is a CTE the function
-- returns alongside the lifetime aggregate.

create or replace function public.get_platform_earnings()
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_lifetime bigint;
  v_breakdown json;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  -- Lifetime sum: every dollar that landed in the platform account
  -- as either rake or residual rounding leftover.
  select coalesce(sum(amount_cents), 0)
    into v_lifetime
  from public.ledger_entries
  where account = 'platform'
    and type in ('rake', 'residual');

  -- 30-day breakdown grouped by date (one row per day). Includes
  -- zero-rows for days with no activity so the chart renders a
  -- continuous timeline rather than gaps.
  select coalesce(
    json_agg(
      json_build_object(
        'day', to_char(d, 'YYYY-MM-DD'),
        'amount_cents', coalesce(sums.total, 0)
      )
      order by d
    ),
    '[]'::json
  )
  into v_breakdown
  from generate_series(
    (now() at time zone 'utc')::date - interval '29 days',
    (now() at time zone 'utc')::date,
    interval '1 day'
  ) as d
  left join lateral (
    select sum(amount_cents) as total
    from public.ledger_entries
    where account = 'platform'
      and type in ('rake', 'residual')
      and (created_at at time zone 'utc')::date = d::date
  ) sums on true;

  return json_build_object(
    'lifetime_cents', v_lifetime,
    'breakdown_30d', v_breakdown
  );
end;
$$;

grant execute on function public.get_platform_earnings() to authenticated;

-- =========================================================================
-- 8) Rename + wrap settle_event / approve_payout / reject_payout
-- =========================================================================
--
-- Pattern: ALTER FUNCTION … RENAME TO <name>_internal, then CREATE a
-- new function with the original name that gates on (is_admin or
-- service_role) and forwards to _internal. Keeps the existing function
-- bodies untouched while opening them up to admin web callers.
--
-- The previous REVOKE statements at the tail of
-- 20260529_000001_betting_mvp.sql apply to the _internal versions
-- (rename carries the privileges over) — which is exactly what we
-- want: only service_role keeps execute on the internals; the public
-- wrappers are what authenticated admins call.
--
-- session_user = 'service_role' is how we detect a service-role JWT
-- inside a SECURITY DEFINER function — `current_user` would be the
-- function owner (postgres) regardless of who called.

alter function public.settle_event(text, uuid)
  rename to settle_event_internal;
alter function public.approve_payout(uuid, uuid)
  rename to approve_payout_internal;
alter function public.reject_payout(uuid, text, text)
  rename to reject_payout_internal;

create or replace function public.settle_event(
  p_event_id        text,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    session_user = 'service_role'
    or (auth.uid() is not null and public.is_admin())
  ) then
    raise exception 'admin or service_role required'
      using errcode = '42501';
  end if;
  return public.settle_event_internal(p_event_id, p_idempotency_key);
end;
$$;

create or replace function public.approve_payout(
  p_payout_id       uuid,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    session_user = 'service_role'
    or (auth.uid() is not null and public.is_admin())
  ) then
    raise exception 'admin or service_role required'
      using errcode = '42501';
  end if;
  return public.approve_payout_internal(p_payout_id, p_idempotency_key);
end;
$$;

create or replace function public.reject_payout(
  p_payout_id uuid,
  p_reason    text,
  p_notes     text default null
)
returns public.payouts
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    session_user = 'service_role'
    or (auth.uid() is not null and public.is_admin())
  ) then
    raise exception 'admin or service_role required'
      using errcode = '42501';
  end if;
  return public.reject_payout_internal(p_payout_id, p_reason, p_notes);
end;
$$;

-- Admin web app calls the wrappers from an authenticated session.
grant execute on function public.settle_event(text, uuid) to authenticated;
grant execute on function public.approve_payout(uuid, uuid) to authenticated;
grant execute on function public.reject_payout(uuid, text, text) to authenticated;

-- Make sure the internals stay locked down — service_role still has
-- execute by virtue of its role-level privileges; we just want to
-- block authenticated and anon from going around the wrappers.
revoke execute on function public.settle_event_internal(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.approve_payout_internal(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.reject_payout_internal(uuid, text, text)
  from public, anon, authenticated;

-- =========================================================================
-- 9) Admin RLS — "admin sees all" SELECT policies on every gated table
-- =========================================================================
--
-- Pattern: one extra SELECT policy per table, gated on is_admin().
-- We don't add INSERT/UPDATE/DELETE policies — every admin mutation
-- still goes through a SECURITY DEFINER RPC (approve_creator,
-- settle_event, etc.) so the audit chain (ledger_entries,
-- notified_at, etc.) stays intact and a buggy admin client can't
-- write garbage into a table directly.

drop policy if exists "admin reads all profiles" on public.profiles;
create policy "admin reads all profiles"
  on public.profiles
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin reads all creator_profiles" on public.creator_profiles;
create policy "admin reads all creator_profiles"
  on public.creator_profiles
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin reads all events" on public.events;
create policy "admin reads all events"
  on public.events
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin reads all bets" on public.bets;
create policy "admin reads all bets"
  on public.bets
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin reads all payouts" on public.payouts;
create policy "admin reads all payouts"
  on public.payouts
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin reads all ledger_entries" on public.ledger_entries;
create policy "admin reads all ledger_entries"
  on public.ledger_entries
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin reads all event_outcomes" on public.event_outcomes;
create policy "admin reads all event_outcomes"
  on public.event_outcomes
  for select
  to authenticated
  using (public.is_admin());

notify pgrst, 'reload schema';
