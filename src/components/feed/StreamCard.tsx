import { useState } from "react";
import { Link } from "react-router-dom";
import { Heart, MessageCircle, Share2, Bookmark, Users, Calendar } from "lucide-react";

import { LiveBadge } from "./LiveBadge";
import type { StreamEvent } from "@/domain/types";
import { cn } from "@/lib/utils";
import { oddsPillClasses, oddsRange } from "@/lib/odds";

interface StreamCardProps {
  event: StreamEvent;
}

const numberFormatter = new Intl.NumberFormat("en-US");

function formatScheduledAt(iso: string) {
  const d = new Date(iso);
  const diffH = Math.round((d.getTime() - Date.now()) / 3600_000);
  if (diffH < 24) return `Starts in ${Math.max(diffH, 1)}h`;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function StreamCard({ event }: StreamCardProps) {
  const isLive = event.status === "live";
  const isScheduled = event.status === "scheduled";
  const primaryHref = `/event/${event.id}`;
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const { min: oddsMin, max: oddsMax } = oddsRange(event.outcomes.map((o) => o.odds));

  return (
    <article className="relative mx-auto w-full max-w-[520px] snap-start scroll-mt-4">
      <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/40 bg-card shadow-lg">
        {/* Cover — vertical phone-screen aspect, taller now that the CTA is gone */}
        <Link
          to={primaryHref}
          className="group relative block aspect-[9/16] max-h-[calc(100dvh-220px)] min-h-[320px] w-full overflow-hidden bg-muted"
        >
          <img
            src={event.coverUrl}
            alt={event.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/30" />

          {/* Top-left badges */}
          <div className="absolute left-3 top-3 flex items-center gap-2">
            {isLive && <LiveBadge />}
          </div>

          {/* Top-right meta */}
          <div className="absolute right-3 top-3 flex items-center gap-2">
            {isLive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
                <Users className="h-3.5 w-3.5" /> {numberFormatter.format(event.viewersCount)}
              </span>
            ) : isScheduled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
                <Calendar className="h-3.5 w-3.5" /> {formatScheduledAt(event.scheduledAt)}
              </span>
            ) : null}
          </div>

          {/* Right-side action rail, vertically centered */}
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 sm:gap-4">
            <ActionButton
              icon={Heart}
              label={(event.viewersCount > 0 ? Math.round(event.viewersCount / 12) : 12).toString()}
              active={liked}
              onClick={() => setLiked((v) => !v)}
              activeClassName="text-destructive"
            />
            <ActionButton icon={MessageCircle} label={isLive ? "Chat" : "Talk"} />
            <ActionButton
              icon={Bookmark}
              label="Save"
              active={saved}
              onClick={() => setSaved((v) => !v)}
              activeClassName="text-accent"
            />
            <ActionButton icon={Share2} label="Share" />
          </div>

          {/* Bottom: title + influencer */}
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 pr-16">
            <div className="min-w-0 flex-1 text-white">
              <h3 className="font-heading text-lg font-bold leading-tight drop-shadow sm:text-xl">
                {event.title}
              </h3>
              <div className="mt-1.5 flex items-center gap-2">
                <img
                  src={event.influencer.avatarUrl}
                  alt={event.influencer.displayName}
                  className="h-6 w-6 flex-shrink-0 rounded-full object-cover ring-1 ring-white/40"
                />
                <span className="truncate text-xs font-medium text-white/90">
                  {event.influencer.displayName}
                </span>
                <span className="truncate text-xs text-white/60">{event.influencer.handle}</span>
              </div>
            </div>
          </div>
        </Link>

        {/* Bet strip — description + outcome chips (no big CTA, the cover is the click target) */}
        <div className="flex flex-col gap-3 p-4">
          <p className="line-clamp-2 text-sm text-muted-foreground">{event.description}</p>

          <div className="-mx-1 flex gap-2 overflow-x-auto scrollbar-hide px-1">
            {event.outcomes.slice(0, 4).map((o) => (
              <Link
                key={o.id}
                to={primaryHref}
                className="flex flex-shrink-0 items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="max-w-[140px] truncate text-foreground">{o.label}</span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums",
                    oddsPillClasses(o.odds, oddsMin, oddsMax),
                  )}
                >
                  {o.odds.toFixed(2)}×
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

interface ActionButtonProps {
  icon: typeof Heart;
  label: string;
  active?: boolean;
  activeClassName?: string;
  onClick?: () => void;
}

function ActionButton({ icon: Icon, label, active, activeClassName, onClick }: ActionButtonProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.();
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex flex-col items-center gap-1 text-white transition-colors"
    >
      <span
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-colors hover:bg-black/55 sm:h-11 sm:w-11",
          active && activeClassName,
        )}
      >
        <Icon className={cn("h-5 w-5", active && "fill-current")} />
      </span>
      <span className="text-[11px] font-semibold leading-none drop-shadow">{label}</span>
    </button>
  );
}
