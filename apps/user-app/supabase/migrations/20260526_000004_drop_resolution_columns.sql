-- LiveRush — drop resolution_method + resolution_authority from events.
--
-- These columns landed in 20260526_000003 alongside the betting metadata
-- pass, but the product no longer surfaces a creator choice for them:
-- LiveRush moderates every outcome resolution centrally. Studio doesn't
-- collect either field anymore, so we strip the columns and rebuild the
-- create_event / update_event RPCs without those two params.
--
-- Existing draft rows lose any text that was sitting in those columns —
-- intentional, since the data has no future use.

-- 1) Drop check constraints + columns -------------------------------------

alter table public.events
  drop constraint if exists events_resolution_method_check;
alter table public.events
  drop constraint if exists events_resolution_authority_check;

alter table public.events
  drop column if exists resolution_method,
  drop column if exists resolution_authority;

-- 2) Drop the old RPC signatures (changing the parameter list means we
--    can't `create or replace` — we must drop and recreate).

drop function if exists public.create_event(
  text, text, text, text, text, text, integer, timestamptz, text,
  text, text, text, integer, integer, text, text, text, integer
);

drop function if exists public.update_event(
  text, text, text, text, text, text, text, integer, timestamptz, text,
  text, text, text, integer, integer, text, text, text, integer
);

-- 3) Rebuild create_event without the two resolution params ---------------

create or replace function public.create_event(
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

  v_event_id := 'evt_' ||
    nullif(regexp_replace(lower(substr(p_title, 1, 30)), '[^a-z0-9]+', '_', 'g'), '') ||
    '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.events (
    id, creator_id, title, cover_url, description, rules,
    category, round_format, round_duration_sec, status,
    scheduled_at, video_url,
    void_conditions,
    min_bet_cents, max_bet_cents,
    bet_window_opens, bet_window_locks,
    source_type, broadcast_delay_sec
  ) values (
    v_event_id, v_user_id, trim(p_title),
    nullif(p_cover_url, ''), nullif(p_description, ''), nullif(p_rules, ''),
    trim(p_category), p_round_format, p_round_duration_sec,
    'draft', p_scheduled_at, nullif(p_video_url, ''),
    nullif(p_void_conditions, ''),
    p_min_bet_cents, p_max_bet_cents,
    p_bet_window_opens, p_bet_window_locks,
    p_source_type, p_broadcast_delay_sec
  )
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.create_event(
  text, text, text, text, text, text, integer, timestamptz, text,
  text, integer, integer, text, text, text, integer
) to authenticated;

-- 4) Rebuild update_event without the two resolution params ---------------

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
    and status = 'draft'
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
