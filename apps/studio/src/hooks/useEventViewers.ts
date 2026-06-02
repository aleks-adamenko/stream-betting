import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

// How long to hold a stale-higher count after the server tells us
// it's dropped. Covers the typical 200–1500 ms gap between a viewer
// reloading their tab (or routing away briefly) and the new socket
// rejoining the presence channel under the same key. The streamer
// should see a stable count, not a bouncing one.
const COUNT_DROP_HOLD_MS = 4000;

/**
 * Real-time viewer count for a single event, backed by a Supabase
 * Realtime presence channel.
 *
 * Channel name: `event:{eventId}:viewers` — shared between the studio
 * and the user-app so both ends see the same set of presence keys.
 *
 * Studio side specifics:
 *   - `track: false` so the creator never counts themselves.
 *   - `visibilitychange` + `focus` listeners force a fresh
 *     presenceState() read whenever the tab regains focus, so a
 *     streamer who alt-tabs away and comes back doesn't see a
 *     stale number while the channel catches up.
 *   - Drop-debounce: any decrease from the previous count is held
 *     for COUNT_DROP_HOLD_MS, then re-read against the latest
 *     presenceState(). Smooths out the typical viewer reload
 *     bounce (leave → join under the same key within 1 s).
 *
 * @param eventId   The event to track. When undefined the hook is a
 *                  no-op so it's safe to call before data has loaded.
 * @param track     When true, this client registers itself as a viewer
 *                  (typical for the user-app event page). When false
 *                  the client only observes (typical for the studio's
 *                  LiveStream view — the creator shouldn't count).
 *
 * Returns the current viewer count.
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

  // Channel + drop-timer refs need to survive across renders so the
  // debounce timer can re-read the latest presence state at apply
  // time, and the visibility handler can force a fresh sync read.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Centralised count setter — applies increases immediately, holds
  // decreases for COUNT_DROP_HOLD_MS in case the leave is really a
  // transient reload race. At the deadline we re-read presenceState()
  // rather than committing the captured value, so any join that
  // arrived in the meantime is reflected.
  const applyCount = useCallback((fresh: number) => {
    setCount((prev) => {
      if (fresh >= prev) {
        if (dropTimerRef.current) {
          clearTimeout(dropTimerRef.current);
          dropTimerRef.current = null;
        }
        return fresh;
      }
      if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
      dropTimerRef.current = setTimeout(() => {
        const latest = channelRef.current?.presenceState();
        if (latest) setCount(Object.keys(latest).length);
        dropTimerRef.current = null;
      }, COUNT_DROP_HOLD_MS);
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!eventId) return;

    // Defer channel setup so React Strict Mode's mount/unmount/remount
    // cycle doesn't collide with Supabase's "cannot add presence
    // callbacks after subscribe()" error.
    let cancelled = false;

    // Force a fresh read of presenceState when the streamer's tab
    // regains focus. The channel auto-reconnects on network drops,
    // but the local UI can show a stale number until the next sync
    // event fires; this short-circuits the wait.
    const resync = () => {
      const state = channelRef.current?.presenceState();
      if (state) applyCount(Object.keys(state).length);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") resync();
    };

    const setupId = setTimeout(() => {
      if (cancelled) return;

      const channel = supabase.channel(`event:${eventId}:viewers`, {
        config: { presence: { key: clientIdRef.current! } },
      });
      channelRef.current = channel;

      channel
        .on("presence", { event: "sync" }, () => {
          // Each presence key is a unique viewer. Object.keys gives
          // us the distinct count.
          const state = channel.presenceState();
          applyCount(Object.keys(state).length);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED" && options.track) {
            await channel.track({ at: new Date().toISOString() });
          }
        });

      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("focus", onVisibilityChange);
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (dropTimerRef.current) {
        clearTimeout(dropTimerRef.current);
        dropTimerRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [eventId, options.track, applyCount]);

  return count;
}
