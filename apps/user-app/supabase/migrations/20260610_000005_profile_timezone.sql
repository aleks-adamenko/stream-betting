-- =========================================================================
-- 20260610_000005 — Recipient timezone for email rendering
-- =========================================================================
--
-- Captures each viewer's IANA timezone so the scheduled / rescheduled
-- emails render the start-time label in the RECIPIENT's wall-clock,
-- not the creator's and not UTC. A creator in Kyiv (UTC+3) picking
-- 14:00 stores 11:00Z; the Warsaw recipient (UTC+2) reads "1:00 PM
-- CEST" while a Kyiv recipient reads "2:00 PM EEST".
--
-- Touches two places:
--
-- 1. `profiles.timezone text` — new nullable column. Populated from
--    `Intl.DateTimeFormat().resolvedOptions().timeZone` whenever the
--    user-app loads a session. Null on legacy viewers who haven't
--    opened the user-app since this migration — the edge functions
--    fall back to UTC in that case.
--
-- 2. `set_user_timezone(p_timezone text)` RPC — viewer-callable
--    security-definer setter. The broad "Users update own profile"
--    RLS policy was dropped back in 20260514_000001 (so a malicious
--    client can't bump balance_cents directly), so user-driven
--    column writes have to flow through dedicated RPCs. The
--    function only mutates its own column and accepts only IANA
--    names that pg can parse via `now() at time zone $1` — bogus
--    strings get rejected with a 22023 (rather than silently stored
--    and then crashing the Edge-function render later).

-- -------------------------------------------------------------------------
-- 1) Column
-- -------------------------------------------------------------------------

alter table public.profiles
  add column if not exists timezone text;

comment on column public.profiles.timezone is
  'IANA timezone name (e.g. "Europe/Warsaw") captured by the user-app '
  'on session open. Used by notify-* edge functions to render time '
  'labels in each recipient''s wall-clock. NULL → edge functions '
  'fall back to UTC.';

-- -------------------------------------------------------------------------
-- 2) set_user_timezone RPC
-- -------------------------------------------------------------------------

create or replace function public.set_user_timezone(p_timezone text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Defence-in-depth: reject inputs Postgres can't interpret as a
  -- timezone. The cheapest way to validate an IANA name is to ask
  -- pg to resolve it — `now() at time zone $1` raises on unknown
  -- zones, so a malicious / fat-fingered client can't poison the
  -- column with garbage that the Edge-function render would then
  -- crash on. Empty / null input clears the column (recipient
  -- falls back to UTC).
  if p_timezone is null or char_length(trim(p_timezone)) = 0 then
    update public.profiles set timezone = null where id = v_user_id;
    return;
  end if;

  begin
    perform now() at time zone p_timezone;
  exception when others then
    raise exception 'invalid_timezone' using errcode = '22023';
  end;

  update public.profiles
  set timezone = p_timezone
  where id = v_user_id;
end;
$$;

grant execute on function public.set_user_timezone(text) to authenticated;

notify pgrst, 'reload schema';
