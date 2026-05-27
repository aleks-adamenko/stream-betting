-- LiveRush — register `events` on Supabase Realtime so status flips
-- propagate to viewers without a page reload.
--
-- When the creator hits End stream, finish_event flips
-- events.status from 'live' → 'finished'. Without Realtime the
-- viewer on the user-app keeps showing the live player until they
-- refresh. Adding the table to the supabase_realtime publication
-- means UPDATE events broadcast over the wire, and the
-- EventDetails page can subscribe + invalidate its React Query
-- cache so the page re-renders into the finished state.
--
-- DO block is idempotent — re-running the migration is a no-op.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end
$$;
