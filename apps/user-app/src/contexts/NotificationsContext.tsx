import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { notificationsKeys } from "@/hooks/useNotifications";
import { betsKeys } from "@/hooks/useMyBets";
import {
  markNotificationRead,
  type NotificationRow,
  type NotificationType,
} from "@/services/notificationsService";
import { NotificationToastCard } from "@/components/notifications/NotificationToastCard";

/**
 * Top-centre toast notification provider for the user-app.
 *
 * Single Realtime channel filtered by `user_id = auth.uid()` against
 * `public.notifications`. Every INSERT becomes a Sonner toast.
 * Behaviour per type lives in TYPE_BEHAVIOUR below.
 *
 * Persistent rows (bet_placed / bet_won / bet_lost / bet_refunded /
 * welcome / new_follower / top_up) are visible on /notifications.
 * Ephemeral rows (event_starting / event_finished / round_starting)
 * still INSERT — the trigger / edge function writes them so we can
 * realtime-fan them out — but the Notifications page filters them
 * via PAGE_HIDDEN_TYPES.
 *
 * Provider also exposes `pushLocalToast()` for client-only toasts
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
  type: NotificationType;
  title: string;
  body?: string;
  eventId?: string | null;
  /** Default 3000ms for local toasts; pass Infinity for sticky. */
  durationMs?: number;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/**
 * Behaviour table — single source of truth for per-type duration +
 * route-suppression + clickability. Keep this terse; render details
 * live in NotificationToastCard.
 */
interface ToastBehaviour {
  /** undefined → use Sonner's default; Infinity → sticky (no auto-dismiss). */
  durationMs: number | undefined;
  /** When true, the entire card is a <Link> to /event/<id>. */
  clickable: boolean;
  /** If true, suppress the toast when current pathname matches /event/<row.event_id>. */
  suppressOnEventPage: boolean;
}

const DEFAULT_BEHAVIOUR: ToastBehaviour = {
  durationMs: 2000,
  clickable: false,
  suppressOnEventPage: false,
};

const TYPE_BEHAVIOUR: Partial<Record<NotificationType, ToastBehaviour>> = {
  // Persistent + auto-dismiss after 2s. Clickable so the viewer can
  // jump into the event page if they tap the card.
  bet_placed:   { durationMs: 2000, clickable: true,  suppressOnEventPage: false },
  bet_won:      { durationMs: 2000, clickable: true,  suppressOnEventPage: false },
  bet_lost:     { durationMs: 2000, clickable: true,  suppressOnEventPage: false },
  bet_refunded: { durationMs: 2000, clickable: true,  suppressOnEventPage: false },

  // Ephemeral lifecycle — sticky (no auto-dismiss). User has to
  // click the card (to navigate) or the X to dismiss. Suppressed
  // when the user is already on the event page since the page
  // itself already tells the story (round counter, live badge).
  event_starting: { durationMs: Infinity, clickable: true,  suppressOnEventPage: true },
  round_starting: { durationMs: Infinity, clickable: true,  suppressOnEventPage: true },

  // Ephemeral stream-ended — short auto-dismiss. NotificationsProvider
  // delays the push by 500ms below so it stacks visibly under a
  // simultaneous bet-result toast for the same event.
  event_finished: { durationMs: 2000, clickable: false, suppressOnEventPage: false },

  // Welcome — sticky. Inserted by handle_email_confirmed (user_app
  // signups) and activate_viewer (studio-first signups) at the
  // moment the 100-coin starter actually lands on the balance.
  // The toast stays until the viewer dismisses; the dismiss
  // handler (passed to NotificationToastCard via onDismiss below)
  // marks the row as read so it doesn't re-fire on the next page
  // load. Replay-on-mount in the effect below ensures the toast
  // appears even when the row was INSERTed before the realtime
  // channel opened (the typical magic-link flow).
  welcome:         { durationMs: Infinity, clickable: false, suppressOnEventPage: false },
  new_follower:    { durationMs: 3000, clickable: false, suppressOnEventPage: false },
  top_up:          { durationMs: 3000, clickable: false, suppressOnEventPage: false },
  rake_credited:   { durationMs: 3000, clickable: false, suppressOnEventPage: false },
  payout_rejected: { durationMs: 5000, clickable: false, suppressOnEventPage: false },
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
        toast.custom(
          (toastId) => (
            <NotificationToastCard
              toastId={toastId}
              type={row.type}
              title={row.title}
              body={row.body ?? null}
              eventId={row.event_id ?? null}
              clickable={behaviour.clickable}
              onDismiss={onDismiss}
            />
          ),
          {
            duration:
              behaviour.durationMs === Infinity
                ? Number.MAX_SAFE_INTEGER
                : behaviour.durationMs,
          },
        );
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
    [queryClient],
  );

  // Subscribe once per user — opens a realtime channel filtered by
  // `user_id = auth.uid()`. Deferred via setTimeout to dodge React
  // Strict Mode's mount → cleanup → remount cycle (same pattern as
  // useEvents / useEventChat / useLiveOdds).
  useEffect(() => {
    if (loading) return;
    if (!user) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`notifications:user:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
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
      // Reset dedupe state when the user changes — otherwise after
      // sign-out + sign-in we'd silently swallow the welcome toast.
      seenIdsRef.current.clear();
      recentBetResultsRef.current.clear();
    };
  }, [loading, user, renderRow]);

  // ---- Replay-on-mount for sticky DB-backed notifications -----------
  //
  // The Realtime channel only delivers INSERTs that happen AFTER it
  // opens. Most notifications fall in that window (the trigger fires
  // while the viewer is on the page), but the welcome row is INSERTed
  // by handle_email_confirmed on the server side, typically BEFORE
  // the user's first user-app session opens its channel (magic-link
  // confirm → auth callback → home page → provider mounts).
  //
  // To catch that case, on each mount-or-user-change we fetch the
  // most-recent unread welcome row (RLS scopes to the caller, so the
  // result set is small and safe). If we find one, render it via the
  // same toast path. The onDismiss handler in renderRow marks it
  // read, so the next mount won't re-fire it.
  useEffect(() => {
    if (loading) return;
    if (!user) return;

    let cancelled = false;

    const replay = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, user_id, type, title, body, event_id, read, created_at")
        .eq("user_id", user.id)
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
  }, [loading, user, renderRow]);

  const pushLocalToast = useCallback((input: LocalToastInput) => {
    const duration = input.durationMs ?? 3000;
    toast.custom(
      (toastId) => (
        <NotificationToastCard
          toastId={toastId}
          type={input.type}
          title={input.title}
          body={input.body ?? null}
          eventId={input.eventId ?? null}
          clickable={false}
        />
      ),
      {
        duration: duration === Infinity ? Number.MAX_SAFE_INTEGER : duration,
      },
    );
  }, []);

  const value = useMemo<NotificationsContextValue>(
    () => ({ pushLocalToast }),
    [pushLocalToast],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
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
