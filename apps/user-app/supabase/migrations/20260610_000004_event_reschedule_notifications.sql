-- =========================================================================
-- 20260610_000004 — Event reschedule notifications
-- =========================================================================
--
-- When a creator edits an already-published (scheduled) event and saves a
-- new `scheduled_at`, we send a second email to anyone who subscribed to
-- that event (event_subscribers ∪ creator_followers minus the creator),
-- mirroring the recipient set used by `notify-event-live`. Same
-- in-app toast pipeline as the existing event lifecycle triggers.
--
-- Touches three places:
--
-- 1. `events.reschedule_email_sent_for_at` — new column that records the
--    `scheduled_at` value we last emailed about. The edge function
--    short-circuits when it equals the current `scheduled_at` so a
--    no-op save (focus + blur, identical value) doesn't re-fire. If the
--    creator legitimately changes the date a second time, the column
--    value lags and the new email fires.
--
-- 2. `notifications.type` CHECK — adds 'event_rescheduled' so the
--    companion in-app toast row passes validation.
--
-- 3. `events_notify_dispatch` — adds a third branch alongside the
--    existing 'live' / 'scheduled' branches. Guard set:
--        • OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at
--        • NEW.status = 'scheduled'  (don't email about drafts or live)
--        • OLD.scheduled_notified_at IS NOT NULL  (initial "scheduled"
--          email already went out; this is a real reschedule)
--        • NEW.archived_at IS NULL  (don't notify on archived events)
--    Idempotency lives in the edge function (compares
--    reschedule_email_sent_for_at to NEW.scheduled_at).
--
-- Operator setup is unchanged — same internal_webhook_token + functions_base_url
-- in Vault, same Resend config. After deploying the new edge function +
-- running this migration, reschedules start firing automatically.

-- -------------------------------------------------------------------------
-- 1) Column: events.reschedule_email_sent_for_at
-- -------------------------------------------------------------------------

alter table public.events
  add column if not exists reschedule_email_sent_for_at timestamptz;

comment on column public.events.reschedule_email_sent_for_at is
  'Last value of scheduled_at that the reschedule email was sent for. '
  'When equal to current scheduled_at the edge function skips — covers '
  'no-op saves where the creator opens + closes the editor without '
  'actually changing the date. Set by notify-event-rescheduled.';

-- -------------------------------------------------------------------------
-- 2) Extend notifications.type CHECK
-- -------------------------------------------------------------------------

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type in (
      'welcome',
      'new_follower',
      'top_up',
      'event_starting',
      'event_finished',
      'bet_placed',
      'bet_won',
      'bet_lost',
      'bet_refunded',
      'round_starting',
      'rake_credited',
      'payout_rejected',
      'event_rescheduled'
    )
  );

-- -------------------------------------------------------------------------
-- 3) Extend events_notify_dispatch
-- -------------------------------------------------------------------------
--
-- Whole function replaced (rather than ALTER) because Postgres trigger
-- functions are atomic — we want both the new branch + the existing
-- 'live'/'scheduled' branches deployed atomically. Behaviour for the
-- two existing branches is byte-identical to 20260528_000001's version.

create or replace function public.events_notify_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_token       text;
  v_base_url    text;
begin
  begin
    select decrypted_secret into v_token
    from vault.decrypted_secrets
    where name = 'internal_webhook_token';

    select decrypted_secret into v_base_url
    from vault.decrypted_secrets
    where name = 'functions_base_url';
  exception when others then
    v_token := null;
    v_base_url := null;
  end;

  if v_base_url is null or v_token is null then
    return NEW;
  end if;

  -- Live transition (unchanged).
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

  -- Newly-scheduled event (unchanged).
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

  -- NEW: reschedule of an already-announced event. The creator opened
  -- the editor on a 'scheduled' event and changed the start time. We
  -- need OLD here so this branch only triggers on UPDATE, never INSERT.
  if TG_OP = 'UPDATE'
     and NEW.status = 'scheduled'
     and NEW.archived_at is null
     and OLD.scheduled_at is distinct from NEW.scheduled_at
     and OLD.scheduled_notified_at is not null then
    perform net.http_post(
      url := v_base_url || '/functions/v1/notify-event-rescheduled',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_token
      ),
      body := jsonb_build_object(
        'event_id', NEW.id,
        -- Forwarding the previous timestamp lets the edge function
        -- render an "old → new" comparison in the email body without
        -- having to keep its own history table.
        'previous_scheduled_at', OLD.scheduled_at
      )
    );
  end if;

  return NEW;
exception when others then
  raise warning 'events_notify_dispatch failed: %', sqlerrm;
  return NEW;
end;
$$;

-- Trigger ALREADY covers UPDATE OF status (from 20260528_000001). We need
-- the same trigger to also fire on scheduled_at changes, so re-declare
-- it with the union column list. AFTER UPDATE OF (col_a, col_b) fires
-- when EITHER column changes — exactly what we want.

drop trigger if exists events_notify on public.events;
create trigger events_notify
  after insert or update of status, scheduled_at on public.events
  for each row execute function public.events_notify_dispatch();

notify pgrst, 'reload schema';
