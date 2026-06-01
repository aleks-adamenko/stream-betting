import { useQuery } from "@tanstack/react-query";

import { listMyBets } from "@/services/betsService";
import { useAuth } from "@/contexts/AuthContext";

// `mine` is the prefix for any current-user bets query — useful for
// `invalidateQueries({ queryKey: betsKeys.mine() })` which matches
// every per-user variant under it.
// `mineFor(userId)` is the exact key used by the hook, so the cache
// is partitioned per account. Without the user id in the key, signing
// out user A and signing in user B in the same browser left the
// EventDetails page reading A's bets — locking B out of the bet form
// on an event A had already bet on.
export const betsKeys = {
  all: ["bets"] as const,
  mine: () => [...betsKeys.all, "mine"] as const,
  mineFor: (userId: string | null | undefined) =>
    [...betsKeys.mine(), userId ?? "anon"] as const,
};

export function useMyBets() {
  const { user } = useAuth();
  return useQuery({
    queryKey: betsKeys.mineFor(user?.id),
    queryFn: listMyBets,
    enabled: !!user,
  });
}
