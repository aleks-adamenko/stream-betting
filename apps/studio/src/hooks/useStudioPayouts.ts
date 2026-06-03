import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Streamer-side payouts feed.
 *
 * RLS scopes the query to rake_streamer rows where the event's
 * creator_id matches the signed-in creator, so we just select all
 * accessible rows and trust the policy. Realtime subscription on
 * the table refreshes the cache when a moderator approves or
 * rejects a rake row from the SQL Editor.
 */

export type StudioPayoutStatus =
  | "pending"
  | "approved"
  | "completed"
  | "rejected"
  | "on_hold"
  | "failed";

export interface StudioPayout {
  id: string;
  type: "rake_streamer";
  event_id: string;
  event_title: string | null;
  amount_cents: number;
  status: StudioPayoutStatus;
  created_at: string;
  completed_at: string | null;
}

export const studioPayoutsKeys = {
  all: ["studio-payouts"] as const,
  mine: (creatorId: string | undefined) =>
    [...studioPayoutsKeys.all, creatorId ?? "_"] as const,
};

export function useStudioPayouts() {
  const { creator } = useAuth();

  const query = useQuery({
    queryKey: studioPayoutsKeys.mine(creator?.id),
    enabled: !!creator?.id,
    queryFn: async (): Promise<StudioPayout[]> => {
      const { data, error } = await supabase
        .from("payouts")
        .select(
          `id, type, event_id, recipient_id, amount_cents, status, created_at, completed_at,
           event:events!payouts_event_id_fkey ( title, creator_id )`,
        )
        .eq("type", "rake_streamer")
        // Explicit recipient filter. The RLS policy on `payouts` scopes
        // streamers to rows for events they own — but a streamer who's
        // ALSO a super_admin sees every rake_streamer row via the
        // "admin reads all" policy added in 20260531_000001. Without
        // this filter, the Balance page would show rake rows for other
        // creators' events. Filtering server-side keeps the payload
        // small for non-admins too.
        .eq("recipient_id", creator!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Array<
        StudioPayout & {
          recipient_id: string;
          event: { title: string; creator_id: string } | null;
        }
      >).map((row) => ({
        id: row.id,
        type: row.type,
        event_id: row.event_id,
        event_title: row.event?.title ?? null,
        amount_cents: Number(row.amount_cents),
        status: row.status,
        created_at: row.created_at,
        completed_at: row.completed_at,
      }));
    },
  });

  useEffect(() => {
    if (!creator?.id) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`studio-payouts:${creator.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "payouts" },
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
  }, [creator?.id]);

  return query;
}
