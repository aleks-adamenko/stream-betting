-- LiveRush — admin Users/Creators split support.
--
-- The admin app is splitting its single Users table into a Users page
-- (non-creators only) and a dedicated Creators page. The Creators table
-- needs three columns that list_admin_users() did not previously expose:
--
--   • timezone       — the creator's IANA timezone (profiles.timezone,
--                       added in 20260610_000005). Shown as '-' when null.
--   • streams_total  — total events the creator has authored
--                       (events.creator_id = profile id, all statuses
--                       including drafts and cancelled).
--   • streams_live   — subset currently/previously broadcast
--                       (status in ('live','finished')), rendered next to
--                       the total as "N created · M live".
--
-- Studio-published events set events.creator_id (→ creator_profiles.id =
-- auth.users.id = profiles.id); the legacy events.influencer_id path is
-- only for seeded catalog rows that have no profile, so the counts key
-- off creator_id exclusively.
--
-- Recreate (drop + create) because the OUT signature changes.

begin;

drop function if exists public.list_admin_users();

create function public.list_admin_users()
returns table (
  id              uuid,
  email           text,
  role            text,
  is_admin        boolean,
  display_name    text,
  avatar_url      text,
  balance_cents   integer,
  email_confirmed_at timestamptz,
  signup_origin   text,
  viewer_activated_at timestamptz,
  creator_status        text,
  creator_rejected_note text,
  creator_moderated_at  timestamptz,
  timezone        text,
  streams_total   integer,
  streams_live    integer,
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

  return query
  select
    p.id,
    u.email::text,
    p.role,
    (p.role = 'super_admin') as is_admin,
    p.display_name,
    p.avatar_url,
    p.balance_cents,
    u.email_confirmed_at,
    p.signup_origin,
    p.viewer_activated_at,
    (select c.status from public.creator_profiles c where c.id = p.id),
    (select c.rejected_note from public.creator_profiles c where c.id = p.id),
    (select c.moderated_at from public.creator_profiles c where c.id = p.id),
    p.timezone,
    (select count(*)::integer
       from public.events e
      where e.creator_id = p.id),
    (select count(*)::integer
       from public.events e
      where e.creator_id = p.id
        and e.status in ('live', 'finished')),
    p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at desc;
end;
$$;

grant execute on function public.list_admin_users() to authenticated;

notify pgrst, 'reload schema';

commit;
