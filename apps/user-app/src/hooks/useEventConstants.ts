import { useQuery } from "@tanstack/react-query";

import {
  bettingConfigFromRow,
  DEFAULT_BETTING_CONFIG,
  type BettingConfig,
  type BettingConfigRow,
} from "@liverush/lib";
import { supabase } from "@/integrations/supabase/client";

/**
 * Event-scoped, SNAPSHOT betting config — the rules a specific event
 * actually lives by. Reads `get_event_constants(eventId)`, which returns
 * the event's frozen snapshot (stamped at go-live) or the live config as
 * a fallback for older / not-yet-started events.
 *
 * Use this for anything tied to a specific live event (EventDetails
 * stake-range guard, indicative-odds rake) so what the viewer sees ==
 * what `place_bet` / `settle_round` / `compute_live_odds` enforce. For
 * non-event showcases describing *new* events, use `useBettingConfig()`
 * (the global live config) instead.
 *
 * Falls back to `DEFAULT_BETTING_CONFIG` while loading / on error so
 * callers always get a usable object.
 */
export const eventConstantsKeys = {
  all: ["event-constants"] as const,
  one: (eventId: string) => [...eventConstantsKeys.all, eventId] as const,
};

export function useEventConstants(
  eventId: string | undefined,
): BettingConfig {
  const { data } = useQuery({
    queryKey: eventConstantsKeys.one(eventId ?? "none"),
    enabled: !!eventId,
    queryFn: async (): Promise<BettingConfig> => {
      const { data, error } = await supabase.rpc("get_event_constants", {
        p_event_id: eventId as string,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | BettingConfigRow
        | undefined;
      return bettingConfigFromRow(row);
    },
    // A given event's snapshot never changes once frozen, so this can
    // stay cached for the whole session.
    staleTime: Infinity,
  });

  return data ?? DEFAULT_BETTING_CONFIG;
}
