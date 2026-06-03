import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * The signed-in streamer's CASHABLE balance, sourced from
 * `profiles.withdrawable_cents` (added by migration
 * `20260604_000002_streamer_balance.sql`).
 *
 * `profiles.balance_cents` is the user-app's spendable pot (top-ups +
 * starter grant + bet winnings) — NOT cashable. `withdrawable_cents`
 * is the cashable pot, populated only by approved per-event
 * `rake_streamer` payouts and debited by `request_payout`. The
 * studio Profile "Available to cash out" card reads this column.
 *
 * 1 coin = 100 cents (see `packages/lib/src/coins.ts`).
 */

export const streamerBalanceKeys = {
  all: ["streamer-balance"] as const,
  mine: (userId: string | undefined) =>
    [...streamerBalanceKeys.all, userId ?? "_"] as const,
};

export function useStreamerBalance() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: streamerBalanceKeys.mine(user?.id),
    enabled: !!user?.id,
    queryFn: async (): Promise<number> => {
      if (!user?.id) return 0;
      const { data, error } = await supabase
        .from("profiles")
        .select("withdrawable_cents")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.withdrawable_cents ?? 0);
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`streamer-balance:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${user.id}`,
          },
          () => {
            void queryClient.invalidateQueries({
              queryKey: streamerBalanceKeys.mine(user.id),
            });
          },
        )
        .subscribe();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  return query;
}
