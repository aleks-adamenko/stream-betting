import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/**
 * Real-time viewer count for a single event, backed by a Supabase
 * Realtime presence channel.
 *
 * Channel name: `event:{eventId}:viewers` — shared between the
 * user-app event page and the studio's LiveStream view so both ends
 * see the same set of presence keys.
 *
 * @param eventId   The event to track. When undefined the hook is a
 *                  no-op so it's safe to call before data has loaded.
 * @param track     When true, this client registers itself as a viewer
 *                  (typical for the user-app event page). When false
 *                  the client only observes.
 *
 * Returns the current viewer count, refreshed instantly on every
 * presence sync (join, leave, refresh) with no polling.
 */
export function useEventViewers(
  eventId: string | undefined,
  options: { track: boolean },
): number {
  const [count, setCount] = useState(0);
  // One unique presence key per hook instance — two tabs of the same
  // event therefore count as two viewers.
  const clientIdRef = useRef<string | null>(null);
  if (!clientIdRef.current) {
    clientIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
  }

  useEffect(() => {
    if (!eventId) return;

    // React Strict Mode in dev mounts → unmounts → remounts effects
    // synchronously. Supabase channels can land in a "joined" state
    // mid-cycle, which makes follow-up `.on()` calls throw "cannot add
    // presence callbacks after subscribe()". Deferring channel setup
    // to a microtask lets the cleanup of the first mount resolve
    // before we wire the new channel.
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupId = setTimeout(() => {
      if (cancelled) return;

      channel = supabase.channel(`event:${eventId}:viewers`, {
        config: { presence: { key: clientIdRef.current! } },
      });

      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel!.presenceState();
          setCount(Object.keys(state).length);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED" && options.track) {
            await channel!.track({ at: new Date().toISOString() });
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [eventId, options.track]);

  return count;
}
