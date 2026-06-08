import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * Per-round results for a finished multi-round event. Backs the
 * round switcher in FinishedPanel — single-round events still use
 * the live `useLiveOdds` + event.winningOutcomeIds path.
 *
 * Each round row carries:
 *   • `roundIndex`         — 1-based round number, ordered ascending.
 *   • `wasRefunded`        — every bet in this round refunded
 *                            (settle_round short-circuited on
 *                            minimums). UI suppresses winner
 *                            highlights when true.
 *   • `winningOutcomeIds`  — derived from bets.status (any bet on
 *                            this outcome with status='won_pending_
 *                            payout' or 'won' marks the outcome as
 *                            a winner for that round).
 *   • `outcomePools`       — per-outcome pool sum for this round.
 *                            Outcomes with zero bets in the round
 *                            won't appear here; the consumer
 *                            defaults missing ids to 0.
 */

export interface RoundOutcomePool {
  outcome_id: string;
  pool_cents: number;
}

export interface RoundSummary {
  roundIndex: number;
  wasRefunded: boolean;
  winningOutcomeIds: string[];
  outcomePools: RoundOutcomePool[];
}

interface RawRoundRow {
  round_index: number;
  was_refunded: boolean;
  winning_outcome_ids: string[] | null;
  outcome_pools:
    | Array<{ outcome_id: string; pool_cents: number | string }>
    | null;
}

export function useEventRoundsSummary(eventId: string | undefined) {
  return useQuery({
    queryKey: ["events", "rounds-summary", eventId ?? "__none__"],
    queryFn: async (): Promise<RoundSummary[]> => {
      if (!eventId) return [];
      const { data, error } = await supabase.rpc("get_event_rounds_summary", {
        p_event_id: eventId,
      });
      if (error) throw error;
      const rows = (data ?? []) as RawRoundRow[];
      return rows.map((r) => ({
        roundIndex: Number(r.round_index ?? 1),
        wasRefunded: !!r.was_refunded,
        winningOutcomeIds: r.winning_outcome_ids ?? [],
        outcomePools: (r.outcome_pools ?? []).map((o) => ({
          outcome_id: o.outcome_id,
          pool_cents: Number(o.pool_cents ?? 0),
        })),
      }));
    },
    enabled: !!eventId,
    // Settled events don't change — once we've fetched the summary
    // we can hold it for the session. Refetch on mount lets a
    // freshly-finished event pick up the data the first time
    // someone lands on the page.
    staleTime: 60_000,
  });
}
