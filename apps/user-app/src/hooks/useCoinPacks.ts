import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * Live IAP catalogue for the Get coins screen.
 *
 * Pulls active rows from `coin_packs` (RLS lets any signed-in user
 * read where `is_active=true`) and subscribes to Realtime so an admin
 * edit on `apps/admin-app/src/pages/Settings.tsx` propagates here
 * within ~1s — the storefront stays in sync without a reload.
 *
 * Sorted by `sort_order asc` server-side so the table-and-card layouts
 * iterate in the order the operator dragged them.
 */

export interface CoinPack {
  id: string;
  coins: number;
  /** Dollar cents (`$X.XX` displays as `priceDollarCents / 100`). */
  priceDollarCents: number;
  sortOrder: number;
}

interface CoinPackRow {
  id: string;
  coins: number;
  price_dollar_cents: number;
  sort_order: number;
  is_active: boolean;
}

export const coinPacksKeys = {
  all: ["coin-packs"] as const,
  active: () => [...coinPacksKeys.all, "active"] as const,
};

export function useCoinPacks() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: coinPacksKeys.active(),
    queryFn: async (): Promise<CoinPack[]> => {
      const { data, error } = await supabase
        .from("coin_packs")
        .select("id, coins, price_dollar_cents, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as CoinPackRow[]).map((row) => ({
        id: row.id,
        coins: row.coins,
        priceDollarCents: Number(row.price_dollar_cents),
        sortOrder: row.sort_order,
      }));
    },
    // Pack catalogue rarely changes — 5min stale time keeps the network
    // quiet, Realtime takes care of immediate-update freshness.
    staleTime: 5 * 60_000,
  });

  // Realtime: any INSERT / UPDATE / DELETE on coin_packs invalidates
  // the cached list. Deferred channel-setup pattern mirrors the chat /
  // viewer hooks (StrictMode-safe).
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel("coin-packs:catalogue")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "coin_packs" },
          () => {
            void queryClient.invalidateQueries({ queryKey: coinPacksKeys.active() });
          },
        )
        .subscribe();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query;
}
