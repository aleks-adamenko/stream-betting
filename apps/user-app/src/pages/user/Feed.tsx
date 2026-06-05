import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { EventCard } from "@/components/feed/EventCard";
import {
  FilterBar,
  applyFilters,
  type FilterState,
  type StatusFilter,
} from "@/components/feed/FilterBar";
import { PageContainer } from "@/components/layout/PageContainer";
import { useEvents } from "@/hooks/useEvents";

/**
 * Slug ↔ status mapping. The URL uses friendly names that match the
 * filter chips ("live", "upcoming", "ended") while the underlying
 * status filter keeps the data-model values ("live", "scheduled",
 * "finished"). Home's "Show more" buttons link straight at the
 * slugged routes.
 */
const SLUG_TO_STATUS: Record<string, StatusFilter> = {
  live: "live",
  upcoming: "scheduled",
  ended: "finished",
};

const STATUS_TO_SLUG: Partial<Record<StatusFilter, string>> = {
  live: "live",
  scheduled: "upcoming",
  finished: "ended",
};

export default function Feed() {
  const { filter: filterSlug } = useParams<{ filter?: string }>();
  const navigate = useNavigate();
  const { data: events, isLoading } = useEvents();

  // Unknown slug (e.g. /discover/foobar) → bounce back to /discover
  // so the URL bar reflects the rendered state.
  if (filterSlug && !(filterSlug in SLUG_TO_STATUS)) {
    return <Navigate to="/discover" replace />;
  }

  // Status is URL-driven. Influencer is local — it's a many-valued
  // dropdown not worth putting in the path, and the FilterBar's
  // "Clear" button still wipes both.
  const status: StatusFilter = filterSlug
    ? SLUG_TO_STATUS[filterSlug]!
    : "all";
  const [influencerId, setInfluencerId] = useState<string | null>(null);
  const filter: FilterState = { status, influencerId };

  const handleChange = (next: FilterState) => {
    if (next.status !== status) {
      const slug = STATUS_TO_SLUG[next.status];
      navigate(slug ? `/discover/${slug}` : "/discover");
    }
    if (next.influencerId !== influencerId) {
      setInfluencerId(next.influencerId);
    }
  };

  const visible = useMemo(
    () => (events ? applyFilters(events, filter) : []),
    [events, filter],
  );

  return (
    <PageContainer className="lg:pt-[18px]">
      <div className="mb-6">
        {events && (
          <FilterBar
            events={events}
            value={filter}
            onChange={handleChange}
          />
        )}
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {visible.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
