-- LiveRush — relax events.influencer_id NOT NULL so studio-published events
-- (which set creator_id instead) can be inserted.
--
-- Background: the original schema (20260513_000001_schema.sql) declared
-- `influencer_id` as NOT NULL because every seeded event came from the
-- legacy `influencers` table. Phase 6 (20260525_000001_creator_profiles.sql)
-- added `creator_id` pointing at `creator_profiles`, but left the NOT NULL
-- on `influencer_id`. As a result `create_event(...)` — which only sets
-- `creator_id` — fails with:
--
--   null value in column "influencer_id" of relation "events"
--   violates not-null constraint
--
-- After this migration each event must have *exactly one* of the two
-- columns set. Seeded rows still use `influencer_id`; studio rows use
-- `creator_id`. The user-app mapper already prefers creator over
-- influencer when both happen to be present, but the new check makes
-- "both set" impossible.

-- 1) Drop the NOT NULL on influencer_id.
alter table public.events
  alter column influencer_id drop not null;

-- 2) Enforce exactly-one-of via a check constraint. The XOR pattern:
--    (a IS NULL) <> (b IS NULL) is true only when exactly one is null,
--    i.e. exactly one of the two is set.
alter table public.events
  drop constraint if exists events_owner_xor_check;
alter table public.events
  add constraint events_owner_xor_check
  check (
    (influencer_id is null) <> (creator_id is null)
  );
