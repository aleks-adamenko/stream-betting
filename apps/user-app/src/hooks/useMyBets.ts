import { useQuery } from "@tanstack/react-query";

import { listMyBets } from "@/services/betsService";
import { useAuth } from "@/contexts/AuthContext";

export const betsKeys = {
  all: ["bets"] as const,
  mine: () => [...betsKeys.all, "mine"] as const,
};

export function useMyBets() {
  const { user } = useAuth();
  return useQuery({
    queryKey: betsKeys.mine(),
    queryFn: listMyBets,
    enabled: !!user,
  });
}
