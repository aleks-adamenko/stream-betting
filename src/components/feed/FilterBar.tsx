import { useMemo } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { EventStatus, Influencer, StreamEvent } from "@/domain/types";

export type StatusFilter = "all" | EventStatus;

export interface FilterState {
  status: StatusFilter;
  influencerId: string | null;
}

interface FilterBarProps {
  events: StreamEvent[];
  value: FilterState;
  onChange: (next: FilterState) => void;
}

const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live now" },
  { id: "scheduled", label: "Upcoming" },
  { id: "finished", label: "Ended" },
];

export function FilterBar({ events, value, onChange }: FilterBarProps) {
  const influencers = useMemo(() => {
    const map = new Map<string, Influencer>();
    events.forEach((e) => map.set(e.influencer.id, e.influencer));
    return Array.from(map.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }, [events]);

  const hasActiveFilter = value.status !== "all" || !!value.influencerId;

  return (
    <div className="space-y-3 lg:flex lg:items-center lg:justify-between lg:gap-4 lg:space-y-0">
      {/* Status chips */}
      <div className="-mx-3 flex gap-1.5 overflow-x-auto scrollbar-hide px-3 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 lg:flex-nowrap">
        {STATUS_OPTIONS.map((opt) => (
          <Chip
            key={opt.id}
            active={value.status === opt.id}
            onClick={() => onChange({ ...value, status: opt.id })}
          >
            {opt.label}
          </Chip>
        ))}
      </div>

      {/* Creator dropdown */}
      <div className="flex flex-wrap gap-2 lg:flex-nowrap lg:justify-end">
        <select
          value={value.influencerId ?? ""}
          onChange={(e) =>
            onChange({ ...value, influencerId: e.target.value || null })
          }
          className="h-9 max-w-[60%] truncate rounded-lg border border-border/50 bg-background px-3 text-sm font-medium focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 lg:max-w-none"
        >
          <option value="">All creators</option>
          {influencers.map((i) => (
            <option key={i.id} value={i.id}>
              {i.displayName}
            </option>
          ))}
        </select>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => onChange({ status: "all", influencerId: null })}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-border/50 bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}

interface ChipProps {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 flex-shrink-0 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/50 bg-background text-foreground hover:border-primary/40 hover:bg-primary/[0.04]",
      )}
    >
      {children}
    </button>
  );
}

export function applyFilters(events: StreamEvent[], filter: FilterState) {
  return events.filter((e) => {
    if (filter.status !== "all" && e.status !== filter.status) return false;
    if (filter.influencerId && e.influencer.id !== filter.influencerId) return false;
    return true;
  });
}
