import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { UserMinus, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LiveBadge } from "@/components/feed/LiveBadge";
import { PageContainer } from "@/components/layout/PageContainer";
import { useAuth } from "@/contexts/AuthContext";
import { useCreatorFollow } from "@/hooks/useCreatorFollow";
import { useEvents } from "@/hooks/useEvents";
import { cn } from "@/lib/utils";
import type { Influencer, StreamEvent } from "@/domain/types";

interface CreatorAggregate {
  creator: Influencer;
  totalChallenges: number;
  liveEvents: StreamEvent[];
}

export default function Following() {
  const { data: events, isLoading } = useEvents();

  const creators = useMemo<CreatorAggregate[]>(() => {
    if (!events) return [];
    const byId = new Map<string, CreatorAggregate>();
    for (const event of events) {
      const id = event.influencer.id;
      const entry = byId.get(id) ?? {
        creator: event.influencer,
        totalChallenges: 0,
        liveEvents: [],
      };
      entry.totalChallenges += 1;
      if (event.status === "live") entry.liveEvents.push(event);
      byId.set(id, entry);
    }
    return Array.from(byId.values()).sort(
      (a, b) => b.creator.followers - a.creator.followers,
    );
  }, [events]);

  return (
    <PageContainer className="lg:pt-[18px]">
      {isLoading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-2xl border border-border/40 bg-card"
            />
          ))}
        </div>
      )}

      {!isLoading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {creators.map((c) => (
            <CreatorCard key={c.creator.id} data={c} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

const numberFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function CreatorCard({ data }: { data: CreatorAggregate }) {
  const { creator, totalChallenges, liveEvents } = data;
  const { user } = useAuth();
  const navigate = useNavigate();
  // Live follower count + follow state from the same RPC the rest
  // of the app reads. Fall back to event.influencer.followers (a
  // cached snapshot from the event row) while the query loads so
  // the card doesn't flicker through "0 followers" on first mount.
  const { isFollowing, count, follow, unfollow, isPending } =
    useCreatorFollow(creator.id);
  const followerCount = count || creator.followers;

  const onFollowClick = async () => {
    if (!user) {
      navigate(`/auth/sign-in?next=${encodeURIComponent("/following")}`);
      return;
    }
    try {
      if (isFollowing) await unfollow();
      else await follow();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      toast.error(message);
    }
  };

  return (
    <article className="flex flex-col rounded-2xl border border-border/40 bg-card p-5 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl">
      <div className="flex flex-col items-center text-center">
        <img
          src={creator.avatarUrl}
          alt={creator.displayName}
          className="h-20 w-20 rounded-full object-cover ring-2 ring-primary/20"
        />
        <h3 className="mt-3 font-heading text-lg font-bold leading-tight">
          {creator.displayName}
        </h3>
        <p className="text-sm text-muted-foreground">{creator.handle}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="Challenges" value={totalChallenges.toString()} />
        <Stat label="Followers" value={numberFmt.format(followerCount)} />
      </div>

      {liveEvents.length > 0 ? (
        <div className="mt-4 space-y-2">
          {liveEvents.slice(0, 2).map((event) => (
            <Link
              key={event.id}
              to={`/event/${event.id}`}
              className="group flex h-16 items-center gap-3 rounded-lg border border-border/40 bg-background/60 p-2 transition-colors hover:border-primary/40 hover:bg-primary/[0.04]"
            >
              <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                <img
                  src={event.coverUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
                <LiveBadge
                  size="sm"
                  className="absolute left-1 top-1 px-1 py-0 text-[8px]"
                />
              </div>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-primary">
                {event.title}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex h-16 items-center justify-center rounded-lg bg-muted/50 px-3 text-xs font-medium text-muted-foreground">
          No active challenges right now
        </div>
      )}

      {/* Wired up to useCreatorFollow. Matches the event-page
          Follow/Unfollow button: outline+destructive on hover when
          following, primary fill when not. Group hover swaps the
          icon + label on desktop; mobile relies on the variant
          change to telegraph the state. */}
      <Button
        size="lg"
        variant={isFollowing ? "outline" : "default"}
        onClick={onFollowClick}
        disabled={isPending}
        className={cn(
          "mt-5 w-full",
          isFollowing &&
            "group hover:border-destructive hover:text-destructive",
        )}
      >
        {isFollowing ? (
          <>
            <UserPlus className="h-4 w-4 group-hover:hidden" />
            <UserMinus className="hidden h-4 w-4 group-hover:inline" />
            <span className="group-hover:hidden">Following</span>
            <span className="hidden group-hover:inline">Unfollow</span>
          </>
        ) : (
          <>
            <UserPlus className="h-4 w-4" /> Follow
          </>
        )}
      </Button>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-2 text-center">
      <p className="font-heading text-base font-bold tabular-nums">{value}</p>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
