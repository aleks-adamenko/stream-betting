-- LiveRush — fix the welcome notification INSERT column mismatch.
--
-- 20260609_000003's notification INSERT inside handle_email_confirmed
-- and activate_viewer specified 5 columns
-- (user_id, type, title, body, event_id) but only provided 4 values.
-- Postgres raised `INSERT has more target columns than expressions`,
-- the defensive BEGIN/EXCEPTION wrapper silently caught it, and no
-- row was ever created — so neither the realtime push nor the
-- replay-on-mount in NotificationsProvider had a row to fire on.
-- The viewer saw the 100-coin balance but no welcome toast.
--
-- Fix: drop the event_id column from the INSERT list (welcome
-- notifications aren't event-scoped — they're a profile-level
-- onboarding message). Same shape on both functions.
--
-- The recovery DO block at the bottom retroactively inserts a
-- welcome row for any viewer who lost theirs to the broken INSERT
-- in 20260609_000002 / 20260609_000003 — i.e. profile has 100+
-- coin balance from the starter_grant ledger but no welcome
-- notification row.

-- ---------------------------------------------------------------------------
-- 1. handle_email_confirmed — fixed INSERT
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

      -- Welcome toast row. Wrapped in its own savepoint so a
      -- failure here can't roll back the balance grant or the
      -- auth.users.email_confirmed_at update.
      begin
        insert into public.notifications (user_id, type, title, body)
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
-- 2. activate_viewer — fixed INSERT
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

  begin
    insert into public.notifications (user_id, type, title, body)
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
-- 3. Backfill — give every viewer whose welcome INSERT was silently
--    dropped by the broken column mismatch a welcome row now.
-- ---------------------------------------------------------------------------
-- Eligibility: viewer_activated_at is set (so the starter grant
-- actually landed) but no welcome notification exists. Skips users
-- who already have a welcome row (re-run is safe).

insert into public.notifications (user_id, type, title, body)
select
  p.id,
  'welcome',
  'Welcome to LiveRush 🎁',
  'You got 100.00 coins gift on your balance — bet on your favourite streamers!'
from public.profiles p
where p.viewer_activated_at is not null
  and (p.signup_origin is null or p.signup_origin = 'user_app')
  and not exists (
    select 1 from public.notifications n
    where n.user_id = p.id and n.type = 'welcome'
  );

notify pgrst, 'reload schema';
