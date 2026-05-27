-- LiveRush — event notification system v1.
--
-- Adds:
--   • `event_subscribers` — registered users who tapped "Notify me
--     when live" on a specific event.
--   • `creator_followers` — derived edge automatically populated when
--     subscribing to any event from a creator. Drives the "creator
--     published / went live with another event" notifications.
--   • `profiles.notifications_enabled` — global per-user toggle. When
--     off, no transactional emails go out (in-app notifications are
--     not affected).
--   • `events.live_notified_at` + `events.scheduled_notified_at` —
--     idempotency stamps so the dispatch trigger can't double-fire if
--     status hops back and forth or a creator edits a scheduled event.
--   • SECURITY DEFINER RPCs: subscribe_event, unsubscribe_event,
--     get_event_subscriber_count, set_notifications_enabled.
--   • Postgres trigger on `events` status changes that fires the
--     Edge Functions via pg_net.http_post. The trigger reads a
--     bearer token out of Supabase Vault so we don't bake it into
--     migration history.
--
-- Per the locked product decision (see plan doc), only registered
-- users can subscribe. Anonymous viewers tapping the Notify button
-- get routed through sign-in first. Throttle is 1 email per creator
-- per follower per hour (tracked on creator_followers.last_notified_at).
--
-- Operator setup that must precede this migration:
--   • Resend API key + webhook secret set via `supabase secrets set`.
--   • Vault secrets (both — the trigger reads them at fire-time):
--       select vault.create_secret('<random token>', 'internal_webhook_token');
--       select vault.create_secret('https://<project-ref>.functions.supabase.co',
--                                  'functions_base_url');
--   • `create extension if not exists pg_net with schema extensions;`
--     (usually already enabled on Supabase by default).

-- =========================================================================
-- 1) event_subscribers
-- =========================================================================

create table if not exists public.event_subscribers (
  event_id    text not null
              references public.events(id) on delete cascade,
  user_id     uuid not null
              references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists event_subscribers_user_idx
  on public.event_subscribers(user_id);

alter table public.event_subscribers enable row level security;

drop policy if exists "user reads own event subscriptions"
  on public.event_subscribers;
create policy "user reads own event subscriptions"
  on public.event_subscribers
  for select
  to authenticated
  using (user_id = auth.uid());

-- Writes only via the SECURITY DEFINER RPCs below.

-- =========================================================================
-- 2) creator_followers
-- =========================================================================

create table if not exists public.creator_followers (
  creator_id          uuid not null
                      references public.creator_profiles(id) on delete cascade,
  follower_user_id    uuid not null
                      references auth.users(id) on delete cascade,
  -- Updated by notify-new-scheduled-event after it sends. The 1h
  -- window check (`last_notified_at < now() - interval '1 hour'`)
  -- prevents creators who batch-publish multiple events from spamming
  -- their followers.
  last_notified_at    timestamptz,
  created_at          timestamptz not null default now(),
  primary key (creator_id, follower_user_id)
);

create index if not exists creator_followers_follower_idx
  on public.creator_followers(follower_user_id);

alter table public.creator_followers enable row level security;

drop policy if exists "user reads own creator follows"
  on public.creator_followers;
create policy "user reads own creator follows"
  on public.creator_followers
  for select
  to authenticated
  using (follower_user_id = auth.uid());

-- =========================================================================
-- 3) profiles.notifications_enabled
-- =========================================================================

alter table public.profiles
  add column if not exists notifications_enabled boolean
  not null default true;

-- =========================================================================
-- 4) events idempotency stamps
-- =========================================================================

alter table public.events
  add column if not exists live_notified_at timestamptz,
  add column if not exists scheduled_notified_at timestamptz;

-- =========================================================================
-- 5) RPCs
-- =========================================================================

-- subscribe_event — idempotent. Inserts both rows in one transaction.
-- Rejects subscribing to events that are finished or cancelled (no
-- point notifying about something that's already over).
create or replace function public.subscribe_event(p_event_id text)
returns public.event_subscribers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_creator_id  uuid;
  v_status      text;
  v_row         public.event_subscribers;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select creator_id, status into v_creator_id, v_status
  from public.events
  where id = p_event_id;

  if v_creator_id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_status in ('finished', 'cancelled') then
    raise exception 'Event has already ended' using errcode = '22023';
  end if;

  -- Per-event subscription — idempotent.
  insert into public.event_subscribers (event_id, user_id)
  values (p_event_id, v_user_id)
  on conflict (event_id, user_id) do update
    set event_id = excluded.event_id  -- no-op, returns existing row
  returning * into v_row;

  -- Auto-follow the creator (idempotent). Future events from this
  -- creator will notify this user automatically.
  insert into public.creator_followers (creator_id, follower_user_id)
  values (v_creator_id, v_user_id)
  on conflict (creator_id, follower_user_id) do nothing;

  return v_row;
end;
$$;

grant execute on function public.subscribe_event(text) to authenticated;

-- unsubscribe_event — removes the per-event subscriber row but KEEPS
-- the creator_followers edge intact. Viewer can still receive
-- "creator scheduled a new event" emails; they've just opted out of
-- *this specific* event reminder. Full creator unsubscribe lives in
-- the profile toggle (notifications_enabled = false) for now.
create or replace function public.unsubscribe_event(p_event_id text)
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

  delete from public.event_subscribers
  where event_id = p_event_id and user_id = v_user_id;
end;
$$;

grant execute on function public.unsubscribe_event(text) to authenticated;

-- get_event_subscriber_count — distinct count of users who'll get a
-- notification for this event: union of direct subscribers and the
-- creator's followers. Public read (anon + authenticated) because
-- this is the "12 people will be notified" social-proof number.
create or replace function public.get_event_subscriber_count(p_event_id text)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_creator_id uuid;
  v_count integer;
begin
  select creator_id into v_creator_id
  from public.events
  where id = p_event_id;

  if v_creator_id is null then
    return 0;
  end if;

  select count(distinct user_id) into v_count
  from (
    select user_id from public.event_subscribers where event_id = p_event_id
    union
    select follower_user_id as user_id from public.creator_followers
      where creator_id = v_creator_id
  ) recipients;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.get_event_subscriber_count(text)
  to anon, authenticated;

-- set_notifications_enabled — toggle for the profile-page switch.
create or replace function public.set_notifications_enabled(p_enabled boolean)
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

  update public.profiles
  set notifications_enabled = p_enabled
  where id = v_user_id;
end;
$$;

grant execute on function public.set_notifications_enabled(boolean)
  to authenticated;

-- =========================================================================
-- 6) Dispatch trigger — fires Edge Functions on events status changes
-- =========================================================================
--
-- pg_net is async (fire-and-forget); failures land in net._http_response.
-- We swallow exceptions inside the trigger so a notification dispatch
-- failure never rolls back the underlying status change (creator
-- shouldn't see their stream fail to start because Resend was down).

create or replace function public.events_notify_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token       text;
  v_base_url    text;
begin
  -- Vault may not be set up in local development; read defensively.
  begin
    v_token := vault.read_secret('internal_webhook_token');
    v_base_url := vault.read_secret('functions_base_url');
  exception when others then
    v_token := null;
    v_base_url := null;
  end;

  if v_base_url is null or v_token is null then
    -- Either operator setup hasn't run yet OR we're in a dev env
    -- without Vault. Skip silently — actual sending is best-effort.
    return NEW;
  end if;

  -- Live transition: status flipped to 'live' for the first time.
  if NEW.status = 'live'
     and (TG_OP = 'INSERT' or OLD.status is distinct from NEW.status)
     and NEW.live_notified_at is null then
    perform net.http_post(
      url := v_base_url || '/functions/v1/notify-event-live',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_token
      ),
      body := jsonb_build_object('event_id', NEW.id)
    );
  end if;

  -- Newly-scheduled event: status flipped to 'scheduled' for the
  -- first time (i.e. draft → scheduled, not scheduled → scheduled
  -- because of a title edit).
  if NEW.status = 'scheduled'
     and (TG_OP = 'INSERT' or OLD.status is distinct from NEW.status)
     and NEW.scheduled_notified_at is null then
    perform net.http_post(
      url := v_base_url || '/functions/v1/notify-new-scheduled-event',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_token
      ),
      body := jsonb_build_object('event_id', NEW.id)
    );
  end if;

  return NEW;
exception when others then
  raise warning 'events_notify_dispatch failed: %', sqlerrm;
  return NEW;
end;
$$;

drop trigger if exists events_notify on public.events;
create trigger events_notify
  after insert or update of status on public.events
  for each row execute function public.events_notify_dispatch();

notify pgrst, 'reload schema';
