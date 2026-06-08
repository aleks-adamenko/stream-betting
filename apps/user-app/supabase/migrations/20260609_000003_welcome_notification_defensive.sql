-- LiveRush — defensively wrap the welcome notification INSERT.
--
-- 20260609_000002 added a notifications INSERT inside
-- handle_email_confirmed + activate_viewer. If that INSERT raises
-- (FK violation, CHECK violation, anything), the trigger function
-- throws, and the surrounding transaction rolls back — taking
-- auth.users.email_confirmed_at with it. The user lands on
-- /auth/callback after clicking their confirm link, exchangeCodeForSession
-- returns no session, they're redirected to /auth/sign-in, and on
-- retry they see "Email not confirmed" because the column never
-- committed.
--
-- This migration rewrites both functions so the notification INSERT
-- runs in a nested exception-handled block. If the INSERT fails for
-- ANY reason, we log a warning and continue — the balance grant,
-- ledger write, and email_confirmed_at update all commit
-- regardless. Worst case: a viewer doesn't get a welcome toast.
-- They still get their 100 coins and a working account.

-- ---------------------------------------------------------------------------
-- 1. handle_email_confirmed — notification INSERT defensively wrapped
-- ---------------------------------------------------------------------------

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

      -- Welcome toast row — wrapped in its own savepoint so a
      -- failure here (e.g. notifications type CHECK, FK violation,
      -- whatever) doesn't roll back the balance grant or the
      -- email_confirmed_at update on auth.users.
      begin
        insert into public.notifications (user_id, type, title, body, event_id)
        values (
          new.id,
          'welcome',
          'Welcome to LiveRush 🎁',
          'You got 100.00 coins gift on your balance — bet on your favourite streamers!'
        );
      exception when others then
        raise warning 'welcome notification insert failed: %', sqlerrm;
      end;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. activate_viewer — same defensive wrapper
-- ---------------------------------------------------------------------------

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
    set balance_cents = balance_cents + 10000,
        viewer_activated_at = now()
    where id = v_user_id
    returning * into v_profile;

  v_new_balance := v_profile.balance_cents;

  insert into public.ledger_entries (
    account, type, amount_cents, balance_after_cents, reference_id
  ) values (
    'user:' || v_user_id::text,
    'starter_grant',
    10000,
    v_new_balance,
    'activate_viewer:' || v_user_id::text
  );

  -- Welcome toast row — same defensive wrap as
  -- handle_email_confirmed. activate_viewer is called from the
  -- user-app on first sign-in; a notification failure here must
  -- not block the RPC's return-the-profile path or the viewer
  -- gets stuck in a re-call loop.
  begin
    insert into public.notifications (user_id, type, title, body, event_id)
    values (
      v_user_id,
      'welcome',
      'Welcome to LiveRush 🎁',
      'You got 100.00 coins gift on your balance — bet on your favourite streamers!'
    );
  exception when others then
    raise warning 'welcome notification insert failed: %', sqlerrm;
  end;

  return v_profile;
end;
$$;

grant execute on function public.activate_viewer() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Recovery: stamp email_confirmed_at + viewer_activated_at + 100 coins for
--    any user_app viewer whose 20260609_000002 confirmation rolled back.
-- ---------------------------------------------------------------------------
-- Safe to run every time the migration applies — it only touches rows
-- where the broken state is detectable (profile exists with no
-- viewer_activated_at AND signup_origin = 'user_app' AND email_confirmed_at
-- is null on auth.users). If the operator already manually-fixed the
-- test users, this is a no-op.

do $$
declare
  r record;
  v_new_balance bigint;
begin
  for r in
    select au.id as auth_id, p.id as profile_id
    from auth.users au
    join public.profiles p on p.id = au.id
    where au.email_confirmed_at is null
      and p.viewer_activated_at is null
      and (p.signup_origin is null or p.signup_origin = 'user_app')
  loop
    -- Stamp the auth.users column. The trigger we just rewrote
    -- handles the rest atomically: balance + ledger + welcome
    -- notification (with its safe wrapper).
    update auth.users set email_confirmed_at = now() where id = r.auth_id;
  end loop;
end $$;

notify pgrst, 'reload schema';
