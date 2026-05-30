-- LiveRush — Phase 2 betting notification emails.
--
-- Hooks into the existing notification dispatch pattern from
-- 20260528_000001_notifications.sql. Where the v1 system fires Edge
-- Functions from an `events` status trigger, this migration adds:
--
--   • payouts.notified_at idempotency stamp + AFTER UPDATE trigger
--     that fires notify-payout on (pending → completed) and
--     (pending → rejected) transitions. Routes by payouts.type:
--       - winner       + completed → kind='credited' (viewer wins)
--       - rake_streamer+ completed → kind='rake'     (creator earnings)
--       - * (viewer|streamer) + rejected → kind='rejected'
--       - platform recipients → skipped (no email destination)
--
--   • events.cancelled_notified_at + AFTER UPDATE trigger that fires
--     notify-event-cancelled on the (* → cancelled) transition. That
--     edge function fans out one refund email per bet in a single
--     Resend batch.send() call — cheaper than firing N triggers from
--     the N refund-payout rows cancel_event creates inline.
--
--   • profiles.notifications_enabled_payouts — per-category toggle
--     surfaced as a second switch under the global one in the
--     user-app Profile page. Global notifications_enabled still
--     overrides (if global is off, no email regardless of category).
--
--   • set_payouts_notifications_enabled() RPC mirrors the existing
--     set_notifications_enabled() so the Profile toggle can write
--     without an open RLS policy on profiles.
--
-- Operator setup that must precede this migration: none. Reuses the
-- existing internal_webhook_token + functions_base_url Vault entries
-- and the RESEND_API_KEY / APP_URL secrets already configured for the
-- v1 notification system.

-- =========================================================================
-- 1) Idempotency stamps + per-category opt-out
-- =========================================================================

alter table public.payouts
  add column if not exists notified_at timestamptz;

alter table public.events
  add column if not exists cancelled_notified_at timestamptz;

alter table public.profiles
  add column if not exists notifications_enabled_payouts boolean
  not null default true;

-- Extend notifications.type to cover the new betting-email flows so
-- the email senders can also drop an in-app notification row. Old
-- types (welcome, bet_won, bet_lost, event_starting, new_follower,
-- top_up) stay valid; we add bet_refunded / rake_credited /
-- payout_rejected. Drop the old check + add the wider one rather than
-- ALTER ... ADD VALUE because the column is a text+CHECK (not a real
-- enum type).
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type in (
      'welcome', 'bet_won', 'bet_lost', 'event_starting',
      'new_follower', 'top_up',
      'bet_refunded', 'rake_credited', 'payout_rejected'
    )
  );

-- =========================================================================
-- 2) RPC: set_payouts_notifications_enabled
-- =========================================================================

create or replace function public.set_payouts_notifications_enabled(
  p_enabled boolean
)
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
  set notifications_enabled_payouts = p_enabled
  where id = v_user_id;
end;
$$;

grant execute on function public.set_payouts_notifications_enabled(boolean)
  to authenticated;

-- =========================================================================
-- 3) Trigger function: payouts_notify_dispatch
-- =========================================================================
--
-- Fires on AFTER UPDATE of `status`. Picks a `kind` based on the
-- destination state + payout type, then async-invokes notify-payout
-- via pg_net. Errors are swallowed so a notification dispatch failure
-- never rolls back the underlying approve/reject (we can't have an
-- approve_payout fail because Resend was down).
--
-- Idempotency: the edge function checks payouts.notified_at and the
-- viewer/creator's notifications_enabled* flags before sending, then
-- stamps notified_at on success. This trigger fires once per status
-- transition because approve_payout / reject_payout both early-return
-- on already-final statuses, so OLD.status is distinct from NEW.status
-- only the first time around.

create or replace function public.payouts_notify_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_token    text;
  v_base_url text;
  v_kind     text;
begin
  -- Route by type + destination state. Platform-recipient payouts
  -- (rake_platform, residual) have no email destination — skip.
  if NEW.recipient_kind = 'platform' or NEW.recipient_id is null then
    return NEW;
  end if;

  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  if NEW.status = 'completed' and NEW.type = 'winner' then
    v_kind := 'credited';
  elsif NEW.status = 'completed' and NEW.type = 'rake_streamer' then
    v_kind := 'rake';
  elsif NEW.status = 'rejected' then
    v_kind := 'rejected';
  else
    -- Includes refund payouts (those are INSERTed with status='completed'
    -- so the trigger doesn't fire at all — refund emails go via the
    -- events_cancel_notify_dispatch fan-out instead), plus
    -- rake_platform / residual completions and any intermediate
    -- state changes we don't notify on.
    return NEW;
  end if;

  -- Skip if already-dispatched (defensive — should never hit due to
  -- the OLD/NEW guard above).
  if NEW.notified_at is not null then
    return NEW;
  end if;

  -- Pull Vault secrets defensively so a not-yet-configured dev env
  -- doesn't error out the underlying approve_payout / reject_payout.
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

  perform net.http_post(
    url := v_base_url || '/functions/v1/notify-payout',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body := jsonb_build_object(
      'kind', v_kind,
      'payout_id', NEW.id
    )
  );

  return NEW;
exception when others then
  raise warning 'payouts_notify_dispatch failed: %', sqlerrm;
  return NEW;
end;
$$;

drop trigger if exists payouts_notify on public.payouts;
create trigger payouts_notify
  after update of status on public.payouts
  for each row execute function public.payouts_notify_dispatch();

-- =========================================================================
-- 4) Trigger function: events_cancel_notify_dispatch
-- =========================================================================
--
-- Refund fan-out for cancelled events. One trigger fire → one Edge
-- Function call → one Resend `batch.send()` with N emails inside.
-- Cheaper than N triggers firing on N refund-payout rows that
-- cancel_event inserts inline (those rows are INSERTed with
-- status='completed', so payouts_notify_dispatch above doesn't even
-- see them — by design).

create or replace function public.events_cancel_notify_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_token    text;
  v_base_url text;
begin
  if NEW.status <> 'cancelled' then
    return NEW;
  end if;
  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;
  if NEW.cancelled_notified_at is not null then
    return NEW;
  end if;

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

  perform net.http_post(
    url := v_base_url || '/functions/v1/notify-event-cancelled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body := jsonb_build_object('event_id', NEW.id)
  );

  return NEW;
exception when others then
  raise warning 'events_cancel_notify_dispatch failed: %', sqlerrm;
  return NEW;
end;
$$;

drop trigger if exists events_cancel_notify on public.events;
create trigger events_cancel_notify
  after update of status on public.events
  for each row execute function public.events_cancel_notify_dispatch();

notify pgrst, 'reload schema';
