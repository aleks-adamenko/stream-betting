import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { notificationsKeys } from "@/hooks/useNotifications";
import { betsKeys } from "@/hooks/useMyBets";
import {
  markNotificationRead,
  type NotificationRow,
  type NotificationType,
} from "@/services/notificationsService";
import {
  NotificationStack,
  type StackItem,
} from "@/components/notifications/NotificationStack";
import type { ToastType } from "@/components/notifications/notificationTypeMeta";

/**
 * Top-centre notification provider for the user-app.
 *
 * Single Realtime channel filtered by `user_id = auth.uid()` against
 * `public.notifications`. Every INSERT becomes a card in an on-screen
 * stack (see <NotificationStack/>). Cards never auto-dismiss — the
 * viewer closes the front card with its X (or by tapping into the
 * event). Behaviour per type lives in TYPE_BEHAVIOUR below.
 *
 * Persistent rows (bet_placed / bet_won / bet_lost / bet_refunded /
 * welcome / new_follower / top_up) are visible on /notifications.
 * Ephemeral rows (event_starting / event_finished / round_starting)
 * still INSERT — the trigger / edge function writes them so we can
 * realtime-fan them out — but the Notifications page filters them
 * via PAGE_HIDDEN_TYPES.
 *
 * Provider also exposes `pushLocalToast()` for client-only cards
 * (e.g. the streamer self-bet warning, which has no DB row).
 */

interface NotificationsContextValue {
  /**
   * Imperative toast for client-side-only signals (no DB row).
   * Currently used by the placeBet error path to surface the
   * "Streamers cannot bet on their own event" warning via the
   * same card design as server-driven notifications.
   */
  pushLocalToast(input: LocalToastInput): void;
}

interface LocalToastInput {
  /**
   * `ToastType` = DB `NotificationType` ∪ client-only keys
   * (currently just "bet_limit"). The DB enum stays the source of
   * truth for persistent rows; client-only keys cover transient
   * UX paths that don't justify a migration.
   */
  type: ToastType;
  title: string;
  body?: string;
  eventId?: string | null;
  /**
   * @deprecated Cards no longer auto-dismiss — every card stays until
   * the viewer closes it. Kept so existing call sites still compile;
   * the value is ignored.
   */
  durationMs?: number;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/**
 * Behaviour table — single source of truth for per-type route-
 * suppression + clickability. Cards no longer auto-dismiss (the X is
 * the only escape), so there's no per-type duration anymore. Keep this
 * terse; render details live in NotificationToastCard.
 */
interface ToastBehaviour {
  /** When true, the entire card is a <Link> to /event/<id>. */
  clickable: boolean;
  /** If true, suppress the card when current pathname matches /event/<row.event_id>. */
  suppressOnEventPage: boolean;
}

const DEFAULT_BEHAVIOUR: ToastBehaviour = {
  clickable: false,
  suppressOnEventPage: false,
};

// Cap the on-screen stack so an inattentive viewer can't pile up an
// unbounded deck of never-dismissed cards. Pushing past this drops the
// oldest queued card; persistent types still live on /notifications.
const MAX_STACK = 8;

const TYPE_BEHAVIOUR: Partial<Record<NotificationType, ToastBehaviour>> = {
  // Bet-result cards are clickable so the viewer can jump into the
  // event page if they tap the card.
  bet_placed:   { clickable: true,  suppressOnEventPage: false },
  bet_won:      { clickable: true,  suppressOnEventPage: false },
  bet_lost:     { clickable: true,  suppressOnEventPage: false },
  bet_refunded: { clickable: true,  suppressOnEventPage: false },

  // Lifecycle cards — clickable to navigate. Suppressed when the user
  // is already on the event page since the page itself already tells
  // the story (round counter, live badge).
  event_starting: { clickable: true,  suppressOnEventPage: true },
  round_starting: { clickable: true,  suppressOnEventPage: true },
  // Reschedule — clickable so a tap navigates to the event page where
  // the updated countdown lives. Suppressed when already on
  // /event/<id> since the page header carries the new schedule.
  event_rescheduled: { clickable: true,  suppressOnEventPage: true },

  // Stream-ended — NotificationsProvider delays the push by 500ms below
  // so it stacks visibly above a simultaneous bet-result card for the
  // same event.
  event_finished: { clickable: false, suppressOnEventPage: false },

  // Welcome — inserted by handle_email_confirmed (user_app signups) and
  // activate_viewer (studio-first signups) at the moment the 100-coin
  // starter actually lands on the balance. The dismiss handler (passed
  // to NotificationStack via onDismiss below) marks the row read so it
  // doesn't re-fire on the next page load. Replay-on-mount in the
  // effect below ensures the card appears even when the row was
  // INSERTed before the realtime channel opened (magic-link flow).
  welcome:         { clickable: false, suppressOnEventPage: false },
  new_follower:    { clickable: false, suppressOnEventPage: false },
  top_up:          { clickable: false, suppressOnEventPage: false },
  rake_credited:   { clickable: false, suppressOnEventPage: false },
  payout_rejected: { clickable: false, suppressOnEventPage: false },
};

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();

  /**
   * Keep the latest pathname in a ref so the realtime callback always
   * reads the current value without re-binding the subscription on
   * every route change. React Router updates pathname on every nav;
   * the subscription is heavy enough that we don't want to tear it
   * down + recreate it constantly.
   */
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  /**
   * Track recently-fired bet-result toasts per event_id so the
   * paired event_finished toast can be scheduled 500ms later, giving
   * a stacked appearance (Sonner naturally stacks; we just stagger
   * the second push). Cleared after 5s — way past the 2s toast
   * lifetime.
   */
  const recentBetResultsRef = useRef<Map<string, number>>(new Map());

  /**
   * De-duplicate by row id. Realtime can occasionally re-deliver an
   * INSERT on reconnects; the in-flight toast queue ignores known
   * ids so a viewer never sees the same toast twice.
   */
  const seenIdsRef = useRef<Set<string>>(new Set());

  /**
   * Tracks which user.id we've already replayed the sticky welcome
   * toast for. Belt-and-suspenders for the userId-keyed useEffect
   * below — even if React re-runs the effect (Strict Mode in dev,
   * StateController shenanigans, etc.) we won't fire the welcome
   * twice in a single session. Resets on user change.
   */
  const welcomeReplayedRef = useRef<string | null>(null);

  // The on-screen stack (oldest → newest). NotificationStack renders
  // the newest as the front card; the rest peek behind it.
  const [items, setItems] = useState<StackItem[]>([]);
  // Monotonic counter for client-only cards (no DB row id to dedupe on).
  const localIdRef = useRef(0);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const pushItem = useCallback((item: StackItem) => {
    setItems((prev) => {
      // Replace an existing card with the same id (paranoia against a
      // double realtime delivery slipping past the seenIds dedupe).
      const without = prev.filter((it) => it.id !== item.id);
      const next = [...without, item];
      // Drop the oldest beyond the cap so the deck stays bounded.
      return next.length > MAX_STACK ? next.slice(next.length - MAX_STACK) : next;
    });
  }, []);

  const renderRow = useCallback(
    (row: NotificationRow) => {
      // Dedupe on row id.
      if (seenIdsRef.current.has(row.id)) return;
      seenIdsRef.current.add(row.id);
      // Light memory hygiene — keep at most 200 ids cached. The
      // toast is rendered, the row is in the DB; the set is only
      // protecting against immediate replay.
      if (seenIdsRef.current.size > 200) {
        const first = seenIdsRef.current.values().next().value;
        if (first) seenIdsRef.current.delete(first);
      }

      const behaviour = TYPE_BEHAVIOUR[row.type] ?? DEFAULT_BEHAVIOUR;

      // Route suppression: skip lifecycle toasts when the viewer is
      // already on the corresponding event page.
      if (
        behaviour.suppressOnEventPage &&
        row.event_id &&
        pathnameRef.current === `/event/${row.event_id}`
      ) {
        return;
      }

      // Sticky DB-backed types (welcome) need to be marked read on
      // dismiss so the replay-on-mount logic below doesn't re-fire
      // the same toast every time the user navigates. Other types
      // (auto-dismissing) keep their unread state for the bell badge
      // — the user reads them by visiting the Notifications page.
      const onDismiss =
        row.type === "welcome"
          ? () => {
              void markNotificationRead(row.id).then(() => {
                void queryClient.invalidateQueries({
                  queryKey: notificationsKeys.mine(),
                });
              });
            }
          : undefined;

      const push = () => {
        pushItem({
          id: row.id,
          type: row.type,
          title: row.title,
          body: row.body ?? null,
          eventId: row.event_id ?? null,
          clickable: behaviour.clickable,
          onDismiss,
        });
      };

      // Pair stream-ended with a just-fired bet-result for the same
      // event: delay 500ms so the cards stack visibly. If no recent
      // bet-result for this event, fire immediately.
      if (row.type === "event_finished" && row.event_id) {
        const recent = recentBetResultsRef.current.get(row.event_id);
        if (recent && Date.now() - recent < 2000) {
          setTimeout(push, 500);
        } else {
          push();
        }
      } else {
        push();
        if (
          row.event_id &&
          (row.type === "bet_won" ||
            row.type === "bet_lost" ||
            row.type === "bet_refunded")
        ) {
          recentBetResultsRef.current.set(row.event_id, Date.now());
          // Sweep older entries.
          setTimeout(() => {
            recentBetResultsRef.current.delete(row.event_id as string);
          }, 5000);
        }
      }

      // Keep the persistent feed + unread badge in sync — invalidate
      // the notifications query so the bell badge ticks up and the
      // /notifications list reflects the new row on next mount.
      void queryClient.invalidateQueries({ queryKey: notificationsKeys.mine() });

      // Bet-result rows mean the user's bet status flipped server-side
      // (settle_round / refund_round). Invalidate their bets cache so
      // My Bets / event page reflect the new status without a manual
      // refresh.
      if (
        row.type === "bet_won" ||
        row.type === "bet_lost" ||
        row.type === "bet_refunded"
      ) {
        void queryClient.invalidateQueries({ queryKey: betsKeys.mine() });
      }
    },
    [queryClient, pushItem],
  );

  // Subscribe once per user — opens a realtime channel filtered by
  // `user_id = auth.uid()`. Deferred via setTimeout to dodge React
  // Strict Mode's mount → cleanup → remount cycle (same pattern as
  // useEvents / useEventChat / useLiveOdds).
  // Depend on `user?.id` (the UUID string), NOT the `user` object
  // itself. Supabase auth auto-refreshes the JWT on tab focus, and
  // each refresh hands back a NEW user OBJECT with the same id —
  // shallow comparison on the object reference would re-fire this
  // effect on every focus, tearing down the channel and (worse)
  // wiping seenIdsRef in the cleanup, so the replay-on-mount below
  // would re-toast the same welcome row every time the viewer
  // switched tabs. Comparing the primitive id keeps the effect
  // stable across token refreshes.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (loading) return;
    if (!userId) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`notifications:user:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            renderRow(payload.new as NotificationRow);
          },
        )
        .subscribe();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (channel) void supabase.removeChannel(channel);
      // Only resets when the user identity ACTUALLY changes (sign-
      // out or different account signs in) — token refresh keeps the
      // same userId so this cleanup doesn't run, and seenIds stays
      // populated so a sticky welcome can't double-toast.
      seenIdsRef.current.clear();
      recentBetResultsRef.current.clear();
      // Drop any on-screen cards so one account's notifications don't
      // linger into the next account's session.
      setItems([]);
      // Reset welcome-replay marker so a different account signing
      // in can see their own welcome toast.
      welcomeReplayedRef.current = null;
    };
  }, [loading, userId, renderRow]);

  // ---- Replay-on-mount for sticky DB-backed notifications -----------
  //
  // The Realtime channel only delivers INSERTs that happen AFTER it
  // opens. Most notifications fall in that window (the trigger fires
  // while the viewer is on the page), but the welcome row is INSERTed
  // by handle_email_confirmed on the server side, typically BEFORE
  // the user's first user-app session opens its channel (magic-link
  // confirm → auth callback → home page → provider mounts).
  //
  // To catch that case, exactly once per user identity we fetch the
  // most-recent unread welcome row (RLS scopes to the caller, so the
  // result set is small and safe). If we find one, render it via the
  // same toast path. The onDismiss handler in renderRow marks it
  // read, so signing out + back in (different account) replays for
  // the new viewer; staying signed in across tab switches does NOT.
  //
  // welcomeReplayedRef captures which user.id we've already replayed
  // for — belt-and-suspenders even if React were to re-run the
  // effect for some other reason. Combined with the userId-only dep,
  // this guarantees one welcome toast per user session, not one per
  // tab focus.
  useEffect(() => {
    if (loading) return;
    if (!userId) return;
    if (welcomeReplayedRef.current === userId) return;
    welcomeReplayedRef.current = userId;

    let cancelled = false;

    const replay = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, user_id, type, title, body, event_id, read, created_at")
        .eq("user_id", userId)
        .eq("read", false)
        .eq("type", "welcome")
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;
      if (error) {
        console.warn("welcome replay fetch failed:", error.message);
        return;
      }
      const row = (data ?? [])[0] as NotificationRow | undefined;
      if (!row) return;

      // Defer one tick so this fires AFTER the realtime channel is
      // attached. If realtime ALSO delivers the same row (rare race
      // — the row was INSERTed just as the channel opened), the
      // seenIds dedupe in renderRow keeps it one-shot.
      setTimeout(() => {
        if (cancelled) return;
        renderRow(row);
      }, 100);
    };

    void replay();

    return () => {
      cancelled = true;
    };
  }, [loading, userId, renderRow]);

  const pushLocalToast = useCallback(
    (input: LocalToastInput) => {
      localIdRef.current += 1;
      pushItem({
        id: `local-${localIdRef.current}`,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        eventId: input.eventId ?? null,
        clickable: false,
      });
    },
    [pushItem],
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({ pushLocalToast }),
    [pushLocalToast],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <NotificationStack items={items} onClose={removeItem} />
    </NotificationsContext.Provider>
  );
}

/**
 * Hook to access the imperative pushLocalToast() — used by client-
 * side error handlers (placeBet's self-bet warning, etc.).
 *
 * Returns a no-op when called outside the provider so unit tests +
 * unmounted hooks don't crash; production always has the provider
 * mounted inside <AuthProvider> in App.tsx.
 */
export function useNotificationsToast(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    return { pushLocalToast: () => {} };
  }
  return ctx;
}
