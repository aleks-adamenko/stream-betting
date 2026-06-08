import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/**
 * Settlement-readiness gauge for a single event — studio mirror of
 * the user-app hook of the same name.
 *
 * Wraps the `get_event_progress` RPC + a Realtime subscription on
 * `event_outcomes` so the three settle guards stay fresh on the
 * streamer's screen as new bets land. We want the readiness
 * checklist on the LiveStream page to tick over in real time — no
 * manual refresh, no 5-second polling lag.
 *
 * Why `event_outcomes` UPDATE (not `bets` INSERT)?
 *   • `place_bet` increments `event_outcomes.pool_cents` and
 *     `bets_count` on every bet — so an UPDATE is broadcast for
 *     every new bet. Subscribing to the outcomes table is enough.
 *   • `bets` isn't in the `supabase_realtime` publication, and RLS
 *     on `bets` would filter the streamer's view anyway. Refetching
 *     `get_event_progress` on every outcomes UPDATE recomputes
 *     `unique_bettors` server-side, so we still get fresh counts
 *     for the participants guard.
 *
 * Strict Mode protection: deferred setup + cancel guard matches the
 * useLiveOdds / user-app useEventProgress patterns — channels can
 * land in "joined" state mid-mount cycle otherwise and the second
 * `.on(...)` call throws.
 */

export interface EventProgress {
  uniqueBettors: number;
  outcomesWithBets: number;
  totalPoolCents: number;
  numOutcomes: number;
  minUniqueBettors: number;
  minOutcomesWithBets: number;
  minPoolCents: number;
  minimumsMet: boolean;
}

const EMPTY: EventProgress = {
  uniqueBettors: 0,
  outcomesWithBets: 0,
  totalPoolCents: 0,
  numOutcomes: 0,
  minUniqueBettors: 0,
  minOutcomesWithBets: 0,
  minPoolCents: 0,
  minimumsMet: false,
};

export function useEventProgress(eventId: string | undefined): {
  data: EventProgress;
  loading: boolean;
} {
  const [data, setData] = useState<EventProgress>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) {
      setData(EMPTY);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    setLoading(true);

    const fetchProgress = async () => {
      const { data: rows, error } = await supabase.rpc("get_event_progress", {
        p_event_id: eventId,
      });
      if (cancelled) return;
      if (error) {
        console.warn("get_event_progress failed", error);
        return;
      }
      const row = Array.isArray(rows) ? rows[0] : (rows as unknown);
      if (!row) {
        setData(EMPTY);
        setLoading(false);
        return;
      }
      const r = row as {
        unique_bettors_count: number;
        outcomes_with_bets_count: number;
        total_pool_cents: number | string;
        num_outcomes: number;
        min_unique_bettors: number;
        min_outcomes_with_bets: number;
        min_pool_cents: number | string;
        minimums_met: boolean;
      };
      setData({
        uniqueBettors: Number(r.unique_bettors_count ?? 0),
        outcomesWithBets: Number(r.outcomes_with_bets_count ?? 0),
        totalPoolCents: Number(r.total_pool_cents ?? 0),
        numOutcomes: Number(r.num_outcomes ?? 0),
        minUniqueBettors: Number(r.min_unique_bettors ?? 0),
        minOutcomesWithBets: Number(r.min_outcomes_with_bets ?? 0),
        minPoolCents: Number(r.min_pool_cents ?? 0),
        minimumsMet: !!r.minimums_met,
      });
      setLoading(false);
    };

    void fetchProgress();

    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`event_progress:${eventId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "event_outcomes",
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            void fetchProgress();
          },
        )
        // Multi-round: refetch when events.current_round changes
        // (advance_round / mark_final_round) so the readiness panel
        // flips back to red the instant the new round opens, even
        // before any new bets land. Without this the panel would
        // still show green until the first new-round bet bumped
        // event_outcomes.pool_cents.
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "events",
            filter: `id=eq.${eventId}`,
          },
          () => {
            void fetchProgress();
          },
        )
        .subscribe();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [eventId]);

  return { data, loading };
}
