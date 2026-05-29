-- LiveRush — soft-delete (archive) for events that have financial
-- history.
--
-- Problem: a `settled` (or `cancelled`) event has rows referencing it
-- in `payouts`, `bets`, and `ledger_entries`. The original
-- `delete_event` RPC + `ON DELETE CASCADE` on payouts would wipe
-- those rows, breaking:
--   * viewer "My Bets" history (`bets.event_id` becomes dangling /
--     cascade-deleted)
--   * payout records (cascade)
--   * the append-only ledger's audit chain (reference_ids point to a
--     row that no longer exists)
--
-- Spec section 13: "Append-only audit log. Никаких UPDATE/DELETE."
-- So we never hard-delete an event that ever had bets on it.
--
-- Solution:
--   * Add `events.archived_at` + `events.archived_by`.
--   * New `archive_event(event_id)` / `unarchive_event(event_id)`
--     RPCs available to the creator on terminal-state events.
--   * Tighten `delete_event` to draft-only — anything past draft might
--     have ledger entries (or a Cloudflare live input still alive),
--     and the archive path is the correct hammer.
--   * The studio EventList filters archived events out of the
--     default tabs and surfaces an "Archived" tab with an
--     Unarchive action.
--   * The user-app feed filters archived events out of Discover /
--     Home, but `getEvent(id)` does NOT — so a viewer who has a
--     bet on an archived event can still open it from My Bets and
--     see the post-settlement detail page.

-- =========================================================================
-- 1) Columns
-- =========================================================================

alter table public.events
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id);

create index if not exists events_archived_idx
  on public.events(creator_id, archived_at)
  where archived_at is not null;

-- =========================================================================
-- 2) Tighten delete_event — draft only
-- =========================================================================
--
-- Any event past draft has at minimum a provisioned Cloudflare live
-- input + an event_streams row, and from `live` onwards it can have
-- ledger entries. Both cases want archive, not delete.

create or replace function public.delete_event(p_event_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_n integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  delete from public.events
  where id = p_event_id
    and creator_id = v_user_id
    and status = 'draft';

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Only drafts can be deleted. Use archive_event for ended events.'
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.delete_event(text) to authenticated;

-- =========================================================================
-- 3) archive_event / unarchive_event
-- =========================================================================

create or replace function public.archive_event(p_event_id text)
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

  update public.events
  set archived_at = now(),
      archived_by = v_user_id
  where id = p_event_id
    and creator_id = v_user_id
    -- Archive only makes sense on terminal states. `live` is still
    -- broadcasting; `scheduled` has no ledger writes yet (a fresh
    -- delete via the studio's "End scheduled" path is the right tool
    -- for that one — not in this migration).
    and status in ('finished', 'settled', 'pending_moderation', 'cancelled')
    and archived_at is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not archivable'
      using errcode = '42501';
  end if;
  return v_row;
end;
$$;

grant execute on function public.archive_event(text) to authenticated;

create or replace function public.unarchive_event(p_event_id text)
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

  update public.events
  set archived_at = null,
      archived_by = null
  where id = p_event_id
    and creator_id = v_user_id
    and archived_at is not null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not currently archived'
      using errcode = '42501';
  end if;
  return v_row;
end;
$$;

grant execute on function public.unarchive_event(text) to authenticated;

-- =========================================================================
-- 4) RLS — hide archived events from the public feed
-- =========================================================================
--
-- Existing policy "Public reads non-draft events" stays as the base
-- gate. We add an extra hide-when-archived clause via a second
-- policy that uses AND-of-policies semantics in postgres: when a
-- table has multiple PERMISSIVE policies they're OR'd, so we
-- instead replace the policy with the combined condition. Viewers
-- who own a bet on an archived event still reach the row through
-- the bets RLS join — which uses the events table's RLS too.
--
-- Simpler approach: leave the policy as-is and just filter on the
-- service / client side. The events table is read by everyone (RLS
-- says non-draft is public) — viewers shouldn't see archived rows in
-- the feed, but they SHOULD see them when they explicitly hit
-- `/event/:id` after winning a payout. So we filter in the SELECTs
-- (eventsService.listEvents) rather than RLS.

notify pgrst, 'reload schema';
