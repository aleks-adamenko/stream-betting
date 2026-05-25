-- LiveRush — Phase 5 extension: profile + notifications + top-up

-- =========================================================================
-- 1) Tighten profiles RLS
-- =========================================================================

-- Drop the broad UPDATE policy — users will now mutate fields only via
-- dedicated security-definer RPCs so they can't simply bump balance_cents.
drop policy if exists "Users update own profile" on public.profiles;

-- =========================================================================
-- 2) Notifications table
-- =========================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (
    type in ('welcome', 'bet_won', 'bet_lost', 'event_starting', 'new_follower', 'top_up')
  ),
  title text not null,
  body text,
  event_id text references public.events(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications(user_id)
  where not read;

alter table public.notifications enable row level security;

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications"
  on public.notifications
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications"
  on public.notifications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =========================================================================
-- 3) RPCs: update_profile_display_name / update_profile_avatar_url / top_up_balance / mark_notification_read
-- =========================================================================

create or replace function public.update_profile_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_trimmed text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_trimmed := trim(p_name);
  if v_trimmed is null or char_length(v_trimmed) < 2 then
    raise exception 'Display name must be at least 2 characters' using errcode = '22023';
  end if;
  if char_length(v_trimmed) > 30 then
    raise exception 'Display name must be at most 30 characters' using errcode = '22023';
  end if;
  if v_trimmed ~ '[<>]' then
    raise exception 'Display name contains invalid characters' using errcode = '22023';
  end if;

  update public.profiles
  set display_name = v_trimmed
  where id = v_user_id;
end;
$$;

grant execute on function public.update_profile_display_name(text) to authenticated;

create or replace function public.update_profile_avatar_url(p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_avatar_url is not null
     and p_avatar_url <> ''
     and p_avatar_url not like 'https://%' then
    raise exception 'Avatar URL must be https://' using errcode = '22023';
  end if;

  update public.profiles
  set avatar_url = nullif(p_avatar_url, '')
  where id = v_user_id;
end;
$$;

grant execute on function public.update_profile_avatar_url(text) to authenticated;

create or replace function public.top_up_balance(p_amount_cents integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_new_balance integer;
  v_amount_dollars numeric(10, 2);
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Top-up amount must be positive' using errcode = '22023';
  end if;

  -- Sanity cap: $10,000 per single top-up to avoid runaway clicks during demos
  if p_amount_cents > 1000000 then
    raise exception 'Exceeds top-up limit ($10,000)' using errcode = '22023';
  end if;

  update public.profiles
  set balance_cents = balance_cents + p_amount_cents
  where id = v_user_id
  returning balance_cents into v_new_balance;

  if v_new_balance is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  -- Drop a friendly notification so the user sees confirmation in their feed
  v_amount_dollars := p_amount_cents / 100.0;
  insert into public.notifications (user_id, type, title, body)
  values (
    v_user_id,
    'top_up',
    '+$' || to_char(v_amount_dollars, 'FM999,990.00') || ' added to your balance',
    'Virtual prototype balance — no real money is taken.'
  );

  return json_build_object(
    'new_balance_cents', v_new_balance,
    'amount_cents', p_amount_cents
  );
end;
$$;

grant execute on function public.top_up_balance(integer) to authenticated;

create or replace function public.mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update public.notifications
  set read = true
  where id = p_id
    and user_id = v_user_id;
end;
$$;

grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update public.notifications
  set read = true
  where user_id = v_user_id
    and not read;
end;
$$;

grant execute on function public.mark_all_notifications_read() to authenticated;

-- =========================================================================
-- 4) Welcome + fake-seed inside handle_new_user trigger
-- =========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display text;
begin
  v_display := coalesce(
    new.raw_user_meta_data->>'display_name',
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, display_name, balance_cents)
  values (new.id, v_display, 100000)
  on conflict (id) do nothing;

  -- Seed 5 demo notifications so /notifications looks lively from minute one.
  insert into public.notifications (user_id, type, title, body, event_id, read, created_at) values
    (
      new.id, 'welcome',
      'Welcome to LiveRush ⚡',
      'You start with $1,000 virtual balance. Place your first bet on a live challenge!',
      null, false, now()
    ),
    (
      new.id, 'event_starting',
      'Don''t Pop The Balloon goes live now',
      'The Smily Fam''s viral balloon-box challenge is streaming — jump in before the next round.',
      'evt_balloon_box', false, now() - interval '7 minutes'
    ),
    (
      new.id, 'bet_won',
      '+$48.00 — you won a side bet',
      'Round 2 of Spicy Ramen Pyramid settled. Payout credited to your balance.',
      'evt_spicy_ramen', true, now() - interval '2 hours'
    ),
    (
      new.id, 'new_follower',
      'Vibe Queen is now in your Following',
      'See her latest blindfolded cup race and never miss a live drop.',
      'evt_blindfold_cup', false, now() - interval '5 hours'
    ),
    (
      new.id, 'event_starting',
      'Hot Sauce Roulette airs tomorrow',
      'Grandpa Ranks is bringing back the Carolina Reaper. Don''t miss it.',
      'evt_hot_sauce_roulette', true, now() - interval '1 day'
    );

  return new;
end;
$$;

-- =========================================================================
-- 5) Storage RLS for avatars bucket
-- =========================================================================
-- NOTE: the bucket itself must be created manually in the Supabase Dashboard
--   Bucket name: avatars
--   Public:      yes
--   File size:   1 MiB (the client also enforces 200 KB)
-- After the bucket exists, these policies grant fine-grained access.

drop policy if exists "Public read avatars" on storage.objects;
create policy "Public read avatars"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "User upload own avatar" on storage.objects;
create policy "User upload own avatar"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "User update own avatar" on storage.objects;
create policy "User update own avatar"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "User delete own avatar" on storage.objects;
create policy "User delete own avatar"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
