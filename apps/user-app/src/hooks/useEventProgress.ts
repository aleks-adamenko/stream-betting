import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/**
 * Settlement-readiness gauge for a single event.
 *
 * Wraps the `get_event_progress` RPC + the Realtime channel on
 * `event_outcomes`, so the readiness state stays fresh as new bets
 * land. Mirrors useLiveOdds's Strict Mode pattern (deferred setup +
 * cancel guard).
 *
 * The bet panel uses `minimums_met` to gate odds display: until all
 * three settle guards pass (unique bettors, distinct outcomes with
 * bets, MIN_POOL), the panel renders "Open" everywhere + a "min X
 * bettors · min Y outcomes · min $Z pool" caption.
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
        // Multi-round: when advance_round / mark_final_round bumps
        // events.current_round, the RPC now scopes counts to the new
        // round and we need an immediate refetch so the readiness
        // gauge resets in the same tick the round changes. The
        // event_outcomes pool_cents reset usually fires first, but
        // subscribing to events too removes any ordering surprise.
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
