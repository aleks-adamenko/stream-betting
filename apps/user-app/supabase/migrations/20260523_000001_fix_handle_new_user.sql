-- Fix: handle_new_user() was inserting a welcome notification with
-- event_id = 'evt_spicy_ramen', which does not exist in the events seed.
-- The notifications.event_id FK then rejected the insert, the trigger
-- failed, and Supabase rolled back the auth.users row — every new
-- sign-up bubbled up "Database error saving new user".
--
-- This migration replaces the trigger with one that references only
-- event IDs that exist in 20260513_000002_seed.sql.

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
  values (new.id, v_display, 100000)
  on conflict (id) do nothing;

  -- Seed 5 demo notifications so /notifications looks lively from minute
  -- one. event_id values must reference rows that exist in the events
  -- table — otherwise the FK rejects the insert and rolls back signup.
  insert into public.notifications (user_id, type, title, body, event_id, read, created_at) values
    (
      new.id, 'welcome',
      'Welcome to LiveRush ⚡',
      'You start with $1,000 virtual balance. Place your first bet on a live challenge!',
      null, false, now()
    ),
    (
      new.id, 'event_starting',
      'Don''t Pop The Balloon goes live now',
      'The Smily Fam''s viral balloon-box challenge is streaming — jump in before the next round.',
      'evt_balloon_box', false, now() - interval '7 minutes'
    ),
    (
      new.id, 'bet_won',
      '+$48.00 — you won a side bet',
      'Round 2 of the Cup Switch challenge settled. Payout credited to your balance.',
      'evt_cup_switch', true, now() - interval '2 hours'
    ),
    (
      new.id, 'new_follower',
      'Vibe Queen is now in your Following',
      'See her latest blindfolded cup race and never miss a live drop.',
      'evt_blindfold_cup', false, now() - interval '5 hours'
    ),
    (
      new.id, 'event_starting',
      'Hot Sauce Roulette airs tomorrow',
      'Grandpa Ranks is bringing back the Carolina Reaper. Don''t miss it.',
      'evt_hot_sauce_roulette', true, now() - interval '1 day'
    );

  return new;
end;
$$;
