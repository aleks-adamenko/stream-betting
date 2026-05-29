-- LiveRush — Betting Logic MVP, Phase 1 (single-round end-to-end)
--
-- Replaces the fixed-odds place_bet with a pari-mutuel model:
--   * Streamers set outcome labels only (no static odds)
--   * Each bet feeds a per-outcome pool (event_outcomes.pool_cents)
--   * Live odds are computed as (total_pool × (1 - rake) / outcome_pool)
--   * Settlement creates pending payouts that a moderator approves
--   * Every money mutation writes hash-chained ledger_entries rows
--   * place_bet / settle / approve / reject are idempotent on a UUID key
--
-- All amounts are virtual for now — `profiles.balance_cents` is seeded
-- with $1000 on signup. When we swap to real money the only change is
-- the "credit balance" branch in approve_payout — everything else
-- (pools, ledger, payouts, idempotency) stays as-is.
--
-- Phase 1 scope explicitly EXCLUDES:
--   * Multi-round (event_rounds / round state machine)
--   * Admin UI (moderation runs via SQL Editor)
--   * Outbox / email notifications for payouts
--   * External KYC / weekly + monthly limits (we keep a daily cap stub)

-- =========================================================================
-- Extensions
-- =========================================================================

create extension if not exists pgcrypto;

-- =========================================================================
-- New columns on existing tables
-- =========================================================================

-- events: betting window timing + cancellation + winner declaration.
-- `betting_window_minutes` replaces the soft-deprecated `bet_window_locks`
-- enum. `betting_opens_at` / `betting_closes_at` are stamped by
-- `start_event` and form the hard cutoff that `place_bet` enforces.
alter table public.events
  add column if not exists betting_window_minutes integer
    check (betting_window_minutes is null
           or betting_window_minutes between 5 and 30),
  add column if not exists betting_opens_at        timestamptz,
  add column if not exists betting_closes_at       timestamptz,
  add column if not exists betting_window_closed_at timestamptz,
  add column if not exists settled_at              timestamptz,
  add column if not exists cancelled_at            timestamptz,
  add column if not exists cancelled_reason        text,
  add column if not exists winning_outcome_ids     text[];

-- Allow the two new status values: `pending_moderation` (after the
-- streamer declares a winner but before moderation runs settle_event)
-- and `settled` (after a settle/approval cycle completes).
alter table public.events
  drop constraint if exists events_status_check;
alter table public.events
  add constraint events_status_check
  check (status in (
    'draft', 'scheduled', 'live', 'pending_moderation',
    'settled', 'finished', 'cancelled'
  ));

-- event_outcomes: per-outcome pari-mutuel accumulator. The legacy
-- `odds` column stays for backwards-compat reads (seeded rows + any
-- live-app that hasn't migrated to useLiveOdds yet) but is soft-deprecated.
alter table public.event_outcomes
  add column if not exists pool_cents bigint not null default 0
    check (pool_cents >= 0);

create index if not exists event_outcomes_pool_idx
  on public.event_outcomes(event_id, pool_cents desc);

-- bets: snapshot live odds at placement time + idempotency key + add
-- the new lifecycle statuses.
alter table public.bets
  add column if not exists odds_snapshot   numeric(8, 2),
  add column if not exists idempotency_key uuid;

-- Drop the legacy `odds_decimal > 1` check — pari-mutuel math can
-- produce sub-1 values when the bettor dominates the winning pool,
-- and the constraint is meaningless once odds aren't streamer-set.
alter table public.bets
  drop constraint if exists bets_odds_decimal_check;

create unique index if not exists bets_user_idem_idx
  on public.bets(user_id, idempotency_key)
  where idempotency_key is not null;

alter table public.bets
  drop constraint if exists bets_status_check;
alter table public.bets
  add constraint bets_status_check
  check (status in (
    'open', 'placed', 'won_pending_payout', 'won', 'lost', 'refunded'
  ));

-- =========================================================================
-- New tables
-- =========================================================================

-- ledger_chain_tail: per-account pointer to the latest ledger entry so
-- the chain trigger can read the previous hash in O(1).
create table if not exists public.ledger_chain_tail (
  account   text primary key,
  last_hash text not null,
  last_id   uuid not null,
  updated_at timestamptz not null default now()
);

-- ledger_entries: append-only journal. Every money mutation writes a
-- row. `account` is a logical bucket — 'user:<uuid>', 'event_pool:<id>',
-- 'platform' — not a FK. `balance_after_cents` is denormalized so
-- replays don't require recomputing every prior row.
create table if not exists public.ledger_entries (
  id                  uuid primary key default gen_random_uuid(),
  account             text not null,
  type                text not null check (type in (
    'deposit', 'bet', 'withdrawal',
    'payout_pending', 'payout_credit', 'payout_reverse',
    'refund', 'rake', 'residual', 'adjustment'
  )),
  amount_cents        bigint not null,
  balance_after_cents bigint,
  reference_id        text,
  created_at          timestamptz not null default now(),
  prev_hash           text,
  self_hash           text
);

create index if not exists ledger_entries_account_idx
  on public.ledger_entries(account, created_at desc);
create index if not exists ledger_entries_reference_idx
  on public.ledger_entries(reference_id)
  where reference_id is not null;

-- payouts: every winner bet, the streamer's rake, the platform's rake,
-- and any rounding residual become rows here. status starts pending,
-- a moderator (or auto-approval for refunds) flips it through to
-- completed.
create table if not exists public.payouts (
  id              uuid primary key default gen_random_uuid(),
  type            text not null check (type in (
    'winner', 'rake_streamer', 'rake_platform', 'residual', 'refund'
  )),
  recipient_id    uuid,
  recipient_kind  text not null check (recipient_kind in (
    'viewer', 'streamer', 'platform'
  )),
  amount_cents    bigint not null check (amount_cents >= 0),
  event_id        text not null references public.events(id) on delete cascade,
  bet_id          uuid references public.bets(id) on delete set null,
  status          text not null default 'pending' check (status in (
    'pending', 'approved', 'completed', 'rejected', 'on_hold', 'failed'
  )),
  reject_reason   text,
  reject_notes    text,
  created_at      timestamptz not null default now(),
  approved_at     timestamptz,
  completed_at    timestamptz,
  moderator_id    uuid,
  retry_count     integer not null default 0,
  idempotency_key uuid
);

create index if not exists payouts_event_idx       on public.payouts(event_id);
create index if not exists payouts_recipient_idx   on public.payouts(recipient_id) where recipient_id is not null;
create index if not exists payouts_status_idx      on public.payouts(status);
create unique index if not exists payouts_idem_idx on public.payouts(idempotency_key) where idempotency_key is not null;

-- user_bet_caps: single row per (user, day). place_bet UPSERTs into it
-- and rejects if total_cents + amount > DAILY_CAP_CENTS.
create table if not exists public.user_bet_caps (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  day         date not null,
  total_cents bigint not null default 0 check (total_cents >= 0),
  primary key (user_id, day)
);

-- =========================================================================
-- Hash-chain trigger on ledger_entries
-- =========================================================================
--
-- Computes self_hash from the row + previous-hash for the same account,
-- and updates ledger_chain_tail so the next insert chains from this row.

create or replace function public.ledger_entry_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;
  if new.created_at is null then
    new.created_at := now();
  end if;

  select last_hash into v_prev_hash
  from public.ledger_chain_tail
  where account = new.account
  for update;

  new.prev_hash := coalesce(v_prev_hash, '');
  new.self_hash := encode(
    extensions.digest(
      new.id::text || '|' ||
      new.account || '|' ||
      new.type || '|' ||
      new.amount_cents::text || '|' ||
      coalesce(new.balance_after_cents::text, '') || '|' ||
      coalesce(new.reference_id, '') || '|' ||
      to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      new.prev_hash,
      'sha256'
    ),
    'hex'
  );

  insert into public.ledger_chain_tail (account, last_hash, last_id, updated_at)
  values (new.account, new.self_hash, new.id, now())
  on conflict (account) do update
    set last_hash  = excluded.last_hash,
        last_id    = excluded.last_id,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists ledger_entries_chain on public.ledger_entries;
create trigger ledger_entries_chain
  before insert on public.ledger_entries
  for each row execute function public.ledger_entry_chain();

-- =========================================================================
-- Row Level Security
-- =========================================================================

alter table public.payouts          enable row level security;
alter table public.ledger_entries   enable row level security;
alter table public.ledger_chain_tail enable row level security;
alter table public.user_bet_caps    enable row level security;

-- payouts: viewers see their own; streamers see their rake_streamer
-- rows; all mutations go through SECURITY DEFINER RPCs / service_role.
drop policy if exists "Viewers read own payouts" on public.payouts;
create policy "Viewers read own payouts"
  on public.payouts
  for select
  to authenticated
  using (auth.uid() = recipient_id);

drop policy if exists "Streamers read rake payouts" on public.payouts;
create policy "Streamers read rake payouts"
  on public.payouts
  for select
  to authenticated
  using (
    type = 'rake_streamer'
    and exists (
      select 1 from public.events e
      where e.id = payouts.event_id and e.creator_id = auth.uid()
    )
  );

-- ledger_entries: read-only for the row's owning account (matches
-- 'user:<uid>'). All inserts come from RPCs running as SECURITY DEFINER.
drop policy if exists "Users read own ledger" on public.ledger_entries;
create policy "Users read own ledger"
  on public.ledger_entries
  for select
  to authenticated
  using (account = 'user:' || auth.uid()::text);

-- ledger_chain_tail: no public reads. Internal-only.
-- (no policy = no rows visible to authenticated)

-- user_bet_caps: users see their own cap counter (handy for UI hints).
drop policy if exists "Users read own bet caps" on public.user_bet_caps;
create policy "Users read own bet caps"
  on public.user_bet_caps
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Append-only enforcement: revoke all UPDATE/DELETE on ledger_entries.
-- (INSERTs are only possible via SECURITY DEFINER RPCs.)
revoke update, delete on public.ledger_entries from public, authenticated, anon;

-- =========================================================================
-- Realtime publications
-- =========================================================================
--
-- event_outcomes: drives the useLiveOdds hook so odds tick in real
-- time as bets land.
-- payouts: drives the user-app Balance "Payouts in review" list +
-- the studio Balance + MyBets refresh-on-approve UX.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_outcomes'
  ) then
    alter publication supabase_realtime add table public.event_outcomes;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'payouts'
  ) then
    alter publication supabase_realtime add table public.payouts;
  end if;
end $$;

-- =========================================================================
-- Constants (SQL mirror of packages/lib/src/betting.ts)
-- =========================================================================
--
-- Defined as a function so it's atomically updatable in a single
-- migration when we tune. All callers select from get_betting_constants.

create or replace function public.get_betting_constants()
returns table (
  min_bet_cents             integer,
  max_bet_cents             integer,
  max_odds_cap              numeric,
  rake_bps                  integer,
  rake_platform_bps         integer,
  rake_streamer_bps         integer,
  min_unique_bettors        integer,
  min_outcomes_with_bets    integer,
  betting_window_min_min    integer,
  betting_window_min_max    integer,
  daily_cap_cents           integer
)
language sql
immutable
as $$
  select
    100        as min_bet_cents,
    1000       as max_bet_cents,
    15.0::numeric as max_odds_cap,
    1000       as rake_bps,
    500        as rake_platform_bps,
    500        as rake_streamer_bps,
    5          as min_unique_bettors,
    2          as min_outcomes_with_bets,
    5          as betting_window_min_min,
    30         as betting_window_min_max,
    10000      as daily_cap_cents;
$$;

-- =========================================================================
-- RPC: start_event (override — stamp betting window timestamps)
-- =========================================================================

create or replace function public.start_event(p_event_id text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_creator_status text;
  v_window_min integer;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select status into v_creator_status
  from public.creator_profiles where id = v_user_id;
  if v_creator_status is null then
    raise exception 'Creator profile not found' using errcode = 'P0002';
  end if;
  if v_creator_status <> 'verified' then
    raise exception 'Your account must be verified to start an event'
      using errcode = '42501';
  end if;

  -- Default to 10 minutes if the editor never picked one (eg. legacy rows).
  select coalesce(betting_window_minutes, 10) into v_window_min
  from public.events
  where id = p_event_id;

  update public.events
  set status            = 'live',
      started_at        = coalesce(started_at, now()),
      betting_opens_at  = coalesce(betting_opens_at, now()),
      betting_closes_at = coalesce(
                            betting_closes_at,
                            now() + make_interval(mins => coalesce(v_window_min, 10))
                          )
  where id = p_event_id
    and creator_id = v_user_id
    and status = 'scheduled'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not in scheduled state'
      using errcode = '42501';
  end if;
  return v_row;
end;
$$;
grant execute on function public.start_event(text) to authenticated;

-- =========================================================================
-- RPC: set_event_betting_window
-- =========================================================================
--
-- Standalone updater for the new betting_window_minutes column so the
-- studio EventEditor can persist the value without us having to extend
-- the (already-wide) update_event signature. Caller must own the
-- event AND it must still be draft/scheduled.

create or replace function public.set_event_betting_window(
  p_event_id text,
  p_minutes  integer
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_minutes is not null and (p_minutes < 5 or p_minutes > 30) then
    raise exception 'Betting window must be between 5 and 30 minutes'
      using errcode = '22023';
  end if;

  update public.events
  set betting_window_minutes = p_minutes
  where id = p_event_id
    and creator_id = v_user_id
    and status in ('draft', 'scheduled')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not editable'
      using errcode = '42501';
  end if;
  return v_row;
end;
$$;
grant execute on function public.set_event_betting_window(text, integer) to authenticated;

-- =========================================================================
-- RPC: compute_live_odds
-- =========================================================================

create or replace function public.compute_live_odds(p_event_id text)
returns table (
  outcome_id        text,
  pool_cents        bigint,
  total_pool_cents  bigint,
  live_odds         numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_rake_bps integer;
begin
  select rake_bps into v_rake_bps from public.get_betting_constants();

  select coalesce(sum(o.pool_cents), 0) into v_total
  from public.event_outcomes o
  where o.event_id = p_event_id;

  return query
    select
      o.id::text,
      o.pool_cents,
      v_total,
      case
        when o.pool_cents = 0 or v_total = 0 then null::numeric
        else round(
          (v_total::numeric * (10000 - v_rake_bps) / 10000.0) / o.pool_cents::numeric,
          2
        )
      end as live_odds
    from public.event_outcomes o
    where o.event_id = p_event_id
    order by o.sort_order asc, o.id asc;
end;
$$;
grant execute on function public.compute_live_odds(text) to anon, authenticated;

-- =========================================================================
-- RPC: place_bet (rewrite — pari-mutuel, atomic, idempotent)
-- =========================================================================

-- Drop the old (text, text, integer) signature so it doesn't shadow
-- the new one when /supabase types calls it.
drop function if exists public.place_bet(text, text, integer);

create or replace function public.place_bet(
  p_event_id        text,
  p_outcome_id      text,
  p_amount_cents    integer,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_balance bigint;
  v_event public.events%rowtype;
  v_outcome public.event_outcomes%rowtype;
  v_min integer;
  v_max integer;
  v_rake_bps integer;
  v_daily_cap integer;
  v_bet_id uuid;
  v_existing_bet public.bets%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_day_total bigint;
  v_new_balance bigint;
  v_new_pool bigint;
  v_total_pool bigint;
  v_live_odds numeric;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  -- Idempotency replay short-circuit: if we've already stored this key
  -- for this user, return the existing bet's effect.
  select * into v_existing_bet
  from public.bets
  where user_id = v_user_id
    and idempotency_key = p_idempotency_key;
  if v_existing_bet.id is not null then
    select coalesce(sum(pool_cents), 0) into v_total_pool
    from public.event_outcomes where event_id = v_existing_bet.event_id;
    select pool_cents into v_new_pool
    from public.event_outcomes where id = v_existing_bet.outcome_id;
    select balance_cents into v_new_balance from public.profiles where id = v_user_id;
    return json_build_object(
      'bet_id', v_existing_bet.id,
      'idempotent_replay', true,
      'new_balance_cents', v_new_balance,
      'live_odds', v_existing_bet.odds_snapshot,
      'total_pool_cents', v_total_pool,
      'outcome_pool_cents', v_new_pool
    );
  end if;

  select min_bet_cents, max_bet_cents, rake_bps, daily_cap_cents
    into v_min, v_max, v_rake_bps, v_daily_cap
  from public.get_betting_constants();

  if p_amount_cents < v_min then
    raise exception 'min_bet: stake must be ≥ % cents', v_min using errcode = '22023';
  end if;
  if p_amount_cents > v_max then
    raise exception 'max_bet: stake must be ≤ % cents', v_max using errcode = '22023';
  end if;

  -- Load event + outcome together, lock the outcome row.
  select * into v_outcome from public.event_outcomes
  where id = p_outcome_id
  for update;
  if v_outcome.id is null then
    raise exception 'Outcome not found' using errcode = '23503';
  end if;
  if v_outcome.event_id <> p_event_id then
    raise exception 'Outcome does not belong to event' using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;

  if v_event.status <> 'live' then
    raise exception 'window_closed: event is not live' using errcode = '22023';
  end if;
  if v_event.betting_closes_at is not null and now() > v_event.betting_closes_at then
    raise exception 'window_closed: betting cutoff passed' using errcode = '22023';
  end if;
  if v_event.creator_id is not null and v_event.creator_id = v_user_id then
    raise exception 'Streamers cannot bet on their own event' using errcode = '42501';
  end if;

  -- Daily cap (stub KYC).
  select coalesce(total_cents, 0) into v_day_total
  from public.user_bet_caps where user_id = v_user_id and day = v_today;
  if coalesce(v_day_total, 0) + p_amount_cents > v_daily_cap then
    raise exception 'daily_cap_exceeded: % cents over daily limit',
      coalesce(v_day_total, 0) + p_amount_cents - v_daily_cap
      using errcode = '22023';
  end if;

  -- Balance check + atomic debit.
  select balance_cents into v_balance
  from public.profiles where id = v_user_id
  for update;
  if v_balance is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if v_balance < p_amount_cents then
    raise exception 'insufficient_balance' using errcode = '22023';
  end if;

  update public.profiles
  set balance_cents = balance_cents - p_amount_cents
  where id = v_user_id;
  v_new_balance := v_balance - p_amount_cents;

  -- Increment outcome pool.
  update public.event_outcomes
  set pool_cents = pool_cents + p_amount_cents
  where id = p_outcome_id
  returning pool_cents into v_new_pool;

  -- Live odds snapshot from the now-updated pools.
  select coalesce(sum(pool_cents), 0) into v_total_pool
  from public.event_outcomes where event_id = p_event_id;
  v_live_odds := case
    when v_new_pool = 0 or v_total_pool = 0 then null
    else round(
      (v_total_pool::numeric * (10000 - v_rake_bps) / 10000.0) / v_new_pool::numeric,
      2
    )
  end;

  -- Insert the bet row.
  insert into public.bets (
    user_id, event_id, outcome_id, amount_cents, odds_decimal,
    odds_snapshot, status, idempotency_key
  ) values (
    v_user_id, p_event_id, p_outcome_id, p_amount_cents,
    coalesce(v_live_odds, 1.01),
    v_live_odds, 'placed', p_idempotency_key
  )
  returning id into v_bet_id;

  -- Ledger: debit from user, credit to event pool.
  insert into public.ledger_entries (account, type, amount_cents, balance_after_cents, reference_id)
  values
    ('user:' || v_user_id::text, 'bet', -p_amount_cents, v_new_balance, v_bet_id::text),
    ('event_pool:' || p_event_id, 'bet', p_amount_cents, v_total_pool, v_bet_id::text);

  -- Daily cap counter.
  insert into public.user_bet_caps (user_id, day, total_cents)
  values (v_user_id, v_today, p_amount_cents)
  on conflict (user_id, day) do update
    set total_cents = user_bet_caps.total_cents + excluded.total_cents;

  return json_build_object(
    'bet_id', v_bet_id,
    'idempotent_replay', false,
    'new_balance_cents', v_new_balance,
    'live_odds', v_live_odds,
    'total_pool_cents', v_total_pool,
    'outcome_pool_cents', v_new_pool
  );
end;
$$;
grant execute on function public.place_bet(text, text, integer, uuid) to authenticated;

-- =========================================================================
-- RPC: declare_winner
-- =========================================================================

create or replace function public.declare_winner(
  p_event_id            text,
  p_winning_outcome_ids text[]
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event public.events%rowtype;
  v_invalid_ids int;
  v_row public.events;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;
  if v_event.creator_id is null or v_event.creator_id <> v_user_id then
    raise exception 'Only the event creator can declare a winner'
      using errcode = '42501';
  end if;
  if v_event.status <> 'live' then
    raise exception 'Event must be live to declare a winner' using errcode = '22023';
  end if;
  if v_event.betting_closes_at is not null and now() < v_event.betting_closes_at then
    raise exception 'Betting window has not closed yet' using errcode = '22023';
  end if;
  if p_winning_outcome_ids is null or array_length(p_winning_outcome_ids, 1) is null then
    raise exception 'Must pick at least one winning outcome' using errcode = '22023';
  end if;

  -- Every supplied outcome must belong to this event.
  select count(*) into v_invalid_ids
  from unnest(p_winning_outcome_ids) as wid
  where not exists (
    select 1 from public.event_outcomes
    where id = wid and event_id = p_event_id
  );
  if v_invalid_ids > 0 then
    raise exception '% winning outcome id(s) do not belong to this event', v_invalid_ids
      using errcode = '22023';
  end if;

  update public.events
  set status              = 'pending_moderation',
      winning_outcome_ids = p_winning_outcome_ids
  where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.declare_winner(text, text[]) to authenticated;

-- =========================================================================
-- RPC: cancel_event
-- =========================================================================
--
-- Refunds every bet on the event and flips status to 'cancelled'.
-- Callable by service_role OR by the event's creator (used as the
-- studio End-stream fallback when nobody bet / pool was too small).
-- Refunds are auto-completed inline (no moderation needed).

create or replace function public.cancel_event(
  p_event_id text,
  p_reason   text default 'cancelled'
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event public.events%rowtype;
  v_payout_id uuid;
  v_new_balance bigint;
  v_pool_remaining bigint;
  b record;
  v_row public.events;
begin
  v_user_id := auth.uid();
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;

  -- Permission: service_role / system calls pass through (auth.uid()
  -- is null when invoked from an Edge Function or SQL Editor); creator
  -- calls must match the event's creator_id.
  if v_user_id is not null then
    if v_event.creator_id is null or v_event.creator_id <> v_user_id then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
  end if;

  if v_event.status = 'cancelled' then
    return v_event; -- idempotent re-run
  end if;
  if v_event.status = 'settled' then
    raise exception 'Cannot cancel a settled event' using errcode = '22023';
  end if;

  select coalesce(sum(pool_cents), 0) into v_pool_remaining
  from public.event_outcomes where event_id = p_event_id;

  -- Refund every placed/open/won_pending_payout bet on this event.
  for b in
    select * from public.bets
    where event_id = p_event_id
      and status in ('open', 'placed', 'won_pending_payout')
  loop
    update public.profiles
    set balance_cents = balance_cents + b.amount_cents
    where id = b.user_id
    returning balance_cents into v_new_balance;

    insert into public.payouts (
      type, recipient_id, recipient_kind, amount_cents,
      event_id, bet_id, status, completed_at
    ) values (
      'refund', b.user_id, 'viewer', b.amount_cents,
      p_event_id, b.id, 'completed', now()
    )
    returning id into v_payout_id;

    update public.bets
    set status = 'refunded', settled_at = now(), payout_cents = b.amount_cents
    where id = b.id;

    v_pool_remaining := v_pool_remaining - b.amount_cents;

    -- Two ledger entries: pool out, user in.
    insert into public.ledger_entries (account, type, amount_cents, balance_after_cents, reference_id)
    values
      ('event_pool:' || p_event_id, 'refund', -b.amount_cents, greatest(v_pool_remaining, 0), v_payout_id::text),
      ('user:' || b.user_id::text, 'refund',  b.amount_cents, v_new_balance, v_payout_id::text);
  end loop;

  -- Zero out the pools — refunds drained the pool.
  update public.event_outcomes set pool_cents = 0 where event_id = p_event_id;

  update public.events
  set status           = 'cancelled',
      cancelled_at     = now(),
      cancelled_reason = coalesce(p_reason, 'cancelled')
  where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.cancel_event(text, text) to authenticated;

-- =========================================================================
-- Helper: derive_payout_key (deterministic UUID from a parent key + name)
-- =========================================================================
--
-- Used inside settle_event so the per-row payout idempotency keys
-- collide on replay. SHA-256 of "<parent>:<name>", first 16 bytes
-- formatted as a UUID. Deterministic, immutable.

create or replace function public.derive_payout_key(
  p_parent uuid,
  p_name   text
)
returns uuid
language sql
immutable
as $$
  select (
    substr(h, 1, 8)  || '-' ||
    substr(h, 9, 4)  || '-' ||
    substr(h, 13, 4) || '-' ||
    substr(h, 17, 4) || '-' ||
    substr(h, 21, 12)
  )::uuid
  from (
    select encode(extensions.digest(p_parent::text || ':' || p_name, 'sha256'), 'hex') as h
  ) s;
$$;

-- =========================================================================
-- RPC: settle_event
-- =========================================================================
--
-- Service-role only (moderator runs it from SQL Editor after eyeballing
-- the declared winners). Computes rake, creates pending payouts for
-- every winning bet + the streamer + the platform + any residual.

create or replace function public.settle_event(
  p_event_id        text,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_total bigint;
  v_winning_pool bigint;
  v_rake bigint;
  v_rake_streamer bigint;
  v_rake_platform bigint;
  v_distributable bigint;
  v_capped_odds numeric;
  v_payout_sum bigint := 0;
  v_residual bigint;
  v_min_unique_bettors integer;
  v_min_outcomes integer;
  v_rake_bps integer;
  v_rake_streamer_bps integer;
  v_max_odds numeric;
  v_unique_bettors integer;
  v_outcomes_with_bets integer;
  v_payout_id uuid;
  v_payout_count integer := 0;
  b record;
  v_winner_total bigint;
begin
  -- Access is gated by REVOKE EXECUTE below (only service_role can
  -- invoke this RPC). No in-body role check needed.

  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;

  -- Idempotency: if any payout already carries this key, just return.
  if exists (
    select 1 from public.payouts
    where event_id = p_event_id and idempotency_key = p_idempotency_key
  ) then
    return json_build_object('idempotent_replay', true, 'event_id', p_event_id);
  end if;

  if v_event.status <> 'pending_moderation' then
    raise exception 'Event must be pending_moderation to settle (got %)', v_event.status
      using errcode = '22023';
  end if;

  select rake_bps, rake_streamer_bps, max_odds_cap,
         min_unique_bettors, min_outcomes_with_bets
    into v_rake_bps, v_rake_streamer_bps, v_max_odds,
         v_min_unique_bettors, v_min_outcomes
  from public.get_betting_constants();

  -- Cancellation guards.
  select count(distinct user_id), count(distinct outcome_id)
    into v_unique_bettors, v_outcomes_with_bets
  from public.bets
  where event_id = p_event_id and status = 'placed';

  if coalesce(v_unique_bettors, 0) < v_min_unique_bettors
     or coalesce(v_outcomes_with_bets, 0) < v_min_outcomes then
    perform public.cancel_event(p_event_id,
      'auto_cancel: not enough unique bettors or distinct outcomes');
    return json_build_object(
      'cancelled', true,
      'reason', 'auto_cancel_minimums',
      'unique_bettors', coalesce(v_unique_bettors, 0),
      'outcomes_with_bets', coalesce(v_outcomes_with_bets, 0)
    );
  end if;

  if v_event.winning_outcome_ids is null
     or array_length(v_event.winning_outcome_ids, 1) is null then
    raise exception 'No winning outcomes declared' using errcode = '22023';
  end if;

  -- Total pool + winning pool.
  select coalesce(sum(pool_cents), 0) into v_total
  from public.event_outcomes where event_id = p_event_id;
  select coalesce(sum(pool_cents), 0) into v_winning_pool
  from public.event_outcomes
  where event_id = p_event_id
    and id = any(v_event.winning_outcome_ids);

  if v_winning_pool = 0 then
    -- No bets on the winning side — auto-cancel + refund every bet.
    perform public.cancel_event(p_event_id, 'auto_cancel: no bets on winner');
    return json_build_object(
      'cancelled', true,
      'reason', 'no_bets_on_winner'
    );
  end if;

  v_rake := (v_total * v_rake_bps) / 10000;
  v_rake_streamer := (v_total * v_rake_streamer_bps) / 10000;
  v_rake_platform := v_rake - v_rake_streamer;
  v_distributable := v_total - v_rake;
  v_capped_odds := least(v_max_odds, v_distributable::numeric / v_winning_pool::numeric);

  -- Per-bet winner payouts. Sum totals so we can compute the residual.
  for b in
    select * from public.bets
    where event_id = p_event_id
      and outcome_id = any(v_event.winning_outcome_ids)
      and status = 'placed'
  loop
    v_winner_total := floor(b.amount_cents::numeric * v_capped_odds)::bigint;
    if v_winner_total < 0 then v_winner_total := 0; end if;
    v_payout_sum := v_payout_sum + v_winner_total;

    insert into public.payouts (
      type, recipient_id, recipient_kind, amount_cents,
      event_id, bet_id, status, idempotency_key
    ) values (
      'winner', b.user_id, 'viewer', v_winner_total,
      p_event_id, b.id, 'pending',
      -- Per-row idempotency derived from the parent key so a replay
      -- of settle_event hits the parent's "key exists" short-circuit.
      public.derive_payout_key(p_idempotency_key, b.id::text)
    )
    returning id into v_payout_id;

    update public.bets set status = 'won_pending_payout' where id = b.id;
    v_payout_count := v_payout_count + 1;

    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_winner_total, v_payout_id::text);
  end loop;

  -- Losing bets.
  update public.bets
  set status = 'lost', settled_at = now()
  where event_id = p_event_id
    and status = 'placed'
    and not (outcome_id = any(v_event.winning_outcome_ids));

  -- Rake — streamer half.
  if v_rake_streamer > 0 and v_event.creator_id is not null then
    insert into public.payouts (
      type, recipient_id, recipient_kind, amount_cents,
      event_id, status, idempotency_key
    ) values (
      'rake_streamer', v_event.creator_id, 'streamer', v_rake_streamer,
      p_event_id, 'pending', public.derive_payout_key(p_idempotency_key, 'rake_streamer')
    )
    returning id into v_payout_id;
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_rake_streamer, v_payout_id::text);
  end if;

  -- Rake — platform half (recipient is 'platform' bucket, no profile credit).
  if v_rake_platform > 0 then
    insert into public.payouts (
      type, recipient_kind, amount_cents,
      event_id, status, idempotency_key
    ) values (
      'rake_platform', 'platform', v_rake_platform,
      p_event_id, 'pending', public.derive_payout_key(p_idempotency_key, 'rake_platform')
    )
    returning id into v_payout_id;
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_rake_platform, v_payout_id::text);
  end if;

  -- Residual from MAX_ODDS cap (distributable - sum(winner payouts)).
  v_residual := v_distributable - v_payout_sum;
  if v_residual > 0 then
    insert into public.payouts (
      type, recipient_kind, amount_cents,
      event_id, status, idempotency_key
    ) values (
      'residual', 'platform', v_residual,
      p_event_id, 'pending', public.derive_payout_key(p_idempotency_key, 'residual')
    )
    returning id into v_payout_id;
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values ('event_pool:' || p_event_id, 'payout_pending', -v_residual, v_payout_id::text);
  end if;

  update public.events
  set status     = 'settled',
      settled_at = now()
  where id = p_event_id;

  return json_build_object(
    'cancelled', false,
    'event_id', p_event_id,
    'total_pool_cents', v_total,
    'winning_pool_cents', v_winning_pool,
    'rake_cents', v_rake,
    'distributable_cents', v_distributable,
    'capped_odds', v_capped_odds,
    'winner_payouts', v_payout_count,
    'residual_cents', greatest(v_residual, 0)
  );
end;
$$;

-- =========================================================================
-- RPC: approve_payout
-- =========================================================================
--
-- Service-role only. Credits the recipient and marks the payout
-- complete. Idempotent on the supplied key.

create or replace function public.approve_payout(
  p_payout_id       uuid,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.payouts%rowtype;
  v_new_balance bigint;
  v_account text;
begin
  -- Access is gated by REVOKE EXECUTE (service_role only).
  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  select * into v_payout from public.payouts where id = p_payout_id for update;
  if v_payout.id is null then
    raise exception 'Payout not found' using errcode = '23503';
  end if;

  if v_payout.status = 'completed' then
    return json_build_object('idempotent_replay', true, 'payout_id', p_payout_id);
  end if;
  if v_payout.status <> 'pending' and v_payout.status <> 'approved' then
    raise exception 'Payout is not pending (got %)', v_payout.status
      using errcode = '22023';
  end if;

  -- Credit recipient (only for kinds with a profile).
  if v_payout.recipient_kind in ('viewer', 'streamer') and v_payout.recipient_id is not null then
    update public.profiles
    set balance_cents = balance_cents + v_payout.amount_cents
    where id = v_payout.recipient_id
    returning balance_cents into v_new_balance;

    v_account := 'user:' || v_payout.recipient_id::text;
    insert into public.ledger_entries (account, type, amount_cents, balance_after_cents, reference_id)
    values (v_account, 'payout_credit', v_payout.amount_cents, v_new_balance, v_payout.id::text);
  else
    -- platform bucket — ledger only.
    v_account := 'platform';
    insert into public.ledger_entries (account, type, amount_cents, reference_id)
    values (v_account,
            case when v_payout.type = 'rake_platform' then 'rake'
                 when v_payout.type = 'residual'      then 'residual'
                 else 'payout_credit' end,
            v_payout.amount_cents, v_payout.id::text);
  end if;

  update public.payouts
  set status        = 'completed',
      approved_at   = coalesce(approved_at, now()),
      completed_at  = now(),
      idempotency_key = coalesce(idempotency_key, p_idempotency_key)
  where id = p_payout_id;

  -- For winner payouts, flip the linked bet to 'won'.
  if v_payout.type = 'winner' and v_payout.bet_id is not null then
    update public.bets
    set status        = 'won',
        settled_at    = now(),
        payout_cents  = v_payout.amount_cents
    where id = v_payout.bet_id;
  end if;

  return json_build_object(
    'idempotent_replay', false,
    'payout_id', p_payout_id,
    'new_balance_cents', v_new_balance
  );
end;
$$;

-- =========================================================================
-- RPC: reject_payout
-- =========================================================================

create or replace function public.reject_payout(
  p_payout_id uuid,
  p_reason    text,
  p_notes     text default null
)
returns public.payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.payouts%rowtype;
  v_row public.payouts;
begin
  -- Access is gated by REVOKE EXECUTE (service_role only).
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if v_payout.id is null then
    raise exception 'Payout not found' using errcode = '23503';
  end if;
  if v_payout.status not in ('pending', 'approved') then
    raise exception 'Payout cannot be rejected from status %', v_payout.status
      using errcode = '22023';
  end if;

  update public.payouts
  set status        = 'rejected',
      reject_reason = coalesce(p_reason, 'unspecified'),
      reject_notes  = p_notes
  where id = p_payout_id
  returning * into v_row;

  -- Reverse the payout_pending on the event_pool ledger so the chain
  -- stays balanced. Money stays in the pool until manual resolution.
  insert into public.ledger_entries (account, type, amount_cents, reference_id)
  values ('event_pool:' || v_payout.event_id, 'payout_reverse', v_payout.amount_cents, v_payout.id::text);

  return v_row;
end;
$$;

-- =========================================================================
-- Grants + revokes (final access matrix)
-- =========================================================================

-- Constants helper: read-only, anyone can call.
grant execute on function public.get_betting_constants() to anon, authenticated;

-- compute_live_odds: read-only, anyone can call.
-- (already granted above)

-- place_bet: viewers call it.
-- (already granted above)

-- declare_winner: creators only — granted above to authenticated.

-- cancel_event: creators OR service_role. Authenticated grant above
-- already covers the creator path; service_role bypasses normal grants.

-- settle_event / approve_payout / reject_payout: service-role-only.
-- PUBLIC + authenticated get nothing; service_role retains its role-
-- level execute privilege.
revoke execute on function public.settle_event(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.approve_payout(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.reject_payout(uuid, text, text)
  from public, anon, authenticated;

-- The chain helper / payout key helper are internal — never called by
-- clients directly.
revoke execute on function public.ledger_entry_chain()
  from public, anon, authenticated;
revoke execute on function public.derive_payout_key(uuid, text)
  from public, anon, authenticated;

-- =========================================================================
-- Done. Operator must run this migration once (Supabase SQL Editor or
-- `supabase db push`). After it lands, the Edge Function
-- `close-betting-windows` should be deployed + scheduled to fire every
-- minute via Supabase's cron extension.
-- =========================================================================
