-- LiveRush — drop the starter virtual balance from $1,000 to $100.
--
-- Rationale: with MAX_BET=$10 and DAILY_CAP=$100, a $1,000 seed gives
-- viewers a long runway before they ever feel the constraint. $100 is
-- one day of betting at the daily cap — enough to test the product
-- end-to-end but not a free piggy bank.
--
-- Touches:
--   1. `profiles.balance_cents` column default
--   2. `handle_new_user()` trigger that runs on auth.users insert
--   3. The welcome notification body text mirrors the new amount
--
-- Does NOT backfill existing balances — current users keep what they
-- have. Only fresh sign-ups land at $100.

-- 1) Column default
alter table public.profiles
  alter column balance_cents set default 10000;

-- 2) Trigger function — replace with $100 seed + updated welcome copy
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

  -- Seed 5 demo notifications so /notifications looks lively from minute
  -- one. event_id values must reference rows that exist in the events
  -- table — otherwise the FK rejects the insert and rolls back signup.
  insert into public.notifications (user_id, type, title, body, event_id, read, created_at) values
    (
      new.id, 'welcome',
      'Welcome to LiveRush ⚡',
      'You start with $100 virtual balance. Place your first bet on a live challenge!',
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

notify pgrst, 'reload schema';
