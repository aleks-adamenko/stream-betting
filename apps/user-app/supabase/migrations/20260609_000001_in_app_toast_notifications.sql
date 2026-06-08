-- LiveRush — in-app toast notification triggers + realtime publication.
--
-- This migration powers the global top-centre toast layer in the
-- user-app (see apps/user-app/src/contexts/NotificationsContext.tsx).
-- The client opens one Realtime channel filtered by
-- `user_id = auth.uid()` against `public.notifications` and renders
-- a custom card for every new row.
--
-- We drive that with database triggers instead of rewriting every
-- RPC (place_bet, settle_round, refund_round, advance_round,
-- mark_final_round, finish_event). Triggers stay independent of
-- the business-logic functions, they're guaranteed to fire whenever
-- the underlying row changes (cron-triggered refunds, admin manual
-- fixes, RPC paths all covered), and a future RPC rewrite doesn't
-- silently break notifications.
--
-- New notification types added by this migration:
--   • bet_placed       — persistent, fires on bets INSERT
--   • event_finished   — ephemeral (filtered out of /notifications page,
--                        but the row exists so realtime fan-out works)
--   • round_starting   — ephemeral, same filter logic
--
-- Existing types reused:
--   • bet_won / bet_lost / bet_refunded — were valid in the type
--     CHECK already; now actually inserted by the bets status trigger.
--   • event_starting — already inserted by the notify-event-live
--     edge function (subscribers + creator followers); no change.

-- =========================================================================
-- 1) Realtime publication
-- =========================================================================
-- Add notifications to the supabase_realtime publication so the
-- user-app's NotificationsProvider can subscribe to INSERTs. RLS on
-- the table is already `auth.uid() = user_id`, which Realtime
-- respects for postgres_changes — the firehose is implicitly
-- scoped to the signed-in viewer.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- =========================================================================
-- 2) Broaden the notification type CHECK
-- =========================================================================
-- Existing types preserved verbatim. Add bet_placed, event_finished,
-- round_starting.

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
      'payout_rejected'
    )
  );

-- =========================================================================
-- 3) bets AFTER INSERT — bet_placed
-- =========================================================================
-- Title carries the event title. Body uses the
-- "FM999990.00" mask so renderWithCoins picks the amount up via its
-- regex (\b\d{1,3}(?:,\d{3})*\.\d{1,2}\b — needs two decimal digits).
-- Exception-safe: a failure inside the trigger must never roll back
-- the bet insert.

create or replace function public.notify_bet_placed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_title   text;
  v_outcome_label text;
  v_amount_label  text;
begin
  select title  into v_event_title   from public.events         where id = NEW.event_id;
  select label  into v_outcome_label from public.event_outcomes where id = NEW.outcome_id;
  v_amount_label := to_char(NEW.amount_cents / 100.0, 'FM999990.00');

  insert into public.notifications (user_id, type, title, body, event_id)
  values (
    NEW.user_id,
    'bet_placed',
    coalesce(v_event_title, 'Bet placed'),
    format('You bet %s on "%s"', v_amount_label, coalesce(v_outcome_label, 'outcome')),
    NEW.event_id
  );

  return NEW;
exception when others then
  raise warning 'notify_bet_placed failed: %', sqlerrm;
  return NEW;
end;
$$;

drop trigger if exists bets_notify_placed on public.bets;
create trigger bets_notify_placed
  after insert on public.bets
  for each row execute function public.notify_bet_placed();

-- =========================================================================
-- 4) bets AFTER UPDATE OF status — bet_won / bet_lost / bet_refunded
-- =========================================================================
-- Three branches keyed by the destination status. Guards on
-- (NEW.status <> OLD.status) and on the FROM-status so we don't
-- re-notify on harmless intermediate moves (e.g. 'won_pending_payout'
-- → 'won' when the admin approves the payout — that's a second
-- transition we explicitly suppress to avoid a "you won" toast
-- duplicated).
--
-- Body amount uses payout_cents when available (the winning amount
-- post-rake / odds cap), else falls back to the original stake.

create or replace function public.notify_bet_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_title  text;
  v_notif_type   text;
  v_body         text;
  v_amount_cents bigint;
  v_amount_label text;
begin
  if NEW.status is not distinct from OLD.status then
    return NEW;
  end if;

  if NEW.status in ('won_pending_payout', 'won') then
    -- Skip if we'd already inserted a bet_won row for the earlier
    -- transition (placed → won_pending_payout). Only the first
    -- transition into a "won" family of statuses should toast.
    if OLD.status in ('won_pending_payout', 'won') then
      return NEW;
    end if;
    v_notif_type   := 'bet_won';
    v_amount_cents := coalesce(NEW.payout_cents, NEW.amount_cents);
    v_amount_label := to_char(v_amount_cents / 100.0, 'FM999990.00');
    v_body         := format('You won %s coins', v_amount_label);

  elsif NEW.status = 'lost' then
    if OLD.status = 'lost' then return NEW; end if;
    v_notif_type   := 'bet_lost';
    v_amount_label := to_char(NEW.amount_cents / 100.0, 'FM999990.00');
    v_body         := format('You lost %s coins on this bet', v_amount_label);

  elsif NEW.status = 'refunded' then
    if OLD.status = 'refunded' then return NEW; end if;
    v_notif_type   := 'bet_refunded';
    v_amount_label := to_char(NEW.amount_cents / 100.0, 'FM999990.00');
    v_body         := format('Refunded %s coins — round minimums not met or event cancelled', v_amount_label);

  else
    return NEW;
  end if;

  select title into v_event_title from public.events where id = NEW.event_id;

  insert into public.notifications (user_id, type, title, body, event_id)
  values (
    NEW.user_id,
    v_notif_type,
    coalesce(v_event_title, 'Bet update'),
    v_body,
    NEW.event_id
  );

  return NEW;
exception when others then
  raise warning 'notify_bet_status_change failed: %', sqlerrm;
  return NEW;
end;
$$;

drop trigger if exists bets_notify_status on public.bets;
create trigger bets_notify_status
  after update of status on public.bets
  for each row execute function public.notify_bet_status_change();

-- =========================================================================
-- 5) events AFTER UPDATE OF status — event_finished
-- =========================================================================
-- Fires once per user who had at least one bet in any round of the
-- event. Distinct on user_id so a viewer who bet in three rounds
-- still gets a single "Stream ended" toast.

create or replace function public.notify_event_finished()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  if NEW.status not in ('finished', 'settled') then return NEW; end if;
  if OLD.status in ('finished', 'settled') then return NEW; end if;

  insert into public.notifications (user_id, type, title, body, event_id)
  select distinct b.user_id, 'event_finished', NEW.title, 'Stream ended', NEW.id
  from public.bets b
  where b.event_id = NEW.id;

  return NEW;
exception when others then
  raise warning 'notify_event_finished failed: %', sqlerrm;
  return NEW;
end;
$$;

drop trigger if exists events_notify_finished on public.events;
create trigger events_notify_finished
  after update of status on public.events
  for each row execute function public.notify_event_finished();

-- =========================================================================
-- 6) events AFTER UPDATE OF current_round — round_starting
-- =========================================================================
-- Insert one row per distinct user who had a bet in any prior round
-- of this event. mark_final_round also bumps current_round (per the
-- 20260608_000005 migration) so this single trigger covers both
-- Next round and Final round paths. Label flips based on
-- is_final_round at the new value.

create or replace function public.notify_round_started()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round_label text;
begin
  if NEW.current_round is null or OLD.current_round is null then return NEW; end if;
  if NEW.current_round <= OLD.current_round then return NEW; end if;

  v_round_label := case
    when NEW.is_final_round then 'Final round starting — place your bets'
    else format('Round %s starting — place your bets', NEW.current_round)
  end;

  insert into public.notifications (user_id, type, title, body, event_id)
  select distinct b.user_id, 'round_starting', NEW.title, v_round_label, NEW.id
  from public.bets b
  where b.event_id = NEW.id
    and b.round_index <= OLD.current_round;

  return NEW;
exception when others then
  raise warning 'notify_round_started failed: %', sqlerrm;
  return NEW;
end;
$$;

drop trigger if exists events_notify_round on public.events;
create trigger events_notify_round
  after update of current_round on public.events
  for each row execute function public.notify_round_started();

notify pgrst, 'reload schema';
