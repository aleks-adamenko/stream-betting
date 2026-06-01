-- LiveRush — two related fixes uncovered when a creator ended a live
-- event that had bets but no declared winner.
--
-- 1) finish_event used to just flip status='live' → 'finished' without
--    touching bets. So bets placed during the round stayed in `placed`
--    forever, balances were never refunded, ledger never moved. Bug.
--    Fix: if bets exist on the event AND no winning_outcome_ids were
--    declared, route through cancel_event instead so every bet is
--    refunded atomically (cancelled status + per-bet refund rows in
--    ledger_entries + balance credits via the existing cancel_event
--    body).
--
-- 2) The studio EventList renders Delete vs Archive based on a
--    `bets(count)` aggregate join. Postgres RLS on `bets` (defined
--    in 20260513_000003_auth.sql line 184) restricts SELECT to
--    rows where `auth.uid() = user_id` — so a creator querying bets
--    on their own event sees zero rows (the bets belong to viewers,
--    not the creator). The aggregate count comes back as 0, the UI
--    thinks the event is empty, surfaces the Delete icon, and
--    delete_event then rejects because bets actually exist.
--    Fix: SECURITY DEFINER RPC `list_creator_event_bet_counts()`
--    returns one row per creator-owned event with the real bet count.
--    The studio joins on this instead of the RLS-blocked aggregate.

-- =========================================================================
-- 1) finish_event — auto-cancel on bets without a declared winner
-- =========================================================================

create or replace function public.finish_event(p_event_id text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_row        public.events;
  v_has_bets   boolean;
  v_has_winner boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Pull the row first (record INTO must be solo — Postgres rejects
  -- a record + scalar INTO in one statement). Then compute the two
  -- predicates from the row we already have.
  select *
  into v_row
  from public.events e
  where e.id = p_event_id
    and e.creator_id = v_user_id
    and e.status = 'live';

  if v_row.id is null then
    raise exception 'Event not found, not yours, or not in live state'
      using errcode = '42501';
  end if;

  select exists (
    select 1 from public.bets b where b.event_id = v_row.id
  ) into v_has_bets;

  v_has_winner := coalesce(array_length(v_row.winning_outcome_ids, 1), 0) > 0;

  -- Bets exist but no winner was declared → can't settle, must refund.
  -- cancel_event handles the full refund pipeline (per-bet payouts at
  -- status='completed', balance credits, ledger entries, status flip
  -- to 'cancelled'). It's idempotent on a 'live' event.
  if v_has_bets and not v_has_winner then
    return public.cancel_event(
      p_event_id,
      'auto_cancel: creator ended stream without declaring a winner'
    );
  end if;

  -- Otherwise just close it out as 'finished' (no bets, nothing to
  -- refund — same as before).
  update public.events
  set status = 'finished'
  where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.finish_event(text) to authenticated;

-- =========================================================================
-- 2) list_creator_event_bet_counts — bypass RLS for the studio
-- =========================================================================
--
-- Returns one row per event the caller owns, with the real (RLS-
-- bypassed) bet count. SECURITY DEFINER + the creator_id =
-- auth.uid() filter inside the body keep the surface scoped: a
-- creator cannot read counts for events they don't own.

create or replace function public.list_creator_event_bet_counts()
returns table (
  event_id  text,
  bet_count integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  return query
  select
    e.id as event_id,
    coalesce((
      select count(*)::integer
      from public.bets b
      where b.event_id = e.id
    ), 0) as bet_count
  from public.events e
  where e.creator_id = v_user_id;
end;
$$;

grant execute on function public.list_creator_event_bet_counts() to authenticated;

notify pgrst, 'reload schema';
