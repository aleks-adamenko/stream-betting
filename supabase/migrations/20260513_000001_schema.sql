-- LiveRush — Phase 4 schema
-- Public read-only catalog of creators (influencers), events, and bet outcomes.
-- Auth + bets persistence land in Phase 5+.

-- =========================================================================
-- Tables
-- =========================================================================

create table if not exists public.influencers (
  id text primary key,
  handle text not null unique,
  display_name text not null,
  avatar_url text,
  followers integer not null default 0 check (followers >= 0),
  socials jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id text primary key,
  influencer_id text not null references public.influencers(id) on delete cascade,
  title text not null,
  description text,
  cover_url text,
  category text not null,
  rules text,
  round_format text not null check (round_format in ('time', 'event')),
  round_duration_sec integer check (round_duration_sec is null or round_duration_sec > 0),
  status text not null check (status in ('scheduled', 'live', 'finished')),
  scheduled_at timestamptz not null,
  started_at timestamptz,
  viewers_count integer not null default 0 check (viewers_count >= 0),
  total_pool numeric(12, 2) not null default 0 check (total_pool >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.event_outcomes (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  label text not null,
  odds numeric(6, 2) not null check (odds > 1),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- Indexes
-- =========================================================================

create index if not exists events_status_idx on public.events(status);
create index if not exists events_influencer_idx on public.events(influencer_id);
create index if not exists events_scheduled_at_idx on public.events(scheduled_at);
create index if not exists event_outcomes_event_idx on public.event_outcomes(event_id, sort_order);

-- =========================================================================
-- Row Level Security
-- =========================================================================

alter table public.influencers enable row level security;
alter table public.events enable row level security;
alter table public.event_outcomes enable row level security;

-- Public catalog: anyone can read.
drop policy if exists "Public read access" on public.influencers;
create policy "Public read access"
  on public.influencers
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read access" on public.events;
create policy "Public read access"
  on public.events
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read access" on public.event_outcomes;
create policy "Public read access"
  on public.event_outcomes
  for select
  to anon, authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policies in Phase 4 → all writes blocked for anon/authenticated.
-- Writes can still happen via service_role (used by admin tools / future studio).
