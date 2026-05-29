import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/**
 * Live pari-mutuel odds for every outcome on a single event.
 *
 * Data flow:
 *   1. Initial fetch via the `compute_live_odds` RPC — returns the
 *      pool snapshot + per-outcome live odds.
 *   2. Supabase Realtime subscription on UPDATE events to
 *      `event_outcomes` filtered by event_id. Every bet on this event
 *      bumps an outcome's `pool_cents`, which broadcasts an UPDATE,
 *      which causes us to re-run the RPC.
 *
 * Why re-fetch instead of recomputing locally on the UPDATE payload:
 * the live-odds formula needs the *total* pool across all outcomes,
 * which a single UPDATE doesn't carry. The RPC is a single index seek
 * + small aggregate, so it's cheaper than transporting every outcome
 * row on every tick.
 *
 * Mirrors the Strict Mode safety pattern from useEventViewers /
 * useEventChat (deferred microtask setup so the dev-mode mount →
 * cleanup → remount sequence doesn't trip the "cannot add callbacks
 * after subscribe()" guard).
 */

export interface OutcomeOdds {
  outcome_id: string;
  pool_cents: number;
  live_odds: number | null;
}

export interface LiveOddsSnapshot {
  outcomes: OutcomeOdds[];
  totalPoolCents: number;
}

export function useLiveOdds(eventId: string | undefined): {
  data: LiveOddsSnapshot;
  loading: boolean;
} {
  const [data, setData] = useState<LiveOddsSnapshot>({
    outcomes: [],
    totalPoolCents: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) {
      setData({ outcomes: [], totalPoolCents: 0 });
      setLoading(false);
      return;
    }

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    setLoading(true);

    const fetchOdds = async () => {
      const { data: rows, error } = await supabase.rpc("compute_live_odds", {
        p_event_id: eventId,
      });
      if (cancelled) return;
      if (error) {
        console.warn("compute_live_odds failed", error);
        return;
      }
      const list = (rows ?? []) as Array<{
        outcome_id: string;
        pool_cents: number | string;
        total_pool_cents: number | string;
        live_odds: number | string | null;
      }>;
      const outcomes: OutcomeOdds[] = list.map((r) => ({
        outcome_id: String(r.outcome_id),
        pool_cents: Number(r.pool_cents ?? 0),
        live_odds:
          r.live_odds === null || r.live_odds === undefined
            ? null
            : Number(r.live_odds),
      }));
      const totalPoolCents = Number(list[0]?.total_pool_cents ?? 0);
      setData({ outcomes, totalPoolCents });
      setLoading(false);
    };

    void fetchOdds();

    // Defer channel setup to a microtask so Strict Mode mount/cleanup
    // ordering doesn't trip Supabase's "callbacks after subscribe"
    // guard.
    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`event_odds:${eventId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "event_outcomes",
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            // Any UPDATE on this event's outcomes invalidates our
            // snapshot — re-run the RPC.
            void fetchOdds();
          },
        )
        .subscribe();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [eventId]);

  return { data, loading };
}
