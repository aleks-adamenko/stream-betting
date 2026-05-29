import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getEvent, listEvents } from "@/services/eventsService";

export const eventsKeys = {
  all: ["events"] as const,
  list: () => [...eventsKeys.all, "list"] as const,
  detail: (id: string) => [...eventsKeys.all, "detail", id] as const,
};

/**
 * Feed-wide events query. Subscribes to every UPDATE on `public.events`
 * via the Supabase Realtime publication and re-fetches the list, so
 * status flips (live → pending_moderation → settled, etc.) propagate
 * to every screen that renders the feed (Home, Discover) without
 * a manual refresh. Page-level pieces like the featured-live hero
 * decide to show / hide themselves based on the refreshed status.
 *
 * Per-event subscriptions on EventDetails keep their narrower
 * filter (`id=eq.<id>`) for the detail page — this one is the broad
 * fan-out for the listing pages.
 */
export function useEvents() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: eventsKeys.list(),
    queryFn: listEvents,
  });

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    // Strict Mode microtask deferral — same pattern useLiveOdds /
    // useEventChat use to avoid the "callbacks after subscribe" guard
    // tripping during the dev-mode mount → cleanup → remount cycle.
    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel("events:feed")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "events" },
          () => {
            void queryClient.invalidateQueries({ queryKey: eventsKeys.list() });
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

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: id ? eventsKeys.detail(id) : eventsKeys.detail("__none__"),
    queryFn: () => (id ? getEvent(id) : Promise.resolve(null)),
    enabled: !!id,
  });
}
