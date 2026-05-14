import { useQuery } from "@tanstack/react-query";

import { listNotifications } from "@/services/notificationsService";
import { useAuth } from "@/contexts/AuthContext";

export const notificationsKeys = {
  all: ["notifications"] as const,
  mine: () => [...notificationsKeys.all, "mine"] as const,
};

export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: notificationsKeys.mine(),
    queryFn: listNotifications,
    enabled: !!user,
  });
}

export function useUnreadCount() {
  const { data } = useNotifications();
  return data?.filter((n) => !n.read).length ?? 0;
}
