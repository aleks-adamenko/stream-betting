-- LiveRush — relax delete_event so terminal-state events with zero
-- bets can be hard-deleted.
--
-- Why: the previous tightening (000005_event_archive) restricted
-- delete to drafts only — but a finished / cancelled event that
-- nobody actually bet on has no ledger history, no payouts, no
-- bets. Archiving it just clutters the Archived tab forever.
--
-- New rule:
--   delete_event allows status IN ('draft', 'finished', 'cancelled')
--   AND no rows exist in `bets` referencing this event.
--
-- Everything mid-flight (live, scheduled, pending_moderation, settled)
-- still rejects — those are either active or have committed financial
-- history and must go through archive_event.

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
    and (
      status = 'draft'
      or (
        status in ('finished', 'cancelled')
        and not exists (
          select 1 from public.bets where event_id = p_event_id
        )
      )
    );

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Only drafts or empty (no-bets) finished/cancelled events can be deleted. Use archive_event otherwise.'
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.delete_event(text) to authenticated;

notify pgrst, 'reload schema';
