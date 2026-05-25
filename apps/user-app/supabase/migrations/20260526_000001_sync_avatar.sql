-- LiveRush — keep avatar_url in sync between profiles and creator_profiles
--
-- A single user has at most one profiles row and at most one creator_profiles
-- row, both keyed by auth.users.id. Before this migration the two avatar_url
-- columns drifted: user-app uploads only touched profiles, studio uploads
-- only touched creator_profiles, so changing the image in one place left the
-- other stale.
--
-- After this migration the three write-paths that change a user's avatar
-- always write to BOTH columns:
--   • update_profile_avatar_url        (user-app: /profile page)
--   • complete_creator_onboarding      (studio: /onboarding step 2 → save)
--   • update_creator_profile           (studio: future /settings page)
--
-- The avatar files themselves still live in their original buckets
-- (`avatars` for user-app uploads, `creator-assets` for studio uploads);
-- only the URL pointer is mirrored. Both buckets are public so either
-- side can render whichever URL is current.

-- =========================================================================
-- 1) update_profile_avatar_url — also write to creator_profiles
-- =========================================================================

create or replace function public.update_profile_avatar_url(p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_value text;
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

  v_value := nullif(p_avatar_url, '');

  update public.profiles
  set avatar_url = v_value
  where id = v_user_id;

  -- Mirror to the creator side if a creator_profiles row exists for this
  -- user. No-op when the user hasn't been through studio onboarding yet.
  update public.creator_profiles
  set avatar_url = v_value
  where id = v_user_id;
end;
$$;

grant execute on function public.update_profile_avatar_url(text) to authenticated;

-- =========================================================================
-- 2) complete_creator_onboarding — also write to profiles
-- =========================================================================
-- update_creator_profile internally delegates to complete_creator_onboarding
-- so this one change covers both studio write-paths.

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
  v_avatar text;
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

  v_avatar := nullif(p_avatar_url, '');

  insert into public.creator_profiles (
    id, handle, display_name, avatar_url, bio, social_links, status
  ) values (
    v_user_id,
    v_handle,
    v_display_name,
    v_avatar,
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

  -- Mirror onto the user-app side. The handle_new_user trigger always
  -- creates a profiles row on signup, so this UPDATE finds its target.
  update public.profiles
  set avatar_url = v_avatar
  where id = v_user_id;

  return v_row;
end;
$$;

grant execute on function
  public.complete_creator_onboarding(text, text, text, text, jsonb)
  to authenticated;
