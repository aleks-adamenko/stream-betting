-- Direct creator follow / unfollow RPCs.
--
-- The notifications work earlier added a `creator_followers` table
-- (creator_id, follower_user_id, created_at, last_notified_at) that
-- gets auto-populated as a SIDE EFFECT of subscribing to an event.
-- It already powers the email-throttle window — see
-- 20260528_000001_notifications.sql.
--
-- This migration adds the missing piece: a user-facing follow
-- relationship that's NOT tied to event subscriptions. A viewer
-- can tap "Follow" on a creator's profile to add the row directly,
-- and "Unfollow" to remove it. Subscribing to an event still adds
-- the row implicitly (existing behaviour preserved), but the
-- explicit flow is now first-class.
--
-- RPCs added:
--   • follow_creator(p_creator_id)            → returns the row
--   • unfollow_creator(p_creator_id)          → returns void
--   • is_following_creator(p_creator_id)      → returns boolean
--   • get_creator_follower_count(p_creator_id) → returns integer
--
-- All four are SECURITY DEFINER so they can write to / read
-- creator_followers under the user's auth.uid() identity without
-- needing direct INSERT/SELECT privileges on the table. The
-- existing RLS policy on creator_followers ("user reads own creator
-- follows") still applies for direct selects from authenticated
-- clients.

-- =========================================================================
-- follow_creator — idempotent. Inserts the row; on conflict returns
-- the existing one. Refuses to follow self.
-- =========================================================================

create or replace function public.follow_creator(p_creator_id uuid)
returns public.creator_followers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_row      public.creator_followers;
  v_owner_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- A creator profile row's `id` is the creator_id we follow against,
  -- and creator_profiles.user_id is the actual auth user behind it.
  -- Prevent following yourself.
  select user_id into v_owner_id
  from public.creator_profiles
  where id = p_creator_id;

  if v_owner_id is null then
    raise exception 'Creator not found' using errcode = 'P0002';
  end if;

  if v_owner_id = v_user_id then
    raise exception 'Cannot follow yourself' using errcode = '22023';
  end if;

  insert into public.creator_followers (creator_id, follower_user_id)
  values (p_creator_id, v_user_id)
  on conflict (creator_id, follower_user_id) do update
    set creator_id = excluded.creator_id  -- no-op, returns existing row
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.follow_creator(uuid) to authenticated;

-- =========================================================================
-- unfollow_creator — removes the row. No-op if already absent.
-- =========================================================================

create or replace function public.unfollow_creator(p_creator_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  delete from public.creator_followers
  where creator_id = p_creator_id
    and follower_user_id = v_user_id;
end;
$$;

grant execute on function public.unfollow_creator(uuid) to authenticated;

-- =========================================================================
-- is_following_creator — true if the caller already follows. Used by
-- the React Query hook driving the Follow / Following button state.
-- =========================================================================

create or replace function public.is_following_creator(p_creator_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user_id uuid := auth.uid();
  v_exists  boolean;
begin
  if v_user_id is null then
    return false;
  end if;

  select exists (
    select 1 from public.creator_followers
    where creator_id = p_creator_id
      and follower_user_id = v_user_id
  ) into v_exists;

  return v_exists;
end;
$$;

grant execute on function public.is_following_creator(uuid)
  to anon, authenticated;

-- =========================================================================
-- get_creator_follower_count — total followers across all events +
-- direct follows. Public read so unauthenticated viewers see the
-- count on creator profiles / event pages too.
-- =========================================================================

create or replace function public.get_creator_follower_count(p_creator_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.creator_followers
  where creator_id = p_creator_id;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.get_creator_follower_count(uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';
