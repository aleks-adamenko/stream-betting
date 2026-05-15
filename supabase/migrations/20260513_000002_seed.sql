-- LiveRush — Phase 4 seed
-- 8 creators, 8 challenge events, all bet outcomes.
-- Timestamps relative to now() so data stays "fresh" whenever seed runs.

-- =========================================================================
-- Influencers
-- =========================================================================

insert into public.influencers (id, handle, display_name, avatar_url, followers, socials) values
  ('inf_vibe', '@vibe.queen778', 'Vibe Queen',
    'https://images.unsplash.com/photo-1517022812141-23620dba5c23?auto=format&fit=crop&w=200&q=80',
    1482000,
    '{"tiktok": "https://tiktok.com/", "instagram": "https://instagram.com/"}'::jsonb),
  ('inf_smily', '@thesmilyfam', 'The Smily Fam',
    'https://images.unsplash.com/photo-1542596594-649edbc13630?auto=format&fit=crop&w=200&q=80',
    2310000,
    '{"youtube": "https://youtube.com/", "instagram": "https://instagram.com/"}'::jsonb),
  ('inf_mochi', '@midnight.mochi', 'Midnight Mochi',
    'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=200&q=80',
    612000,
    '{"tiktok": "https://tiktok.com/"}'::jsonb),
  ('inf_angelo', '@_angelomaras', 'Angelo Maras',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
    894000,
    '{"tiktok": "https://tiktok.com/", "x": "https://x.com/"}'::jsonb),
  ('inf_stunt', '@stunt.boys.live', 'Stunt Boys',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80',
    1120000,
    '{"youtube": "https://youtube.com/", "instagram": "https://instagram.com/"}'::jsonb),
  ('inf_daily', '@daily.dares', 'Daily Dares',
    'https://images.unsplash.com/photo-1488161628813-04466f872be2?auto=format&fit=crop&w=200&q=80',
    438000,
    '{"tiktok": "https://tiktok.com/", "instagram": "https://instagram.com/"}'::jsonb),
  ('inf_kim', '@kim.tries', 'Kim Tries',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
    281000,
    '{"instagram": "https://instagram.com/"}'::jsonb),
  ('inf_grandpa', '@grandpa.ranks', 'Grandpa Ranks',
    'https://images.unsplash.com/photo-1559548331-f9cb98001426?auto=format&fit=crop&w=200&q=80',
    706000,
    '{"tiktok": "https://tiktok.com/", "youtube": "https://youtube.com/"}'::jsonb)
on conflict (id) do nothing;

-- =========================================================================
-- Events
-- =========================================================================

insert into public.events
  (id, influencer_id, title, description, cover_url, video_url, category, rules,
   round_format, round_duration_sec, status, scheduled_at, started_at, viewers_count, total_pool)
values
  ('evt_blindfold_cup', 'inf_vibe',
    'Blindfold Dirty Water Dodge Challenge',
    'Three blindfolded players. One swinging dirty water bag. Stand, sit, dodge — and try not to get soaked.',
    '/covers/03-challenge-blinded-water.jpg',
    'https://www.instagram.com/reels/DMVGMICNei7/',
    'Challenges',
    'Three players sit in a line while blindfolded. A host swings a heavy dirty water bag above and across the players. Players must repeatedly stand up and sit down on command while avoiding the swinging bag. Getting hit by the bag or splashed with dirty water counts as elimination. The last player staying dry wins the challenge. If all players get hit in the same round, the round ends with no winner.',
    'event', null, 'live',
    now() - interval '22 minutes', now() - interval '22 minutes', 14280, 38420),

  ('evt_balloon_box', 'inf_smily',
    'Don''t Pop The Balloon Challenge 🎈',
    'Twelve balloons crammed in a box. Pull the strings, dodge the pop, only one survivor in this round.',
    '/covers/01-challenge-balloons.jpg',
    null,
    'Challenges',
    'Players take turns pulling one string per round. If the balloon pops, that player is out. Last player standing without popping a balloon wins the round.',
    'event', null, 'live',
    now() - interval '8 minutes', now() - interval '8 minutes', 42106, 92640),

  ('evt_cup_switch', 'inf_mochi',
    'DON''T PICK THE WRONG CUP 😭',
    'One tiny dice. Nine fake cups. Pure chaos. Somebody''s getting exposed this round 💀',
    '/covers/07-challenge-cups.jpg',
    'https://www.instagram.com/reels/DNlL1ThMshW/',
    'Challenges',
    E'Three creators enter the Cup Switch arena.\nOne dice is secretly hidden under a random cup before each round.\nPlayers shuffle, fake, bluff, and confuse each other before making a final pick.\nChoose the wrong cup and you''re OUT instantly.\nEvery round gets faster, louder, and more chaotic.\nLast player standing takes the win 🏆',
    'event', null, 'live',
    now() - interval '4 minutes', now() - interval '4 minutes', 7842, 19310),

  ('evt_match_cups', 'inf_angelo',
    'Match The Cups… Win The Cash 💸',
    E'He mixed the cups FAST 😳\nGuess which hidden colors match the top row and grab the cash under every correct pick. One wrong read and you leave broke 💀',
    '/covers/08-challenge-money-cups.jpg',
    'https://www.instagram.com/reels/DJf9CQjNUSx/',
    'Challenges',
    E'Hidden colored cups are placed under the platform.\nPlayer must match the top cups to the correct hidden cup positions.\nEvery correct match unlocks the cash placed above that cup.\nMore correct guesses = bigger payout.\nPerfect match clears the whole board jackpot 🔥',
    'event', null, 'live',
    now() - interval '12 minutes', now() - interval '12 minutes', 8420, 26780),

  ('evt_egg_drop', 'inf_stunt',
    'Dropped an egg from the 4th floor… yolk is praying 🥚',
    'Three engineering hopefuls. Three containers. Will the yolk survive a four-story drop?',
    '/covers/02-challenge-eggs-drop.jpg',
    null,
    'Challenges',
    'Each contestant builds a protective container with the same kit. Drop from the 4th floor balcony. Winner: egg intact + smallest container by volume.',
    'event', null, 'scheduled',
    now() + interval '21 hours', null, 0, 0),

  ('evt_whisper_chain', 'inf_daily',
    '7 strangers, 1 sentence, absolute chaos 🎧',
    'Seven strangers, headphones on white noise, one sentence travels the line. What comes out the other side?',
    '/covers/05-challenge-one-sentence.jpg',
    null,
    'Challenges',
    'Phrase passed through 7 people wearing noise-cancelling headphones. Round winner: closest end-of-chain reproduction to the original phrase, judged by audience vote.',
    'event', null, 'scheduled',
    now() + interval '2 days', null, 0, 0),

  ('evt_card_tower', 'inf_kim',
    '90 seconds to build the tallest card tower ⏱️',
    'Two builders. 90 seconds. Tallest free-standing card tower takes the round.',
    '/covers/06-challenge-cards-tower.jpg',
    null,
    'Challenges',
    'Each builder has 90 seconds and a fresh deck. Tower must stand on its own for 5 seconds after the timer. Tallest wins. Collapse = forfeit.',
    'time', 90, 'finished',
    now() - interval '1 day', null, 0, 12840),

  ('evt_hot_sauce_roulette', 'inf_grandpa',
    'One of these wings has Carolina Reaper… good luck 🔥',
    'Six identical wings. One is dipped in the world''s hottest sauce. Pick one. Smile.',
    'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=900&q=80',
    null,
    'Challenges',
    'Six wings on a plate. One brushed with Carolina Reaper extract. Players take turns picking and eating one wing without sniffing. Player who gets the spicy wing loses.',
    'event', null, 'finished',
    now() - interval '5 days', null, 0, 27490)
on conflict (id) do nothing;

-- =========================================================================
-- Event outcomes (globally unique ids = event_id + '_o' + index)
-- =========================================================================

insert into public.event_outcomes (id, event_id, label, odds, sort_order) values
  ('evt_blindfold_cup_o1', 'evt_blindfold_cup', 'Player 1 wins the challenge', 2.20, 0),
  ('evt_blindfold_cup_o2', 'evt_blindfold_cup', 'Player 2 wins the challenge', 2.40, 1),
  ('evt_blindfold_cup_o3', 'evt_blindfold_cup', 'Player 3 wins the challenge', 2.60, 2),
  ('evt_blindfold_cup_o4', 'evt_blindfold_cup', 'All players get soaked', 5.50, 3),
  ('evt_blindfold_cup_o5', 'evt_blindfold_cup', 'No one survives Round 1', 7.50, 4),
  ('evt_blindfold_cup_o6', 'evt_blindfold_cup', 'Final round reaches sudden death', 4.00, 5),
  ('evt_blindfold_cup_o7', 'evt_blindfold_cup', 'The bag bursts before the winner is decided', 12.00, 6),

  ('evt_balloon_box_o1', 'evt_balloon_box', 'Leo survives', 2.40, 0),
  ('evt_balloon_box_o2', 'evt_balloon_box', 'Sara survives', 2.20, 1),
  ('evt_balloon_box_o3', 'evt_balloon_box', 'Mike survives', 3.00, 2),
  ('evt_balloon_box_o4', 'evt_balloon_box', 'Box empties first', 12.00, 3),

  ('evt_cup_switch_o1', 'evt_cup_switch', 'Green cups survive this round', 2.10, 0),
  ('evt_cup_switch_o2', 'evt_cup_switch', 'Red cups survive this round', 2.30, 1),
  ('evt_cup_switch_o3', 'evt_cup_switch', 'Blue cups survive this round', 2.50, 2),
  ('evt_cup_switch_o4', 'evt_cup_switch', 'First player to choke 😭', 3.20, 3),
  ('evt_cup_switch_o5', 'evt_cup_switch', 'Dice gets revealed instantly', 5.50, 4),
  ('evt_cup_switch_o6', 'evt_cup_switch', 'Someone gets eliminated this round', 1.80, 5),
  ('evt_cup_switch_o7', 'evt_cup_switch', 'Final round goes crazy', 2.80, 6),
  ('evt_cup_switch_o8', 'evt_cup_switch', 'Last player standing wins the challenge', 2.00, 7),

  ('evt_match_cups_o1', 'evt_match_cups', 'Pink cup is matched correctly', 2.10, 0),
  ('evt_match_cups_o2', 'evt_match_cups', 'Orange cup is matched correctly', 2.30, 1),
  ('evt_match_cups_o3', 'evt_match_cups', 'Player gets at least 1 correct match', 1.60, 2),
  ('evt_match_cups_o4', 'evt_match_cups', 'Player gets 3+ correct matches', 2.80, 3),
  ('evt_match_cups_o5', 'evt_match_cups', 'Player clears all cups perfectly', 6.50, 4),
  ('evt_match_cups_o6', 'evt_match_cups', 'Total payout over $300', 2.40, 5),
  ('evt_match_cups_o7', 'evt_match_cups', 'Total payout under $300', 1.85, 6),
  ('evt_match_cups_o8', 'evt_match_cups', 'Player fumbles the whole board 💀', 5.00, 7),

  ('evt_egg_drop_o1', 'evt_egg_drop', 'Red container survives', 1.90, 0),
  ('evt_egg_drop_o2', 'evt_egg_drop', 'Blue container survives', 2.30, 1),
  ('evt_egg_drop_o3', 'evt_egg_drop', 'Green container survives', 2.10, 2),
  ('evt_egg_drop_o4', 'evt_egg_drop', 'All three crack', 5.50, 3),

  ('evt_whisper_chain_o1', 'evt_whisper_chain', 'Phrase survives ≥80%', 4.80, 0),
  ('evt_whisper_chain_o2', 'evt_whisper_chain', 'Phrase 40-79% intact', 2.10, 1),
  ('evt_whisper_chain_o3', 'evt_whisper_chain', 'Phrase <40%', 1.70, 2),

  ('evt_card_tower_o1', 'evt_card_tower', 'Kim wins', 1.80, 0),
  ('evt_card_tower_o2', 'evt_card_tower', 'Ravi wins', 2.00, 1),
  ('evt_card_tower_o3', 'evt_card_tower', 'Both collapse', 5.00, 2),

  ('evt_hot_sauce_roulette_o1', 'evt_hot_sauce_roulette', 'Pat gets the wing', 2.40, 0),
  ('evt_hot_sauce_roulette_o2', 'evt_hot_sauce_roulette', 'Lina gets the wing', 2.40, 1),
  ('evt_hot_sauce_roulette_o3', 'evt_hot_sauce_roulette', 'Marc gets the wing', 2.40, 2)
on conflict (id) do nothing;
