-- Strengthen unfollow_creator so it truly stops *all* email
-- notifications from the unfollowed creator.
--
-- Previous behaviour:
--   • Deleted the row from public.creator_followers.
--   • Left public.event_subscribers rows for that creator's events
--     untouched.
--
-- The notification dispatch path is split across two recipient sets:
--   • notify-new-scheduled-event → reads creator_followers
--   • notify-event-live          → reads event_subscribers ∪
--                                  creator_followers
-- So after unfollowing, the user still received "your subscribed
-- event is now live" emails for any individual events of that
-- creator they'd previously tapped "Notify me" on. Product intent
-- per latest design pass: unfollow == hard stop on all email
-- channels from this creator, no exceptions.
--
-- Fix: in the same SECURITY DEFINER call, also delete every
-- event_subscribers row for the calling user where the event's
-- creator_id matches the unfollowed creator. The two deletes run
-- inside the same transaction, so unfollow is atomic — the user
-- never sees a half-applied state where one row class is gone and
-- the other lingers.
--
-- Re-subscribing to a specific event later still re-establishes
-- both rows (subscribe_event upserts both event_subscribers and
-- creator_followers), so opting back in is one tap.

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

  -- 1) Drop the creator-level follow row. Stops:
  --    - notify-new-scheduled-event emails
  --    - notify-event-live emails (the creator_followers half of
  --      its recipient union)
  delete from public.creator_followers
  where creator_id = p_creator_id
    and follower_user_id = v_user_id;

  -- 2) Drop every per-event subscription this user has for events
  --    owned by the unfollowed creator. Stops:
  --    - notify-event-live emails (the event_subscribers half)
  --    Uses a sub-select against events.creator_id; the
  --    event_subscribers row itself doesn't store the creator id,
  --    so we join through events on each delete.
  delete from public.event_subscribers es
  using public.events e
  where es.event_id = e.id
    and es.user_id = v_user_id
    and e.creator_id = p_creator_id;
end;
$$;

notify pgrst, 'reload schema';
