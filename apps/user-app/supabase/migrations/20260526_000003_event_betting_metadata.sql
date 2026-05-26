-- LiveRush — extend `events` with betting metadata the studio editor now
-- collects. Studio writes these columns via create_event/update_event;
-- the user-app doesn't read them yet (display polish lands in a later
-- phase). All columns are nullable so seeded events stay valid.
--
-- Column reference:
--   resolution_method       objective / subjective / measured
--   resolution_authority    creator_dispute / moderator_review / auto_signal
--   void_conditions         free text, ≤ 500 chars
--   min_bet_cents           ≥ 100 (= 1 currency unit), default 100
--   max_bet_cents           ≥ min_bet_cents, ≤ 1,000,000 (= 10k cap)
--   bet_window_opens        on_live / 15m_before / 1h_before / 24h_before
--   bet_window_locks        manual / 30s_after / 1m_after / 2m_after / 5m_after
--   source_type             browser_camera / external_rtmp / external_url
--   broadcast_delay_sec     0 / 5 / 10 / 15

alter table public.events
  add column if not exists resolution_method      text,
  add column if not exists resolution_authority   text,
  add column if not exists void_conditions        text,
  add column if not exists min_bet_cents          integer,
  add column if not exists max_bet_cents          integer,
  add column if not exists bet_window_opens       text,
  add column if not exists bet_window_locks       text,
  add column if not exists source_type            text,
  add column if not exists broadcast_delay_sec    integer;

-- Enum-style check constraints (text columns with whitelisted values keep
-- the migration simple and let us add values without touching Postgres
-- enum types).
alter table public.events
  drop constraint if exists events_resolution_method_check;
alter table public.events
  add constraint events_resolution_method_check
  check (resolution_method is null
         or resolution_method in ('objective','subjective','measured'));

alter table public.events
  drop constraint if exists events_resolution_authority_check;
alter table public.events
  add constraint events_resolution_authority_check
  check (resolution_authority is null
         or resolution_authority in ('creator_dispute','moderator_review','auto_signal'));

alter table public.events
  drop constraint if exists events_bet_window_opens_check;
alter table public.events
  add constraint events_bet_window_opens_check
  check (bet_window_opens is null
         or bet_window_opens in ('on_live','15m_before','1h_before','24h_before'));

alter table public.events
  drop constraint if exists events_bet_window_locks_check;
alter table public.events
  add constraint events_bet_window_locks_check
  check (bet_window_locks is null
         or bet_window_locks in ('manual','30s_after','1m_after','2m_after','5m_after'));

alter table public.events
  drop constraint if exists events_source_type_check;
alter table public.events
  add constraint events_source_type_check
  check (source_type is null
         or source_type in ('browser_camera','external_rtmp','external_url'));

alter table public.events
  drop constraint if exists events_broadcast_delay_check;
alter table public.events
  add constraint events_broadcast_delay_check
  check (broadcast_delay_sec is null
         or broadcast_delay_sec in (0,5,10,15));

alter table public.events
  drop constraint if exists events_bet_amount_check;
alter table public.events
  add constraint events_bet_amount_check
  check (
    (min_bet_cents is null and max_bet_cents is null)
    or (
      min_bet_cents is not null
      and max_bet_cents is not null
      and min_bet_cents >= 100
      and max_bet_cents >= min_bet_cents
      and max_bet_cents <= 1000000
    )
  );

alter table public.events
  drop constraint if exists events_void_conditions_length_check;
alter table public.events
  add constraint events_void_conditions_length_check
  check (void_conditions is null or char_length(void_conditions) <= 500);

-- =========================================================================
-- RPC updates — extend create_event + update_event with the new params.
-- Both keep all-new params optional so the wizard can save partial drafts
-- and so any older RPC clients (none today, but defensive) still work.
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
  p_video_url text,
  p_resolution_method text default null,
  p_resolution_authority text default null,
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
    resolution_method, resolution_authority, void_conditions,
    min_bet_cents, max_bet_cents,
    bet_window_opens, bet_window_locks,
    source_type, broadcast_delay_sec
  ) values (
    v_event_id, v_user_id, trim(p_title),
    nullif(p_cover_url, ''), nullif(p_description, ''), nullif(p_rules, ''),
    trim(p_category), p_round_format, p_round_duration_sec,
    'draft', p_scheduled_at, nullif(p_video_url, ''),
    p_resolution_method, p_resolution_authority, nullif(p_void_conditions, ''),
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
  text, text, text, integer, integer, text, text, text, integer
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
  p_video_url text,
  p_resolution_method text default null,
  p_resolution_authority text default null,
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
      resolution_method    = p_resolution_method,
      resolution_authority = p_resolution_authority,
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
  text, text, text, integer, integer, text, text, text, integer
) to authenticated;
