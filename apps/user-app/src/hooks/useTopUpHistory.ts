import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The signed-in user's top-up history, sourced from `ledger_entries`.
 *
 * Replaces the hard-coded `MOCK_TOP_UPS` array that used to live in
 * `apps/user-app/src/pages/user/Coins.tsx`. Every successful
 * `top_up_balance` RPC writes one row with `account='user:<uid>'` and
 * `type='top_up'` — see migration `20260604_000001_ledger_rebuild.sql`.
 *
 * RLS already restricts `ledger_entries` rows by owning account, so
 * the user only sees their own rows. Realtime subscription on inserts
 * keeps the history list fresh the moment the CheckoutModal Pay
 * mutation lands.
 */

export interface TopUpRow {
  id: string;
  coins: number;
  /** Dollar cents the user "paid" — null on legacy rows pre-migration. */
  cashCents: number | null;
  /** External reference for this top-up. For Stripe-driven rows this
   *  is the Checkout Session id (`cs_…`); for the legacy dev-only
   *  `top_up_balance` RPC path it's a UUID. The Coins page uses this
   *  to match a redirect-return `?session_id=cs_…` to a webhook-
   *  written ledger row. */
  referenceId: string | null;
  createdAt: string;
}

interface LedgerRow {
  id: string;
  amount_cents: number;
  amount_cash_cents: number | null;
  reference_id: string | null;
  created_at: string;
}

export const topUpHistoryKeys = {
  all: ["top-up-history"] as const,
  mine: (userId: string | undefined) =>
    [...topUpHistoryKeys.all, userId ?? "_"] as const,
};

export function useTopUpHistory() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const account = user ? `user:${user.id}` : null;

  const query = useQuery({
    queryKey: topUpHistoryKeys.mine(user?.id),
    enabled: !!account,
    queryFn: async (): Promise<TopUpRow[]> => {
      if (!account) return [];
      const { data, error } = await supabase
        .from("ledger_entries")
        .select("id, amount_cents, amount_cash_cents, reference_id, created_at")
        .eq("account", account)
        .eq("type", "top_up")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return ((data ?? []) as LedgerRow[]).map((row) => ({
        id: row.id,
        coins: Number(row.amount_cents) / 100,
        cashCents:
          row.amount_cash_cents == null ? null : Number(row.amount_cash_cents),
        referenceId: row.reference_id,
        createdAt: row.created_at,
      }));
    },
  });

  useEffect(() => {
    if (!user?.id || !account) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`top-up-history:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "ledger_entries",
            filter: `account=eq.${account}`,
          },
          () => {
            void queryClient.invalidateQueries({
              queryKey: topUpHistoryKeys.mine(user.id),
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
  }, [user?.id, account, queryClient]);

  return query;
}
