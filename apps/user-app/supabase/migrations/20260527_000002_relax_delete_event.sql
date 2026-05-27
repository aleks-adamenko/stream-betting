-- LiveRush — let creators delete finished + cancelled events from the
-- list, not just drafts.
--
-- The original `delete_event` only allowed draft deletions. That made
-- sense before lifecycle existed, but now finished events pile up in
-- the studio list and the creator has no way to clear them. We open
-- the door to draft / finished / cancelled deletion.
--
-- Statuses that STAY locked:
--   • scheduled — has a provisioned Cloudflare live input on the other
--     side. Deleting the event would CASCADE the event_streams row
--     but leak the Cloudflare resource. If we ever want to support
--     "unpublish a scheduled event" we need a wrapper that goes
--     through the end-stream Edge Function first, then deletes the row.
--   • live — actively broadcasting. Destructive.
--
-- For finished events, the corresponding event_streams row has
-- already been removed by the end-stream Edge Function, so the
-- on-delete-cascade is a no-op on the Cloudflare side. Safe.

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
    and status in ('draft', 'finished', 'cancelled');

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Event not found, not yours, or not deletable'
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.delete_event(text) to authenticated;

notify pgrst, 'reload schema';
