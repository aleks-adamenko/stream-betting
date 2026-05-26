-- LiveRush — per-event real-time chat.
--
-- One append-only table that everyone can read and signed-in users can
-- post into through a SECURITY DEFINER RPC. The RPC enforces a 1-280
-- char body, snapshots the poster's display_name + avatar_url at post
-- time (so historical chat doesn't change when the author renames),
-- and refuses messages for events that aren't in ('scheduled','live')
-- so finished / draft events can't be chatted on.
--
-- The table is added to the `supabase_realtime` publication so the
-- studio LiveStream view and the user-app event page can subscribe
-- to INSERT events and render new chat lines without polling.

create table if not exists public.event_chat_messages (
  id            uuid primary key default gen_random_uuid(),
  event_id      text not null references public.events(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  display_name  text,
  avatar_url    text,
  body          text not null check (char_length(trim(body)) between 1 and 280),
  created_at    timestamptz not null default now()
);

create index if not exists event_chat_messages_event_idx
  on public.event_chat_messages(event_id, created_at desc);

alter table public.event_chat_messages enable row level security;

-- Read: anyone (anon + authenticated) can read chat for any event.
drop policy if exists "Public reads event chat" on public.event_chat_messages;
create policy "Public reads event chat"
  on public.event_chat_messages
  for select
  to anon, authenticated
  using (true);

-- Writes go through the SECURITY DEFINER RPC only — no direct INSERT
-- policy. (Anon writes are blocked by RLS by default.)

create or replace function public.send_chat_message(
  p_event_id text,
  p_body text
)
returns public.event_chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_display_name text;
  v_avatar_url text;
  v_body text;
  v_row public.event_chat_messages;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_body := trim(coalesce(p_body, ''));
  if char_length(v_body) < 1 or char_length(v_body) > 280 then
    raise exception 'Chat message must be 1-280 characters' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.events
    where id = p_event_id and status in ('scheduled','live')
  ) then
    raise exception 'Event is not accepting chat right now' using errcode = '42501';
  end if;

  -- Snapshot poster identity at post time so historical chat stays
  -- stable when the user later renames or changes their avatar.
  select display_name, avatar_url into v_display_name, v_avatar_url
  from public.profiles where id = v_user_id;

  insert into public.event_chat_messages (
    event_id, user_id, display_name, avatar_url, body
  ) values (
    p_event_id, v_user_id, v_display_name, v_avatar_url, v_body
  )
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.send_chat_message(text, text) to authenticated;

-- Register the table on Supabase's Realtime publication so the studio
-- and user-app can subscribe to INSERTs. The DO block makes the
-- ALTER idempotent — re-running the migration won't error.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_chat_messages'
  ) then
    alter publication supabase_realtime add table public.event_chat_messages;
  end if;
end
$$;
