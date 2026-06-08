-- LiveRush — drop the 🎁 emoji from welcome notification titles.
--
-- The toast card already has its own iconography (the filled-star
-- avatar circle on the left), so the trailing emoji in the title
-- was visual noise that competed with the icon for attention.
-- Strip it from the trigger functions going forward and update
-- existing rows so the toast layer renders consistently across
-- old and new welcomes.

-- ---------------------------------------------------------------------------
-- 1. handle_email_confirmed — no emoji in the new welcome title
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

      begin
        insert into public.notifications (user_id, type, title, body)
        values (
          new.id,
          'welcome',
          'Welcome to LiveRush',
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
-- 2. activate_viewer — same emoji strip
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
      'Welcome to LiveRush',
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
-- 3. Strip the emoji from already-INSERTed welcome titles
-- ---------------------------------------------------------------------------
-- Both 20260609_000002 and 20260609_000003/4 wrote titles ending in
-- ' 🎁'. Update them in place. Idempotent — re-running this on a
-- DB with no emoji-tagged titles is a no-op.

update public.notifications
set title = 'Welcome to LiveRush'
where type = 'welcome'
  and title like '%🎁%';

notify pgrst, 'reload schema';
