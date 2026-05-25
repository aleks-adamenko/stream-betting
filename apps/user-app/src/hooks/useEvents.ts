import { useQuery } from "@tanstack/react-query";

import { getEvent, listEvents } from "@/services/eventsService";

export const eventsKeys = {
  all: ["events"] as const,
  list: () => [...eventsKeys.all, "list"] as const,
  detail: (id: string) => [...eventsKeys.all, "detail", id] as const,
};

export function useEvents() {
  return useQuery({
    queryKey: eventsKeys.list(),
    queryFn: listEvents,
  });
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: id ? eventsKeys.detail(id) : eventsKeys.detail("__none__"),
    queryFn: () => (id ? getEvent(id) : Promise.resolve(null)),
    enabled: !!id,
  });
}
