-- LiveRush — Phase 6: Creator Studio foundation (shared-auth model)
--
-- One Supabase project backs both user-app and studio. `auth.users` is the
-- single source of truth for credentials; two profile tables hang off it:
--   • public.profiles          (consumer side, already exists)
--   • public.creator_profiles  (creator side, this migration)
--
-- A user gets a `profiles` row automatically on signup (existing trigger).
-- They get a `creator_profiles` row ONLY by going through studio onboarding.
-- Studio uses the same Supabase env vars; the apps differentiate themselves
-- by which profile table they read/write.

-- =========================================================================
-- 1) creator_profiles
-- =========================================================================

create table if not exists public.creator_profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  handle          text unique not null
                  check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name    text not null
                  check (char_length(display_name) between 2 and 40),
  avatar_url      text,
  bio             text check (bio is null or char_length(bio) <= 280),
  social_links    jsonb not null default '{}'::jsonb,
  followers_count integer not null default 0 check (followers_count >= 0),
  status          text not null default 'pending'
                  check (status in ('pending','verified','rejected')),
  commission_pct  numeric(5,2) not null default 10.00,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists creator_profiles_status_idx
  on public.creator_profiles(status);
create index if not exists creator_profiles_handle_lower_idx
  on public.creator_profiles(lower(handle));

-- updated_at trigger reuses the existing set_updated_at() helper
drop trigger if exists creator_profiles_set_updated_at on public.creator_profiles;
create trigger creator_profiles_set_updated_at
  before update on public.creator_profiles
  for each row
  execute function public.set_updated_at();

alter table public.creator_profiles enable row level security;

-- Creator reads their own row (full record).
drop policy if exists "Creator reads own profile" on public.creator_profiles;
create policy "Creator reads own profile"
  on public.creator_profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- Anyone (incl. anon visitors of user-app) reads verified creators.
-- This powers creator avatars / handles shown next to events.
drop policy if exists "Public reads verified creators" on public.creator_profiles;
create policy "Public reads verified creators"
  on public.creator_profiles
  for select
  to anon, authenticated
  using (status = 'verified');

-- All writes via the SECURITY DEFINER RPCs below.

-- =========================================================================
-- 2) events.creator_id  +  expand status check  +  tighten RLS
-- =========================================================================

-- Studio-created events live in the same `events` table as the seeded
-- influencer events. Old rows keep `influencer_id` populated; new rows
-- populate `creator_id` instead. Both columns are nullable.
alter table public.events
  add column if not exists creator_id uuid
  references public.creator_profiles(id) on delete cascade;

create index if not exists events_creator_idx on public.events(creator_id);

-- Status check needs 'draft' + 'cancelled' for the studio workflow.
alter table public.events
  drop constraint if exists events_status_check;
alter table public.events
  add constraint events_status_check
  check (status in ('draft','scheduled','live','finished','cancelled'));

-- Re-scope the public read policy so creator drafts are NOT publicly readable.
-- Seeded rows (status in {'scheduled','live','finished'}, creator_id null)
-- keep being publicly readable because they pass the `status <> 'draft'` test.
drop policy if exists "events read all" on public.events;
drop policy if exists "Public reads non-draft events" on public.events;
create policy "Public reads non-draft events"
  on public.events
  for select
  to anon, authenticated
  using (status <> 'draft' or auth.uid() = creator_id);

-- Outcomes follow the parent event's visibility.
drop policy if exists "outcomes read all" on public.event_outcomes;
drop policy if exists "Public reads outcomes of non-draft events" on public.event_outcomes;
create policy "Public reads outcomes of non-draft events"
  on public.event_outcomes
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_outcomes.event_id
        and (e.status <> 'draft' or e.creator_id = auth.uid())
    )
  );

-- =========================================================================
-- 3) RPCs — creator profile
-- =========================================================================

-- Cheap availability probe used by the onboarding form for live feedback.
create or replace function public.is_creator_handle_available(p_handle text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.creator_profiles
    where lower(handle) = lower(trim(p_handle))
  );
$$;
grant execute on function public.is_creator_handle_available(text) to anon, authenticated;

create or replace function public.complete_creator_onboarding(
  p_handle text,
  p_display_name text,
  p_avatar_url text,
  p_bio text,
  p_social_links jsonb
)
returns public.creator_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_handle text;
  v_display_name text;
  v_row public.creator_profiles;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_handle := lower(trim(p_handle));
  if v_handle is null or v_handle = '' or v_handle !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Handle must be 3-20 chars (lowercase letters, numbers, underscore)'
      using errcode = '22023';
  end if;

  v_display_name := trim(coalesce(p_display_name, ''));
  if char_length(v_display_name) < 2 or char_length(v_display_name) > 40 then
    raise exception 'Display name must be 2-40 characters' using errcode = '22023';
  end if;
  if v_display_name ~ '[<>]' then
    raise exception 'Display name contains invalid characters' using errcode = '22023';
  end if;

  if p_bio is not null and char_length(p_bio) > 280 then
    raise exception 'Bio must be 280 characters or fewer' using errcode = '22023';
  end if;

  if p_avatar_url is not null
     and p_avatar_url <> ''
     and p_avatar_url not like 'https://%' then
    raise exception 'Avatar URL must be https://' using errcode = '22023';
  end if;

  -- Handle collision check (allow same user to re-run with same handle).
  if exists (
    select 1 from public.creator_profiles
    where lower(handle) = v_handle and id <> v_user_id
  ) then
    raise exception 'That handle is already taken' using errcode = '23505';
  end if;

  insert into public.creator_profiles (
    id, handle, display_name, avatar_url, bio, social_links, status
  ) values (
    v_user_id,
    v_handle,
    v_display_name,
    nullif(p_avatar_url, ''),
    nullif(p_bio, ''),
    coalesce(p_social_links, '{}'::jsonb),
    'pending'
  )
  on conflict (id) do update
    set handle       = excluded.handle,
        display_name = excluded.display_name,
        avatar_url   = excluded.avatar_url,
        bio          = excluded.bio,
        social_links = excluded.social_links
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function
  public.complete_creator_onboarding(text, text, text, text, jsonb)
  to authenticated;

-- After onboarding, the same RPC body but it errors if no row exists yet.
create or replace function public.update_creator_profile(
  p_handle text,
  p_display_name text,
  p_avatar_url text,
  p_bio text,
  p_social_links jsonb
)
returns public.creator_profiles
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
  if not exists (select 1 from public.creator_profiles where id = v_user_id) then
    raise exception 'Creator profile not found — complete onboarding first'
      using errcode = 'P0002';
  end if;
  -- Reuse the onboarding RPC for validation + upsert semantics.
  return public.complete_creator_onboarding(
    p_handle, p_display_name, p_avatar_url, p_bio, p_social_links
  );
end;
$$;
grant execute on function
  public.update_creator_profile(text, text, text, text, jsonb)
  to authenticated;

-- =========================================================================
-- 4) RPCs — events
-- =========================================================================

create or replace function public.create_event(
  p_title text,
  p_cover_url text,
  p_description text,
  p_rules text,
  p_category text,
  p_round_format text,
  p_round_duration_sec integer,
  p_scheduled_at timestamptz,
  p_video_url text
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event_id text;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.creator_profiles where id = v_user_id) then
    raise exception 'Creator profile required' using errcode = '42501';
  end if;

  if p_title is null or char_length(trim(p_title)) between 3 and 120 is not true then
    raise exception 'Title must be 3-120 characters' using errcode = '22023';
  end if;
  if p_round_format not in ('time','event') then
    raise exception 'round_format must be ''time'' or ''event''' using errcode = '22023';
  end if;
  if p_round_format = 'time' and (p_round_duration_sec is null or p_round_duration_sec <= 0) then
    raise exception 'Time-based events need a positive round_duration_sec' using errcode = '22023';
  end if;
  if p_scheduled_at is null then
    raise exception 'scheduled_at is required' using errcode = '22023';
  end if;
  if p_category is null or char_length(trim(p_category)) = 0 then
    raise exception 'Category is required' using errcode = '22023';
  end if;

  -- Slug-style id: evt_<sanitized-title-prefix>_<random6>
  v_event_id := 'evt_' ||
    nullif(regexp_replace(lower(substr(p_title, 1, 30)), '[^a-z0-9]+', '_', 'g'), '') ||
    '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.events (
    id, creator_id, title, cover_url, description, rules,
    category, round_format, round_duration_sec, status,
    scheduled_at, video_url
  ) values (
    v_event_id, v_user_id, trim(p_title),
    nullif(p_cover_url, ''), nullif(p_description, ''), nullif(p_rules, ''),
    trim(p_category), p_round_format, p_round_duration_sec,
    'draft', p_scheduled_at, nullif(p_video_url, '')
  )
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.create_event(
  text, text, text, text, text, text, integer, timestamptz, text
) to authenticated;

create or replace function public.update_event(
  p_event_id text,
  p_title text,
  p_cover_url text,
  p_description text,
  p_rules text,
  p_category text,
  p_round_format text,
  p_round_duration_sec integer,
  p_scheduled_at timestamptz,
  p_video_url text
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_round_format not in ('time','event') then
    raise exception 'round_format must be ''time'' or ''event''' using errcode = '22023';
  end if;

  update public.events
  set title              = trim(p_title),
      cover_url          = nullif(p_cover_url, ''),
      description        = nullif(p_description, ''),
      rules              = nullif(p_rules, ''),
      category           = trim(p_category),
      round_format       = p_round_format,
      round_duration_sec = p_round_duration_sec,
      scheduled_at       = p_scheduled_at,
      video_url          = nullif(p_video_url, '')
  where id = p_event_id
    and creator_id = v_user_id
    and status = 'draft'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not editable' using errcode = '42501';
  end if;
  return v_row;
end;
$$;
grant execute on function public.update_event(
  text, text, text, text, text, text, text, integer, timestamptz, text
) to authenticated;

create or replace function public.delete_event(p_event_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_n integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  delete from public.events
  where id = p_event_id and creator_id = v_user_id and status = 'draft';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Event not found, not yours, or not deletable' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.delete_event(text) to authenticated;

-- Publish a draft → flip to 'scheduled' (or directly 'live' if scheduled_at <= now).
create or replace function public.publish_event(p_event_id text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_creator_status text;
  v_outcome_count integer;
  v_scheduled_at timestamptz;
  v_new_status text;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select status into v_creator_status
  from public.creator_profiles where id = v_user_id;
  if v_creator_status is null then
    raise exception 'Creator profile not found' using errcode = 'P0002';
  end if;
  if v_creator_status <> 'verified' then
    raise exception 'Your account must be verified to publish events'
      using errcode = '42501';
  end if;

  select scheduled_at into v_scheduled_at
  from public.events
  where id = p_event_id and creator_id = v_user_id and status = 'draft';
  if v_scheduled_at is null then
    raise exception 'Event not found or not in draft state' using errcode = '42501';
  end if;

  select count(*) into v_outcome_count
  from public.event_outcomes where event_id = p_event_id;
  if v_outcome_count < 2 then
    raise exception 'Event needs at least 2 outcomes before publishing'
      using errcode = '22023';
  end if;

  v_new_status := case when v_scheduled_at <= now() then 'live' else 'scheduled' end;

  update public.events
  set status = v_new_status,
      started_at = case when v_new_status = 'live' then now() else null end
  where id = p_event_id and creator_id = v_user_id and status = 'draft'
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.publish_event(text) to authenticated;

create or replace function public.unpublish_event(p_event_id text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  update public.events
  set status = 'draft', started_at = null
  where id = p_event_id and creator_id = v_user_id and status in ('scheduled','live')
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Event not found, not yours, or not unpublishable'
      using errcode = '42501';
  end if;
  return v_row;
end;
$$;
grant execute on function public.unpublish_event(text) to authenticated;

-- =========================================================================
-- 5) RPCs — event outcomes (only on creator's own draft events)
-- =========================================================================

create or replace function public.add_event_outcome(
  p_event_id text,
  p_label text,
  p_odds numeric,
  p_sort_order integer
)
returns public.event_outcomes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_outcome_id text;
  v_row public.event_outcomes;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.events
    where id = p_event_id and creator_id = v_user_id and status = 'draft'
  ) then
    raise exception 'Event not found or not editable' using errcode = '42501';
  end if;
  if p_odds is null or p_odds <= 1 then
    raise exception 'Odds must be > 1' using errcode = '22023';
  end if;
  if p_label is null or char_length(trim(p_label)) < 1 then
    raise exception 'Outcome label is required' using errcode = '22023';
  end if;

  v_outcome_id := p_event_id || '_o' ||
                  substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.event_outcomes (id, event_id, label, odds, sort_order)
  values (v_outcome_id, p_event_id, trim(p_label), p_odds, coalesce(p_sort_order, 0))
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.add_event_outcome(text, text, numeric, integer) to authenticated;

create or replace function public.update_event_outcome(
  p_outcome_id text,
  p_label text,
  p_odds numeric,
  p_sort_order integer
)
returns public.event_outcomes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_row public.event_outcomes;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_odds is null or p_odds <= 1 then
    raise exception 'Odds must be > 1' using errcode = '22023';
  end if;
  update public.event_outcomes o
  set label = trim(p_label),
      odds = p_odds,
      sort_order = coalesce(p_sort_order, o.sort_order)
  from public.events e
  where o.id = p_outcome_id
    and e.id = o.event_id
    and e.creator_id = v_user_id
    and e.status = 'draft'
  returning o.* into v_row;
  if v_row.id is null then
    raise exception 'Outcome not found, not yours, or not editable' using errcode = '42501';
  end if;
  return v_row;
end;
$$;
grant execute on function public.update_event_outcome(text, text, numeric, integer) to authenticated;

create or replace function public.delete_event_outcome(p_outcome_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_n integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  delete from public.event_outcomes o
  using public.events e
  where o.id = p_outcome_id
    and e.id = o.event_id
    and e.creator_id = v_user_id
    and e.status = 'draft';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Outcome not found, not yours, or not deletable' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.delete_event_outcome(text) to authenticated;

-- =========================================================================
-- 6) Storage policies for the `creator-assets` bucket
-- =========================================================================
-- The bucket itself must be created manually in Supabase Dashboard:
--   Bucket name: creator-assets
--   Public:      yes
--   File size:   2 MiB (client also enforces 500 KB for avatars, 2 MiB for covers)
--
-- Files are organized as `{user_id}/avatar.<ext>` and
-- `{user_id}/covers/{event_id}.<ext>`. The (storage.foldername(name))[1]
-- check pins each path's first segment to the uploader's auth.uid().

drop policy if exists "Public read creator assets" on storage.objects;
create policy "Public read creator assets"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'creator-assets');

drop policy if exists "Creator upload own assets" on storage.objects;
create policy "Creator upload own assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Creator update own assets" on storage.objects;
create policy "Creator update own assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Creator delete own assets" on storage.objects;
create policy "Creator delete own assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
