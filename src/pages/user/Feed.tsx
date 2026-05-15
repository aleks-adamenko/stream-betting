import { useMemo, useState } from "react";

import { EventCard } from "@/components/feed/EventCard";
import { FilterBar, applyFilters, type FilterState } from "@/components/feed/FilterBar";
import { PageContainer } from "@/components/layout/PageContainer";
import { useEvents } from "@/hooks/useEvents";

export default function Feed() {
  const { data: events, isLoading } = useEvents();
  const [filter, setFilter] = useState<FilterState>({
    status: "all",
    influencerId: null,
  });

  const visible = useMemo(
    () => (events ? applyFilters(events, filter) : []),
    [events, filter],
  );

  return (
    <PageContainer className="lg:pt-[18px]">
      <div className="mb-6">
        {events && <FilterBar events={events} value={filter} onChange={setFilter} />}
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[5/4] animate-pulse rounded-xl border border-border/40 bg-card"
            />
          ))}
        </div>
      )}

      {!isLoading && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
          <p className="font-heading text-base font-semibold">Nothing matches</p>
          <p className="mt-1 text-sm text-muted-foreground">Try clearing some filters.</p>
        </div>
      )}

      {!isLoading && visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
