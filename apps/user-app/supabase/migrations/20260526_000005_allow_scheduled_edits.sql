-- LiveRush — allow editing of events while they are 'scheduled'.
--
-- After publishing, creators want to keep tweaking cover / title /
-- description / rules / round format / betting settings / scheduled
-- time before the event actually goes live. Until now update_event +
-- the event_outcomes RPCs only matched rows in `draft` status.
--
-- Stream source + URL remain a client-side concern: the studio editor
-- locks those inputs once published so viewers don't get a different
-- source mid-flight. The RPCs still accept the values so a save call
-- with the same (unchanged) values doesn't fail.

-- 1) update_event ----------------------------------------------------------

drop function if exists public.update_event(
  text, text, text, text, text, text, text, integer, timestamptz, text,
  text, integer, integer, text, text, text, integer
);

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
  p_video_url text,
  p_void_conditions text default null,
  p_min_bet_cents integer default null,
  p_max_bet_cents integer default null,
  p_bet_window_opens text default null,
  p_bet_window_locks text default null,
  p_source_type text default null,
  p_broadcast_delay_sec integer default null
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
  set title                = trim(p_title),
      cover_url            = nullif(p_cover_url, ''),
      description          = nullif(p_description, ''),
      rules                = nullif(p_rules, ''),
      category             = trim(p_category),
      round_format         = p_round_format,
      round_duration_sec   = p_round_duration_sec,
      scheduled_at         = p_scheduled_at,
      video_url            = nullif(p_video_url, ''),
      void_conditions      = nullif(p_void_conditions, ''),
      min_bet_cents        = p_min_bet_cents,
      max_bet_cents        = p_max_bet_cents,
      bet_window_opens     = p_bet_window_opens,
      bet_window_locks     = p_bet_window_locks,
      source_type          = p_source_type,
      broadcast_delay_sec  = p_broadcast_delay_sec
  where id = p_event_id
    and creator_id = v_user_id
    and status in ('draft','scheduled')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not editable' using errcode = '42501';
  end if;
  return v_row;
end;
$$;
grant execute on function public.update_event(
  text, text, text, text, text, text, text, integer, timestamptz, text,
  text, integer, integer, text, text, text, integer
) to authenticated;

-- 2) Outcome RPCs — same widening so creators can add / rename / drop
--    outcomes on a scheduled event the same way they could on a draft.

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
    where id = p_event_id
      and creator_id = v_user_id
      and status in ('draft','scheduled')
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
    and e.status in ('draft','scheduled')
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
    and e.status in ('draft','scheduled');
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Outcome not found, not yours, or not deletable' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.delete_event_outcome(text) to authenticated;

-- delete_event stays draft-only: scheduled events shouldn't disappear
-- from the user-app feed without explicit unpublish-first.
