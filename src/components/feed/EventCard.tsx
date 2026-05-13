import { Link } from "react-router-dom";
import { Users, Calendar } from "lucide-react";

import { LiveBadge } from "./LiveBadge";
import type { StreamEvent } from "@/domain/types";
import { cn } from "@/lib/utils";

interface EventCardProps {
  event: StreamEvent;
  className?: string;
}

const numberFormatter = new Intl.NumberFormat("en-US");

function formatScheduledAt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EventCard({ event, className }: EventCardProps) {
  const isLive = event.status === "live";
  const isScheduled = event.status === "scheduled";

  return (
    <Link
      to={`/event/${event.id}`}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:border-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <div className="relative aspect-[8/9] w-full overflow-hidden bg-muted">
        <img
          src={event.coverUrl}
          alt={event.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />
        <div className="absolute left-3 top-3 flex items-center gap-2">
          {isLive && <LiveBadge size="sm" />}
          <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
            {event.category}
          </span>
        </div>
        {isLive && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
            <Users className="h-3 w-3" /> {numberFormatter.format(event.viewersCount)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="font-heading text-base font-semibold leading-tight text-foreground line-clamp-1 group-hover:text-primary transition-colors">
            {event.title}
          </h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{event.description}</p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <img
              src={event.influencer.avatarUrl}
              alt={event.influencer.displayName}
              className="h-7 w-7 flex-shrink-0 rounded-full object-cover ring-1 ring-border"
            />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">
                {event.influencer.displayName}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {event.influencer.handle}
              </p>
            </div>
          </div>
          {isScheduled && (
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
              <Calendar className="h-3 w-3" />
              <span className="hidden sm:inline">{formatScheduledAt(event.scheduledAt)}</span>
              <span className="sm:hidden">Upcoming</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
