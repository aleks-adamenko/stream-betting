-- LiveRush — explicit start / finish RPCs for the event lifecycle.
--
-- Until now creators flipped events to 'live' implicitly through
-- publish_event (which jumped scheduled → live when scheduled_at <=
-- now). Now we add explicit creator-driven actions:
--
--   • start_event(p_event_id)  scheduled → live  + stamp started_at
--   • finish_event(p_event_id) live → finished
--
-- Bets, payouts and resolution all hang off these state transitions
-- in later phases; for now the RPCs just gate the row's status field
-- so the user-app + studio render the right UI per phase.

create or replace function public.start_event(p_event_id text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_creator_status text;
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
    raise exception 'Your account must be verified to start an event'
      using errcode = '42501';
  end if;

  update public.events
  set status     = 'live',
      started_at = coalesce(started_at, now())
  where id = p_event_id
    and creator_id = v_user_id
    and status = 'scheduled'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not in scheduled state'
      using errcode = '42501';
  end if;
  return v_row;
end;
$$;
grant execute on function public.start_event(text) to authenticated;

create or replace function public.finish_event(p_event_id text)
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
  set status = 'finished'
  where id = p_event_id
    and creator_id = v_user_id
    and status = 'live'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not in live state'
      using errcode = '42501';
  end if;
  return v_row;
end;
$$;
grant execute on function public.finish_event(text) to authenticated;
