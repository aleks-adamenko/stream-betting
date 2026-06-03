-- LiveRush — sweep the demo seed notifications.
--
-- handle_new_user used to drop 5 rows in `notifications` on signup so
-- /notifications looked lively for fresh accounts: a real welcome
-- message + four hard-coded mocks (Don't Pop The Balloon goes live,
-- "+$48.00 — you won a side bet", Vibe Queen new-follower, Hot Sauce
-- Roulette). Now that the real betting / event-starting / payout
-- pipelines fire genuine notifications via the Phase 1/2 triggers
-- and edge functions, the mocks are noise — they reference events
-- the user never bet on and earnings they never earned. Trim them.
--
-- Two changes:
--   1) Replace handle_new_user with a version that seeds ONLY the
--      welcome row. Future signups won't get the four fake rows.
--   2) Backfill: delete the four mock rows for any users who
--      already received them. Matched by (type, event_id, title)
--      so a legitimate notification of the same type can't get
--      hit by accident — the mocks always carried these exact
--      event_id + title pairs.
--
-- The welcome body still contains "$100" — the user-app's
-- Notifications page parses any "$<amount>" pattern at render time
-- and substitutes the rush-coin glyph, so we don't need to rewrite
-- existing data to flip the visual.

-- =========================================================================
-- 1) handle_new_user — seed only the welcome notification
-- =========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display text;
begin
  v_display := coalesce(
    new.raw_user_meta_data->>'display_name',
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, display_name, balance_cents)
  values (new.id, v_display, 10000)
  on conflict (id) do nothing;

  -- Single seed notification — the welcome message. Body mentions
  -- the starter balance; the client renders `$100` with the
  -- rush-coin glyph. The four demo rows that used to land here
  -- have been removed; real notifications now come from the
  -- betting / event-starting / payout pipelines.
  insert into public.notifications (user_id, type, title, body, event_id, read, created_at) values
    (
      new.id, 'welcome',
      'Welcome to LiveRush ⚡',
      'You start with $100 virtual balance. Place your first bet on a live challenge!',
      null, false, now()
    );

  return new;
end;
$$;

-- =========================================================================
-- 2) Backfill — delete the 4 demo rows from existing users
-- =========================================================================
-- Matched on (type, event_id, title). Anyone who happens to have a
-- real notification of the same type but a different event_id /
-- title stays untouched.

delete from public.notifications
where (type = 'event_starting' and event_id = 'evt_balloon_box'
       and title = 'Don''t Pop The Balloon goes live now')
   or (type = 'bet_won'        and event_id in ('evt_cup_switch', 'evt_spicy_ramen')
       and title = '+$48.00 — you won a side bet')
   or (type = 'new_follower'   and event_id = 'evt_blindfold_cup'
       and title = 'Vibe Queen is now in your Following')
   or (type = 'event_starting' and event_id = 'evt_hot_sauce_roulette'
       and title = 'Hot Sauce Roulette airs tomorrow');

notify pgrst, 'reload schema';
