import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * `useEventSubscription(eventId)` — wraps the three notification
 * touchpoints the EventDetails UpcomingPanel needs:
 *
 *   • `isSubscribed`     — is the current viewer subscribed to this
 *     event's "notify me when live" stream?
 *   • `count`            — total number of users who will get a
 *     notification when this event goes live (direct subscribers ∪
 *     the creator's followers). Public read, works for anon.
 *   • `subscribe()` / `unsubscribe()` — call the SECURITY DEFINER
 *     RPCs and invalidate caches. `subscribe` also fires the
 *     `send-subscription-email` Edge Function so the viewer gets a
 *     confirmation email — best-effort, doesn't fail the mutation
 *     if email delivery has a transient issue.
 *
 * The hook is intentionally registered-only. Callers should gate
 * the UI behind `user` and route anon viewers to /auth/sign-in.
 */

const queryKeys = {
  isSubscribed: (id: string, userId: string) =>
    ["event-subscription", id, userId] as const,
  count: (id: string) => ["event-subscription-count", id] as const,
};

export function useEventSubscription(eventId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ---- Is this viewer subscribed? ----
  const isSubscribedQuery = useQuery({
    queryKey: eventId && user
      ? queryKeys.isSubscribed(eventId, user.id)
      : ["event-subscription", "__none__"],
    enabled: !!eventId && !!user,
    queryFn: async () => {
      if (!eventId || !user) return false;
      // RLS allows the user to read their own row only.
      const { data, error } = await supabase
        .from("event_subscribers")
        .select("event_id")
        .eq("event_id", eventId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  // ---- Public subscriber count (anon-readable RPC) ----
  const countQuery = useQuery({
    queryKey: eventId
      ? queryKeys.count(eventId)
      : ["event-subscription-count", "__none__"],
    enabled: !!eventId,
    queryFn: async () => {
      if (!eventId) return 0;
      const { data, error } = await supabase.rpc(
        "get_event_subscriber_count",
        { p_event_id: eventId },
      );
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });

  // ---- Subscribe ----
  const subscribeMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error("Missing event id");
      const { error: rpcErr } = await supabase.rpc("subscribe_event", {
        p_event_id: eventId,
      });
      if (rpcErr) throw rpcErr;

      // Fire-and-forget the confirmation email. The subscription
      // itself is what matters, and the in-app row is already
      // there if the email path hiccups.
      //
      // We pull the session access token and pass it explicitly in
      // the Authorization header. `supabase.functions.invoke()`
      // *should* attach the session JWT automatically, but in
      // practice it sometimes ships only the anon key — the function
      // gateway accepts that, but `auth.getUser()` inside the
      // function rejects it with a 401 because the anon key isn't a
      // user. Explicit header pinning makes the auth deterministic.
      void (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const headers: Record<string, string> = {};
          if (session?.access_token) {
            headers.Authorization = `Bearer ${session.access_token}`;
          }
          await supabase.functions.invoke("send-subscription-email", {
            body: { event_id: eventId },
            headers,
          });
        } catch (err) {
          console.warn("send-subscription-email failed:", err);
        }
      })();
    },
    onSuccess: () => {
      if (!eventId) return;
      if (user) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.isSubscribed(eventId, user.id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.count(eventId),
      });
    },
  });

  // ---- Unsubscribe ----
  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error("Missing event id");
      const { error } = await supabase.rpc("unsubscribe_event", {
        p_event_id: eventId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      if (!eventId) return;
      if (user) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.isSubscribed(eventId, user.id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.count(eventId),
      });
    },
  });

  return {
    isSubscribed: isSubscribedQuery.data ?? false,
    isSubscribedLoading: isSubscribedQuery.isLoading,
    count: countQuery.data ?? 0,
    subscribe: () => subscribeMutation.mutateAsync(),
    unsubscribe: () => unsubscribeMutation.mutateAsync(),
    isPending: subscribeMutation.isPending || unsubscribeMutation.isPending,
  };
}
