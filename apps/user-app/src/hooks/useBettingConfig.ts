import { useQuery } from "@tanstack/react-query";

import {
  bettingConfigFromRow,
  DEFAULT_BETTING_CONFIG,
  type BettingConfig,
  type BettingConfigRow,
} from "@liverush/lib";
import { supabase } from "@/integrations/supabase/client";

/**
 * Global, LIVE betting config — the values a *new* event will be
 * created with. Reads `get_betting_constants()` (the admin-editable
 * `betting_config` row) and maps it onto the shared `BettingConfig`
 * shape, falling back to `DEFAULT_BETTING_CONFIG` while loading / on
 * error so callers always get a usable object (no flicker logic).
 *
 * Use this ONLY for non-event-scoped showcases that describe the rules
 * new events will get (house-rules cards, tier limits). For anything
 * tied to a specific live event use `useEventConstants(eventId)`, which
 * returns that event's frozen snapshot — otherwise the page would show
 * live numbers while `place_bet`/settlement enforce the snapshot.
 */
export const bettingConfigKeys = {
  all: ["betting-config"] as const,
  global: () => [...bettingConfigKeys.all, "global"] as const,
};

export function useBettingConfig(): BettingConfig {
  const { data } = useQuery({
    queryKey: bettingConfigKeys.global(),
    queryFn: async (): Promise<BettingConfig> => {
      const { data, error } = await supabase.rpc("get_betting_constants");
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | BettingConfigRow
        | undefined;
      return bettingConfigFromRow(row);
    },
    // Config changes are rare + admin-driven; keep the network quiet.
    staleTime: 5 * 60_000,
  });

  return data ?? DEFAULT_BETTING_CONFIG;
}
