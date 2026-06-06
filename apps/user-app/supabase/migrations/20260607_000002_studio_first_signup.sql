-- Studio-first signups: distinguish creator-only signups (via the
-- studio app) from viewer signups (via the user-app) so creators
-- who haven't yet visited the user-app:
--   (a) don't get the 100-coin viewer starter balance on email confirm,
--   (b) read as "—" in the admin Users page Viewer column,
--   (c) show their email-pending / verified status in the Creator
--       column instead.
--
-- When a studio-first user later signs into the user-app, the new
-- `activate_viewer()` RPC stamps `viewer_activated_at`, awards the
-- 100-coin starter, and flips them into the Verified-Viewer state.

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists signup_origin text
    check (signup_origin in ('studio', 'user_app'));

-- Stamp of the user's first user-app visit (where we award the
-- viewer starter coins and flip them to Verified Viewer in admin).
-- Null = never visited the user-app.
alter table public.profiles
  add column if not exists viewer_activated_at timestamptz;

-- Backfill existing users: treat them as user_app signups that have
-- already activated their viewer side. handle_email_confirmed has
-- been awarding their 100-coin starter since the ledger_rebuild
-- migration, so this matches reality.
update public.profiles
set signup_origin = coalesce(signup_origin, 'user_app'),
    viewer_activated_at = coalesce(viewer_activated_at, created_at)
where signup_origin is null
   or viewer_activated_at is null;

-- ---------------------------------------------------------------------------
-- 2. handle_new_user — capture signup_origin from metadata
-- ---------------------------------------------------------------------------
-- Both apps now pass `options.data.signup_origin` on supabase.auth.signUp.
-- Fallback to 'user_app' for any legacy call site that doesn't.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display text;
  v_origin  text;
begin
  v_display := coalesce(
    new.raw_user_meta_data->>'display_name',
    split_part(new.email, '@', 1)
  );
  v_origin := nullif(new.raw_user_meta_data->>'signup_origin', '');
  if v_origin not in ('studio', 'user_app') then
    v_origin := 'user_app';
  end if;

  insert into public.profiles (id, display_name, balance_cents, signup_origin)
  values (new.id, v_display, 0, v_origin)
  on conflict (id) do nothing;

  insert into public.notifications (user_id, type, title, body, event_id, read, created_at) values
    (
      new.id, 'welcome',
      'Welcome to LiveRush ⚡',
      case
        when v_origin = 'studio' then
          'Welcome! Complete your creator profile next — and visit the viewer app to claim your 100 starter coins.'
        else
          'Confirm your email to claim 100 starter coins and place your first bet on a live challenge!'
      end,
      null, false, now()
    );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. handle_email_confirmed — gate starter award on signup_origin
-- ---------------------------------------------------------------------------
-- A studio-first user clicking the email confirm link doesn't yet
-- count as "in the viewer app" — the 100-coin starter only lands
-- when activate_viewer() runs (their first user-app login). For
-- legacy users + viewers signing up via user-app, behaviour is
-- unchanged.

create or replace function public.handle_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin text;
  v_new_balance bigint;
begin
  if new.email_confirmed_at is not null
     and old.email_confirmed_at is null then

    select signup_origin into v_origin
    from public.profiles where id = new.id;

    -- Studio-first signups DON'T get the starter on email confirm —
    -- they get it when they activate the viewer side via the
    -- user-app (see activate_viewer below).
    if v_origin = 'studio' then
      return new;
    end if;

    update public.profiles
      set balance_cents = balance_cents + 10000,
          viewer_activated_at = coalesce(viewer_activated_at, now())
      where id = new.id
      returning balance_cents into v_new_balance;

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

-- ---------------------------------------------------------------------------
-- 4. activate_viewer() — called from the user-app on first sign-in
-- ---------------------------------------------------------------------------
-- Idempotent: if the user has already been viewer-activated (either
-- via email confirm on a user_app signup, or a prior call to this
-- RPC), it's a no-op. Otherwise it stamps `viewer_activated_at` and
-- awards the 100-coin starter exactly once.

create or replace function public.activate_viewer()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_profile public.profiles%rowtype;
  v_new_balance bigint;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles where id = v_user_id
  for update;

  if v_profile.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  -- Already activated → no-op idempotent.
  if v_profile.viewer_activated_at is not null then
    return v_profile;
  end if;

  update public.profiles
  set balance_cents       = balance_cents + 10000,
      viewer_activated_at = now()
  where id = v_user_id
  returning balance_cents into v_new_balance;

  insert into public.ledger_entries (
    account, type, amount_cents, balance_after_cents, reference_id
  ) values (
    'user:' || v_user_id::text,
    'starter_grant',
    10000,
    v_new_balance,
    'viewer_activation:' || v_user_id::text
  );

  select * into v_profile from public.profiles where id = v_user_id;
  return v_profile;
end;
$$;

grant execute on function public.activate_viewer() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. list_admin_users — expose signup_origin + viewer_activated_at
-- ---------------------------------------------------------------------------
-- Admin Users page branches on these two fields to decide which
-- status badges live in the Viewer vs Creator columns.

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
    p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at desc;
end;
$$;

grant execute on function public.list_admin_users() to authenticated;

commit;
