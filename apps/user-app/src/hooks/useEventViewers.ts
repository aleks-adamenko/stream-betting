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
 * Resilience:
 *   - The first track() is awaited inside the subscribe callback.
 *   - A heartbeat re-tracks every 30s so a paused tab / backgrounded
 *     PWA / mobile-sleep doesn't silently drop the entry from the
 *     server-side state.
 *   - `visibilitychange` and `focus` listeners force an immediate
 *     re-track when the tab comes back, so a viewer who tab-switches
 *     and returns within seconds doesn't blink off the counter on
 *     the streamer's screen.
 *   - On every presence `sync` we check that our own clientId is in
 *     the state — if not (e.g. server kicked the entry due to inactivity),
 *     we re-track to recover.
 *
 * @param eventId   The event to track. When undefined the hook is a
 *                  no-op so it's safe to call before data has loaded.
 * @param track     When true, this client registers itself as a viewer
 *                  (typical for the user-app event page). When false
 *                  the client only observes.
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

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let heartbeatId: ReturnType<typeof setInterval> | null = null;

    // Shared helper — call this any time we need to re-assert our
    // presence (initial subscribe, heartbeat, tab refocus, recovery
    // after sync mismatch).
    const sendTrack = () => {
      if (!channel || !options.track) return;
      void channel.track({ at: new Date().toISOString() });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        sendTrack();
      }
    };

    // React Strict Mode in dev mounts → unmounts → remounts effects
    // synchronously. Supabase channels can land in a "joined" state
    // mid-cycle, which makes follow-up `.on()` calls throw "cannot add
    // presence callbacks after subscribe()". Deferring channel setup
    // to a microtask lets the cleanup of the first mount resolve
    // before we wire the new channel.
    const setupId = setTimeout(() => {
      if (cancelled) return;

      channel = supabase.channel(`event:${eventId}:viewers`, {
        config: { presence: { key: clientIdRef.current! } },
      });

      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel!.presenceState();
          setCount(Object.keys(state).length);
          // Self-heal: if the server dropped our entry (idle timeout,
          // sketchy reconnect), we won't be in the state map. Re-track
          // to put ourselves back without waiting for the next heartbeat.
          if (options.track && !state[clientIdRef.current!]) {
            sendTrack();
          }
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED" && options.track) {
            await channel!.track({ at: new Date().toISOString() });
          }
        });

      // 30-second heartbeat. Cheap; mostly a no-op on the server side
      // when the entry already exists. Crucial when the browser tab
      // is backgrounded for a while — the next foreground tick re-asserts.
      if (options.track) {
        heartbeatId = setInterval(sendTrack, 30_000);
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("focus", onVisibilityChange);
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (heartbeatId) clearInterval(heartbeatId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [eventId, options.track]);

  return count;
}
