import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Per-viewer payouts feed.
 *
 * Driven by the `payouts` table — RLS scopes the query to rows where
 * `recipient_id = auth.uid()`, so we just `select *` and trust the
 * policy. Realtime is wired up so the row's `status` flip from
 * 'pending' → 'completed' invalidates the React Query cache and the
 * UI moves the row from "In review" to the post-paid list without a
 * manual refresh.
 */

export interface ViewerPayout {
  id: string;
  type: "winner" | "refund";
  event_id: string;
  amount_cents: number;
  status:
    | "pending"
    | "approved"
    | "completed"
    | "rejected"
    | "on_hold"
    | "failed";
  created_at: string;
  completed_at: string | null;
  event_title?: string | null;
}

export const payoutsKeys = {
  all: ["payouts"] as const,
  mine: () => [...payoutsKeys.all, "mine"] as const,
};

export function usePayouts() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: payoutsKeys.mine(),
    enabled: !!user,
    queryFn: async (): Promise<ViewerPayout[]> => {
      const { data, error } = await supabase
        .from("payouts")
        .select(
          `id, type, event_id, amount_cents, status, created_at, completed_at,
           event:events!payouts_event_id_fkey ( title )`,
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Array<
        ViewerPayout & { event: { title: string } | null }
      >).map((row) => ({
        ...row,
        event_title: row.event?.title ?? null,
      }));
    },
  });

  // Subscribe to UPDATE events on the payouts table so an approve
  // / reject in SQL Editor surfaces immediately on the viewer side.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`payouts:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "payouts",
            filter: `recipient_id=eq.${user.id}`,
          },
          () => {
            void query.refetch();
          },
        )
        .subscribe();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return query;
}
