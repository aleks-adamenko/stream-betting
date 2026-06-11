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
 * error so callers always get a usable object.
 *
 * Studio surfaces are non-event-scoped showcases (commission %, payout
 * floor, the editor's window/stake hints for a draft that snapshots the
 * live config at go-live), so the global live config is the right read.
 * Studio's event-scoped readiness already flows through the
 * snapshot-aware `useEventProgress`, so no event-scoped hook is needed
 * here.
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
    staleTime: 5 * 60_000,
  });

  return data ?? DEFAULT_BETTING_CONFIG;
}
