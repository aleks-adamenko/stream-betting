-- LiveRush — fix mark_final_round semantics + finish_event final-round path.
--
-- Bugs reported:
--   1. Streamer clicks "Final round" expecting the LAST round to
--      start fresh — but the previous mark_final_round implementation
--      only settled the current round and flipped is_final_round=true
--      WITHOUT advancing the round counter or reopening the betting
--      window. Result: betting_closes_at was still in the past, no
--      one could place bets on what was supposed to be the final
--      round, and the streamer was stuck.
--   2. Clicking End stream from that stuck state hit finish_event,
--      which on the multi-round branch always called refund_round
--      against the current round — even when the round was already
--      settled by mark_final_round. The refund was a no-op (no bets
--      in 'placed' state), but more importantly the code nulled
--      winning_outcome_ids and never re-settled the (now intentional)
--      "this is the last round, take bets, declare a winner" round.
--
-- Fix: align the semantics with the streamer's mental model.
--
--   • `mark_final_round` now behaves like `advance_round` (settles
--     current round, increments current_round, zeros per-outcome
--     pools, opens a fresh betting window) AND sets is_final_round=true.
--     So clicking "Final round" advances to round N+1 and opens
--     fresh betting on it; that round is the final one.
--
--   • `finish_event` on the multi-round branch now branches by
--     winning_outcome_ids:
--       – winners declared → call settle_round (pays out winners,
--         keeps prior settled-round payouts), mark finished.
--       – no winners declared → refund_round (cancel-style end),
--         mark finished.
--     winning_outcome_ids is preserved on the row so the
--     finished-event view can show who won the final round.
--
-- No data migration needed: existing finished/cancelled events
-- aren't touched. In-flight multi-round events that already had
-- the old mark_final_round called will benefit from the new
-- finish_event branching the next time the streamer clicks End
-- stream.

-- ---------------------------------------------------------------------------
-- 1. mark_final_round — settle + advance + reset window + set flag
-- ---------------------------------------------------------------------------
-- Mirrors advance_round line-for-line on the settle / advance /
-- reset side, with the only divergence being `is_final_round = true`
-- on the final UPDATE.

create or replace function public.mark_final_round(
  p_event_id        text,
  p_idempotency_key uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event public.events%rowtype;
  v_settle_result json;
  v_window_min integer;
  v_next_round integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = '23503';
  end if;
  if v_event.creator_id is null or v_event.creator_id <> v_user_id then
    raise exception 'Only the event creator can mark the final round'
      using errcode = '42501';
  end if;
  if v_event.round_format <> 'multi' then
    raise exception 'mark_final_round only applies to multi-round events'
      using errcode = '22023';
  end if;
  if v_event.status <> 'live' then
    raise exception 'Event must be live to mark final round (got %)', v_event.status
      using errcode = '22023';
  end if;
  if v_event.is_final_round then
    raise exception 'This event is already marked as final'
      using errcode = '22023';
  end if;

  -- Settle the round we're leaving (may auto-refund if minimums
  -- weren't met). Same call advance_round uses.
  v_settle_result := public.settle_round(
    p_event_id, v_event.current_round, p_idempotency_key
  );

  -- Advance to the next round AND mark it as the final one. Fresh
  -- pools, fresh betting window, no carried-over winning_outcome_ids
  -- from the just-settled round.
  v_next_round := v_event.current_round + 1;
  v_window_min := coalesce(v_event.betting_window_minutes, 10);

  update public.event_outcomes set pool_cents = 0 where event_id = p_event_id;

  update public.events
  set current_round            = v_next_round,
      is_final_round           = true,
      winning_outcome_ids      = null,
      betting_opens_at         = now(),
      betting_closes_at        = now() + make_interval(mins => v_window_min),
      betting_window_closed_at = null
  where id = p_event_id;

  return json_build_object(
    'event_id', p_event_id,
    'previous_round', v_event.current_round,
    'current_round', v_next_round,
    'is_final_round', true,
    'settlement', v_settle_result,
    'betting_window_minutes', v_window_min
  );
end;
$$;

grant execute on function public.mark_final_round(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. finish_event — multi-round branch settles final round on the way out
-- ---------------------------------------------------------------------------
-- Three multi-round end-states:
--
--   (a) Winners declared on the (final) round → settle_round so the
--       winners get their payouts queued, prior rounds keep their
--       settlements, mark finished. winning_outcome_ids stays on the
--       row so the post-event UI can render the result.
--
--   (b) No winners on the current round → refund the current round
--       (cancel-style end mid-stream OR streamer aborted the final
--       round without declaring), mark finished.
--
--   (c) idempotent_replay falls out naturally: settle_round's
--       per-key guard short-circuits if we somehow get called twice
--       (e.g. retry from the studio). The status guard at the top
--       blocks the second call entirely if status flipped to
--       'finished' the first time.

create or replace function public.finish_event(p_event_id text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_row        public.events;
  v_event      public.events%rowtype;
  v_has_bets   boolean;
  v_has_winner boolean;
  v_refund_count integer;
  v_settle_result json;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select *
  into v_event
  from public.events
  where id = p_event_id
    and creator_id = v_user_id
    and status = 'live';

  if v_event.id is null then
    raise exception 'Event not found, not yours, or not in live state'
      using errcode = '42501';
  end if;

  -- Multi-round branch.
  if v_event.round_format = 'multi' then
    v_has_winner := coalesce(
      array_length(v_event.winning_outcome_ids, 1), 0
    ) > 0;

    if v_has_winner then
      -- Final round (or any round) reaching finish_event with
      -- winners stamped: settle the round so winner / rake_streamer
      -- / rake_platform / residual payouts land in 'pending' for
      -- the admin to approve. Prior settled rounds keep their
      -- payouts (settle_round is per-round, scoped by round_index).
      v_settle_result := public.settle_round(
        p_event_id,
        v_event.current_round,
        gen_random_uuid()
      );
    else
      -- No winners on the current round → refund this round. Prior
      -- settled rounds untouched.
      v_refund_count := public.refund_round(p_event_id, v_event.current_round);
    end if;

    update public.events
    set status     = 'finished',
        settled_at = coalesce(settled_at, now())
    where id = p_event_id
    returning * into v_row;

    return v_row;
  end if;

  -- Single-round path (unchanged).
  select exists (
    select 1 from public.bets b where b.event_id = v_event.id
  ) into v_has_bets;

  v_has_winner := coalesce(array_length(v_event.winning_outcome_ids, 1), 0) > 0;

  if v_has_bets and not v_has_winner then
    return public.cancel_event(
      p_event_id,
      'auto_cancel: creator ended stream without declaring a winner'
    );
  end if;

  update public.events
  set status = 'finished'
  where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.finish_event(text) to authenticated;
