import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// sessionStorage key for the anon presence id. Per-tab, survives
// reload (we want a reload to count as the same viewer, not a fresh
// one) but doesn't carry across tabs (each open tab is genuinely
// a separate viewer of the stream).
const ANON_KEY_STORAGE = "liverush:viewer-presence-id";

// How long to hold a stale-higher count after the server tells us
// it's dropped. Covers the typical 200–1500 ms gap between an old
// WebSocket dying (page reload / route change) and the new socket
// rejoining the presence channel under the same key. If the rejoin
// arrives inside this window we never show the bounce; if it doesn't
// we commit the actual lower count.
const COUNT_DROP_HOLD_MS = 4000;

function getOrCreateAnonKey(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  try {
    const existing = window.sessionStorage.getItem(ANON_KEY_STORAGE);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    window.sessionStorage.setItem(ANON_KEY_STORAGE, fresh);
    return fresh;
  } catch {
    // sessionStorage unavailable (private mode, embedded webview) —
    // fall back to in-memory uuid; reload will still bump the count
    // but at least multi-tab is correct.
    return crypto.randomUUID();
  }
}

/**
 * Real-time viewer count for a single event, backed by a Supabase
 * Realtime presence channel.
 *
 * Channel name: `event:{eventId}:viewers` — shared between the
 * user-app event page and the studio's LiveStream view so both ends
 * see the same set of presence keys.
 *
 * Resilience:
 *   - Stable presence key per viewer: `user.id` when signed in (so
 *     a reload / route change keeps the same identity), else a
 *     sessionStorage uuid (per-tab, survives reload).
 *   - 30 s heartbeat re-asserts the entry so a paused tab /
 *     backgrounded PWA / mobile-sleep doesn't silently drop it.
 *   - `visibilitychange` and `focus` listeners force an immediate
 *     re-track when the tab comes back.
 *   - Self-heal on sync mismatch: if our own key isn't in the
 *     presence state map after a sync, we re-track without waiting
 *     for the next heartbeat.
 *   - Drop-debounce: when sync reports a count lower than what we
 *     last showed, we hold the previous number for up to
 *     COUNT_DROP_HOLD_MS and re-read state at the deadline. Smooths
 *     out the typical reload / route-change bounce where a viewer
 *     leaves and rejoins under the same key inside a second.
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
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  // Presence key resolution:
  //   • Logged-in user → user.id. Each user counts as one regardless
  //     of how many tabs / reloads they have. A reload no longer
  //     bumps the viewer count.
  //   • Anonymous viewer → sessionStorage-backed uuid that survives
  //     within the tab across reloads but doesn't cross tabs.
  const clientIdRef = useRef<string | null>(null);
  const clientId = user?.id ?? (clientIdRef.current ??= getOrCreateAnonKey());
  clientIdRef.current = clientId;

  // Channel + drop-timer refs need to survive across renders so the
  // debounce timer can re-read the latest presence state at apply
  // time.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Centralised count setter — applies increases immediately, but
  // holds decreases for COUNT_DROP_HOLD_MS in case the leave is
  // really a transient reload / route-change race. At the deadline
  // we re-read presenceState() rather than committing the captured
  // value so any join that arrived in the meantime is reflected.
  const applyCount = useCallback((fresh: number) => {
    setCount((prev) => {
      if (fresh >= prev) {
        // Up or flat — show immediately, cancel any pending drop.
        if (dropTimerRef.current) {
          clearTimeout(dropTimerRef.current);
          dropTimerRef.current = null;
        }
        return fresh;
      }
      // Drop — schedule a deferred re-read.
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

    let cancelled = false;
    let heartbeatId: ReturnType<typeof setInterval> | null = null;

    // Shared helper — call this any time we need to re-assert our
    // presence (initial subscribe, heartbeat, tab refocus, recovery
    // after sync mismatch).
    const sendTrack = () => {
      if (!channelRef.current || !options.track) return;
      void channelRef.current.track({ at: new Date().toISOString() });
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

      const channel = supabase.channel(`event:${eventId}:viewers`, {
        config: { presence: { key: clientIdRef.current! } },
      });
      channelRef.current = channel;

      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState();
          applyCount(Object.keys(state).length);
          // Self-heal: if the server dropped our entry (idle timeout,
          // sketchy reconnect), we won't be in the state map. Re-track
          // to put ourselves back without waiting for the next heartbeat.
          if (options.track && !state[clientIdRef.current!]) {
            sendTrack();
          }
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED" && options.track) {
            await channel.track({ at: new Date().toISOString() });
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
    // clientId is included so a sign-in mid-page (anon → authed)
    // rebinds the channel with the user's stable key.
  }, [eventId, options.track, clientId, applyCount]);

  return count;
}
