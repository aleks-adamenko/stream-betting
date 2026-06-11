-- LiveRush — admin Creators table: show the CREATOR balance, not the
-- viewer wallet.
--
-- list_admin_users() exposed only profiles.balance_cents — the viewer's
-- spendable pot (top-ups + starter grant + bet winnings). A creator's
-- actual balance is profiles.withdrawable_cents: the cashable rake pot
-- the studio "Available to cash out" card reads (see
-- 20260604_000002_streamer_balance.sql). The admin Creators page was
-- rendering the wrong number.
--
-- Recreate list_admin_users() (built last in 20260611_000001) adding
-- creator_balance_cents = profiles.withdrawable_cents so the Creators
-- page can render the cashable creator balance while the Viewers page
-- keeps showing balance_cents.

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
  creator_balance_cents bigint,
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
    p.withdrawable_cents,
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
