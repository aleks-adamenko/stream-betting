-- Re-enable the notifications dispatch trigger.
--
-- We temporarily disabled `events_notify` during a streaming-debug
-- session earlier today to rule out a hypothesised side-effect on
-- the publisher path. The trigger turned out to be uninvolved (the
-- actual bug was macOS Chrome's mic-permission state), so the
-- trigger needs to come back on so live / scheduled notifications
-- fire again when events flip state.
--
-- ALTER TABLE ... ENABLE TRIGGER is idempotent — running it when
-- the trigger is already enabled is a no-op.

alter table public.events enable trigger events_notify;
