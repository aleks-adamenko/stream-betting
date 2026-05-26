import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/**
 * Real-time viewer count for a single event, backed by a Supabase
 * Realtime presence channel.
 *
 * Channel name: `event:{eventId}:viewers` — shared between the studio
 * and the user-app so both ends see the same set of presence keys.
 *
 * @param eventId   The event to track. When undefined the hook is a
 *                  no-op so it's safe to call before data has loaded.
 * @param track     When true, this client registers itself as a viewer
 *                  (typical for the user-app event page). When false
 *                  the client only observes (typical for the studio's
 *                  LiveStream view — the creator shouldn't count).
 *
 * Returns the current viewer count. Updates instantly on every
 * presence sync event (join, leave, refresh) with no polling.
 */
export function useEventViewers(
  eventId: string | undefined,
  options: { track: boolean },
): number {
  const [count, setCount] = useState(0);
  // One unique presence key per hook instance. Each browser tab gets
  // its own key, so two tabs of the same event count as two viewers.
  const clientIdRef = useRef<string | null>(null);
  if (!clientIdRef.current) {
    clientIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
  }

  useEffect(() => {
    if (!eventId) return;

    // Defer channel setup so React Strict Mode's mount/unmount/remount
    // cycle doesn't collide with Supabase's "cannot add presence
    // callbacks after subscribe()" error.
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
          // Each presence key is a unique viewer. Object.keys gives
          // us the distinct count.
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
