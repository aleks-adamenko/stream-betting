-- Bug fix: follow_creator referenced a non-existent column.
--
-- The previous version did:
--   select user_id into v_owner_id from public.creator_profiles
--   where id = p_creator_id;
--
-- But `creator_profiles` has no `user_id` column — its primary key
-- `id` is itself a FK to auth.users(id) (see
-- 20260525_000001_creator_profiles.sql). The function was created
-- successfully (Postgres doesn't validate column references at
-- CREATE FUNCTION time) but errored at runtime on every call with
-- "column user_id does not exist", silently breaking the Follow
-- button on the event page.
--
-- Fix: drop the user_id lookup entirely. Since creator_profiles.id
-- IS the auth user id, the self-follow check is just
-- `p_creator_id = auth.uid()`. Existence check stays as a defensive
-- `select exists(...)` against creator_profiles.

create or replace function public.follow_creator(p_creator_id uuid)
returns public.creator_followers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row     public.creator_followers;
  v_exists  boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- creator_profiles.id IS the owning auth user id, so self-follow
  -- reduces to p_creator_id = v_user_id.
  if p_creator_id = v_user_id then
    raise exception 'Cannot follow yourself' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.creator_profiles where id = p_creator_id
  ) into v_exists;

  if not v_exists then
    raise exception 'Creator not found' using errcode = 'P0002';
  end if;

  insert into public.creator_followers (creator_id, follower_user_id)
  values (p_creator_id, v_user_id)
  on conflict (creator_id, follower_user_id) do update
    set creator_id = excluded.creator_id  -- no-op, returns existing row
  returning * into v_row;

  return v_row;
end;
$$;

notify pgrst, 'reload schema';
