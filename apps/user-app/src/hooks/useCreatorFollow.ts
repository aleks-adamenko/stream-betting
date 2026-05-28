import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * `useCreatorFollow(creatorId)` — wraps the four creator-follow RPCs
 * for any place in the user-app that wants to surface follow state:
 *
 *   • `isFollowing`  — does the current viewer follow this creator?
 *   • `count`        — total followers of this creator (public-read).
 *   • `follow()`     — calls follow_creator and invalidates caches.
 *   • `unfollow()`   — calls unfollow_creator and invalidates caches.
 *
 * Registered-only — callers should gate the Follow/Unfollow button
 * behind `user` and route anon viewers to /auth/sign-in.
 *
 * Note: The `creator_followers` table is shared with the event
 * subscription / notifications path. Subscribing to ANY event from
 * a creator auto-adds a follow row (see subscribe_event RPC). This
 * hook is the explicit / direct flow — a viewer can follow a
 * creator straight from a profile or event page without
 * subscribing to a specific event first.
 */

const queryKeys = {
  isFollowing: (id: string, userId: string) =>
    ["creator-follow", id, userId] as const,
  count: (id: string) => ["creator-follower-count", id] as const,
};

export function useCreatorFollow(creatorId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ---- Does this viewer follow this creator? ----
  const isFollowingQuery = useQuery({
    queryKey:
      creatorId && user
        ? queryKeys.isFollowing(creatorId, user.id)
        : ["creator-follow", "__none__"],
    enabled: !!creatorId && !!user,
    queryFn: async () => {
      if (!creatorId || !user) return false;
      const { data, error } = await supabase.rpc("is_following_creator", {
        p_creator_id: creatorId,
      });
      if (error) throw error;
      return (data as boolean) ?? false;
    },
  });

  // ---- Public follower count (anon-readable RPC) ----
  const countQuery = useQuery({
    queryKey: creatorId
      ? queryKeys.count(creatorId)
      : ["creator-follower-count", "__none__"],
    enabled: !!creatorId,
    queryFn: async () => {
      if (!creatorId) return 0;
      const { data, error } = await supabase.rpc(
        "get_creator_follower_count",
        { p_creator_id: creatorId },
      );
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });

  // ---- Follow ----
  const followMutation = useMutation({
    mutationFn: async () => {
      if (!creatorId) throw new Error("Missing creator id");
      const { error } = await supabase.rpc("follow_creator", {
        p_creator_id: creatorId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      if (!creatorId) return;
      if (user) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.isFollowing(creatorId, user.id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.count(creatorId),
      });
    },
  });

  // ---- Unfollow ----
  const unfollowMutation = useMutation({
    mutationFn: async () => {
      if (!creatorId) throw new Error("Missing creator id");
      const { error } = await supabase.rpc("unfollow_creator", {
        p_creator_id: creatorId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      if (!creatorId) return;
      if (user) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.isFollowing(creatorId, user.id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.count(creatorId),
      });
    },
  });

  return {
    isFollowing: isFollowingQuery.data ?? false,
    isFollowingLoading: isFollowingQuery.isLoading,
    count: countQuery.data ?? 0,
    follow: () => followMutation.mutateAsync(),
    unfollow: () => unfollowMutation.mutateAsync(),
    isPending: followMutation.isPending || unfollowMutation.isPending,
  };
}
