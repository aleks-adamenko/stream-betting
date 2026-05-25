-- LiveRush — Phase 5: profiles + bets + auth trigger + place_bet RPC

-- =========================================================================
-- Tables
-- =========================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'influencer', 'super_admin')),
  display_name text,
  avatar_url text,
  balance_cents integer not null default 100000 check (balance_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id text not null references public.events(id) on delete cascade,
  outcome_id text not null references public.event_outcomes(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  odds_decimal numeric(6, 2) not null check (odds_decimal > 1),
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'refunded')),
  payout_cents integer,
  placed_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists bets_user_idx on public.bets(user_id, placed_at desc);
create index if not exists bets_event_idx on public.bets(event_id);
create index if not exists bets_status_idx on public.bets(status);

-- =========================================================================
-- Triggers
-- =========================================================================

-- Auto-update profiles.updated_at on row update
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create profile when a new auth.users row is inserted
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, balance_cents)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    ),
    100000  -- $1,000 starter virtual balance
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- RPC: place_bet (atomic balance check + deduct + bet insert)
-- =========================================================================

create or replace function public.place_bet(
  p_event_id text,
  p_outcome_id text,
  p_amount_cents integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_balance integer;
  v_odds numeric(6, 2);
  v_event_status text;
  v_bet_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'Stake must be positive' using errcode = '22023';
  end if;

  -- Verify outcome belongs to event + event is live; fetch odds
  select e.status, o.odds into v_event_status, v_odds
  from public.events e
  join public.event_outcomes o on o.event_id = e.id
  where e.id = p_event_id
    and o.id = p_outcome_id;

  if v_event_status is null then
    raise exception 'Invalid event or outcome' using errcode = '23503';
  end if;

  if v_event_status <> 'live' then
    raise exception 'Event is not live' using errcode = '22023';
  end if;

  -- Lock the row and check balance
  select balance_cents into v_balance
  from public.profiles
  where id = v_user_id
  for update;

  if v_balance is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_balance < p_amount_cents then
    raise exception 'Insufficient balance' using errcode = '22023';
  end if;

  -- Atomically deduct and insert bet
  update public.profiles
  set balance_cents = balance_cents - p_amount_cents
  where id = v_user_id;

  insert into public.bets (user_id, event_id, outcome_id, amount_cents, odds_decimal)
  values (v_user_id, p_event_id, p_outcome_id, p_amount_cents, v_odds)
  returning id into v_bet_id;

  return json_build_object(
    'bet_id', v_bet_id,
    'new_balance_cents', v_balance - p_amount_cents,
    'odds', v_odds
  );
end;
$$;

grant execute on function public.place_bet(text, text, integer) to authenticated;

-- =========================================================================
-- Row Level Security
-- =========================================================================

alter table public.profiles enable row level security;
alter table public.bets enable row level security;

-- profiles: users can read/update only their own row
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- bets: users read only their own bets; writes go through RPC only
drop policy if exists "Users read own bets" on public.bets;
create policy "Users read own bets"
  on public.bets
  for select
  to authenticated
  using (auth.uid() = user_id);
