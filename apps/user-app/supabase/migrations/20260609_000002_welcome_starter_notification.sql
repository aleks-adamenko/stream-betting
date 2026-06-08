-- LiveRush — welcome notification fires at the moment 100 coins land.
--
-- Today the welcome notification is INSERTed at signup
-- (handle_new_user) with copy that nudges the user to confirm their
-- email ("Confirm your email to claim 100 starter coins"). After
-- the email confirm + the 100 coins actually land
-- (handle_email_confirmed), no celebration notification fires — so
-- the toast layer has nothing to surface when the freshly-signed-up
-- viewer reaches /home for the first time.
--
-- This migration moves the welcome notification from the
-- pre-confirmation moment to the post-confirmation moment:
--
--   • handle_new_user no longer inserts a welcome row. Pre-
--     confirmation copy is now silent — the email confirm CTA is
--     already covered by the auth screen.
--   • handle_email_confirmed (user_app signups) now inserts a
--     welcome row in the same transaction as the 100-coin grant.
--     Body celebrates the gift: "You got 100 coins gift on your
--     balance — bet on your favourite streamers."
--   • activate_viewer (studio-first signups) does the same on the
--     viewer's first user-app login.
--
-- The NotificationsProvider in the user-app sees this row in two
-- ways:
--   • If the viewer is already signed in + on a user-app page when
--     the email confirm runs (rare — usually they click the link
--     after sign-up before they're a session), the Realtime channel
--     pushes the row immediately.
--   • More commonly: confirm → auth callback → /home, then the
--     provider mounts and runs its "replay unread welcome" check,
--     which fetches the most-recent unread welcome and toasts it
--     sticky. The toast stays until the viewer dismisses it; the
--     dismiss handler marks it read so it doesn't re-fire on the
--     next page load.

-- ---------------------------------------------------------------------------
-- 1. handle_new_user — strip the welcome notification insert
-- ---------------------------------------------------------------------------
-- Everything else (profile insert, signup_origin coercion) stays
-- identical to 20260607_000002. Drop the notification insert so
-- pre-confirmation users don't get a "claim your coins" row that
-- becomes misleading once they confirm.

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

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. handle_email_confirmed — insert the welcome notification HERE
-- ---------------------------------------------------------------------------
-- Fires once when auth.users.email_confirmed_at flips from null to a
-- timestamp. For user_app signups, this is where the 100-coin
-- starter actually lands; bundle the welcome notification in the
-- same transaction so the row + balance + ledger entry are atomic.
-- Studio-first signups still skip the grant here (they collect it
-- when activate_viewer runs on their first user-app login).

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

      -- Celebration row — picked up by the user-app's
      -- NotificationsProvider (replay-on-mount or live Realtime
      -- push) and rendered as a sticky welcome toast.
      insert into public.notifications (user_id, type, title, body, event_id)
      values (
        new.id,
        'welcome',
        'Welcome to LiveRush 🎁',
        'You got 100.00 coins gift on your balance — bet on your favourite streamers!'
      );
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. activate_viewer — same welcome insert for studio-first signups
-- ---------------------------------------------------------------------------
-- Idempotent: only inserts the welcome notification + grants 100
-- coins on the FIRST call (viewer_activated_at is null). Subsequent
-- calls are no-ops, mirroring the existing balance-grant guard.

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

  insert into public.notifications (user_id, type, title, body, event_id)
  values (
    v_user_id,
    'welcome',
    'Welcome to LiveRush 🎁',
    'You got 100.00 coins gift on your balance — bet on your favourite streamers!'
  );

  return v_profile;
end;
$$;

grant execute on function public.activate_viewer() to authenticated;

notify pgrst, 'reload schema';
