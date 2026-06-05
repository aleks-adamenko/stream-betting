import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { UserMinus, UserPlus } from "lucide-react";

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

      {/* Bare <button> + absolutely-positioned brush-stroke SVG
          background. Replaces the rectangular shadcn Button's
          rounded container with a hand-drawn shape; the SVG fill
          carries the same blue gradient (--gradient-primary) that
          the default Button variant used. Following state swaps
          the fill to a muted neutral and the hover paints the
          destructive red brush, keeping the original toggle
          telegraph (icon + label swap on group-hover). */}
      <button
        type="button"
        onClick={onFollowClick}
        disabled={isPending}
        className={cn(
          // h-12 + text-base mirrors the shadcn Button's `size="lg"`
          // (`h-12 rounded-lg px-8 text-base`) so the brush button
          // reads at the same scale as it did before the swap.
          "group relative mt-5 inline-flex h-12 w-full items-center justify-center gap-2 text-base font-bold transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:[&_svg.brush]:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0",
          isFollowing ? "text-foreground" : "text-white",
        )}
      >
        <FollowBrushBg isFollowing={isFollowing} />
        <span className="relative inline-flex items-center gap-2">
          {isFollowing ? (
            <>
              <UserPlus className="h-4 w-4 group-hover:hidden" />
              <UserMinus className="hidden h-4 w-4 group-hover:inline" />
              <span className="group-hover:hidden">Following</span>
              <span className="hidden group-hover:inline">Unfollow</span>
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4" />
              Follow
            </>
          )}
        </span>
      </button>
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

/**
 * Hand-drawn brush-stroke background for the Follow / Following
 * button — same SVG path as `sidebar-button-bg.svg` (which is the
 * source asset under `apps/user-app/src/assets`). We inline the
 * path so it can carry an SVG-scoped linear gradient that matches
 * the design-tokens `--gradient-primary` value (blue gradient used
 * by the default shadcn Button variant). When the user is already
 * following, the fill drops to a neutral muted tone; group-hover
 * paints it destructive-red to telegraph the unfollow action — the
 * label/icon swap is handled by Tailwind `group-hover:` rules on
 * the sibling text span.
 *
 * `preserveAspectRatio="none"` stretches the natural 243×51 shape
 * to whatever the button's box ends up being (w-full + h-11).
 */
function FollowBrushBg({ isFollowing }: { isFollowing: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 243 51"
      preserveAspectRatio="none"
      className={cn(
        "brush pointer-events-none absolute inset-0 h-full w-full transition-opacity",
        isFollowing ? "text-muted" : "",
      )}
    >
      <defs>
        <linearGradient
          id="follow-brush-gradient"
          x1="0"
          y1="0"
          x2="1"
          y2="0"
        >
          <stop offset="0%" stopColor="#498aff" />
          <stop offset="100%" stopColor="#493bff" />
        </linearGradient>
        <linearGradient
          id="follow-brush-destructive"
          x1="0"
          y1="0"
          x2="1"
          y2="0"
        >
          <stop offset="0%" stopColor="hsl(0 84% 60%)" />
          <stop offset="100%" stopColor="hsl(0 72% 51%)" />
        </linearGradient>
      </defs>
      {isFollowing ? (
        <>
          {/* Inactive (Following) — neutral muted brush; the
              group-hover destructive overlay sits on top and fades
              in. Two paths stacked because we can't tween between
              fill values, only opacity. */}
          <path
            d="M186.477 0.208663C187.89 0.212811 189.303 0.235174 190.715 0.265592L190.717 0.269671C194.955 0.362725 199.191 0.545209 203.428 0.676331C207.842 0.817294 212.257 0.888021 216.672 0.927888C218.261 0.938258 219.851 0.965472 221.44 0.97469L222.592 0.983902C225.051 1.02458 226.146 3.67677 225.927 6.10058C228.121 6.13538 230.314 6.16603 232.508 6.19299C233.616 6.23751 234.726 6.19481 235.834 6.23814C236.066 6.24689 236.468 5.97096 236.531 6.28561C237.094 9.12782 237.648 14.0329 237.574 15.0164C237.5 16 236.287 16.81 236.287 16.81C237.404 16.8335 238.521 16.8543 239.638 16.8681C243.822 16.9444 244.073 24.5969 240.544 25.7554C240.833 27.8721 240.09 30.2609 238.328 30.9767C238.936 32.1364 239.108 33.7955 238.621 36.4579C238.406 37.6371 237.212 37.8792 236.508 38.5898C235.992 38.7375 235.481 38.922 234.961 39.0334C234.642 39.1013 234.323 39.1603 234.004 39.2225C233.868 39.7007 233.406 39.6774 232.528 39.6331L232.435 39.6284C233.03 47.3388 231.661 47.431 228.796 47.3734C228.542 47.3681 226.632 47.2803 226.471 47.2711C225.079 47.1988 223.687 47.1039 222.295 47.0126C222.27 47.1168 222.253 47.1875 222.228 47.2954L222.253 47.4466C222.801 50.6782 222.832 50.8622 221.519 50.3858L221.518 50.3875C221.378 51.0233 220.572 50.3334 220.098 50.3006C219.34 50.2486 218.582 50.1848 217.824 50.1338C214.809 49.9317 214.599 49.9261 214.047 49.8761C211.479 49.7409 208.913 49.5308 206.351 49.2517C202.458 48.8155 198.568 48.3056 194.671 47.9481C193.235 47.8331 191.799 47.729 190.362 47.6253C185.713 47.4799 181.062 47.4541 176.412 47.4448C176.578 50.119 175.701 49.8438 173.949 49.718C173.815 50.0174 173.44 49.8114 173.093 49.6659C172.642 49.6397 172.191 49.6136 171.74 49.5876C168.106 49.4098 164.472 49.2612 160.837 49.1172C153.373 49.0236 145.908 49.2408 138.444 49.3703C133.149 49.427 127.852 49.5518 122.558 49.3633C120.444 49.2881 117.57 49.1203 115.437 49.0035C110.584 48.6067 105.73 48.2379 100.877 47.8427C98.842 47.9504 96.8077 48.0846 94.7758 48.2936C87.3182 49.0019 79.8548 49.5701 72.3933 50.1856C69.8623 50.3926 66.4734 50.6885 63.9388 50.8177C58.4648 51.0948 52.9825 51.0268 47.5093 50.8085C43.5068 50.5717 39.5054 50.3078 35.5013 50.123C30.3854 49.8869 32.9323 50.0123 28.1628 49.88C27.2621 49.8549 26.3616 49.8194 25.4609 49.7899C22.3652 49.7079 12.2688 49.677 9.17236 49.6978C5.47198 49.6339 5.67331 44.211 8 42C8.07948 41.9245 8.33259 41.4759 8 41.5C6.47918 41.61 5.64275 41.4975 5.5 41.5C5.02116 41.5083 4.5 41.5 3.87129 41.5123C3.32549 41.366 2.31064 41.6369 2.27138 40.8583C2.15819 38.6146 2.68072 36.4208 3.09717 34.2182C-1.21939 33.753 -0.970958 25.0183 3.51127 25.178C3.99716 25.2075 4.48326 25.2267 4.9694 25.2474C5.2292 25.2603 5.4888 25.2776 5.74857 25.2937C5.72181 24.6563 5.77984 24.0155 5.93424 23.4133C3.42924 21.813 3.42411 16.1717 6.50314 14.9809C5.66566 12.2889 5.55028 8.94907 8.5 9H11C12.7587 9.07973 11.5915 9.04508 13.3505 9.10983C12.2589 6.40741 13.293 2.23105 16.3984 2.28451C18.0195 2.40513 29.6377 2.25962 31.2557 2.11559C37.1457 1.61688 43.0372 1.17822 48.9315 0.799789C56.0986 0.216603 63.2768 0.0937773 70.4529 0.000216888C78.2233 -0.00824042 85.9911 0.231347 93.7561 0.595035C100.479 1.01972 107.204 1.3753 113.929 1.73034C120.446 2.07327 126.967 2.24182 133.487 2.37594C139.774 2.4901 146.055 1.95931 152.337 1.69616C153.467 1.65952 154.597 1.61507 155.727 1.58603C158.937 1.50123 159.154 1.55216 162.305 1.40076C165.236 1.25998 168.166 1.02483 171.094 0.783297C176.216 0.296921 181.347 0.217881 186.477 0.208663Z"
            fill="hsl(var(--muted))"
            className="stroke-border/60"
            strokeWidth="1.5"
          />
          <path
            d="M186.477 0.208663C187.89 0.212811 189.303 0.235174 190.715 0.265592L190.717 0.269671C194.955 0.362725 199.191 0.545209 203.428 0.676331C207.842 0.817294 212.257 0.888021 216.672 0.927888C218.261 0.938258 219.851 0.965472 221.44 0.97469L222.592 0.983902C225.051 1.02458 226.146 3.67677 225.927 6.10058C228.121 6.13538 230.314 6.16603 232.508 6.19299C233.616 6.23751 234.726 6.19481 235.834 6.23814C236.066 6.24689 236.468 5.97096 236.531 6.28561C237.094 9.12782 237.648 14.0329 237.574 15.0164C237.5 16 236.287 16.81 236.287 16.81C237.404 16.8335 238.521 16.8543 239.638 16.8681C243.822 16.9444 244.073 24.5969 240.544 25.7554C240.833 27.8721 240.09 30.2609 238.328 30.9767C238.936 32.1364 239.108 33.7955 238.621 36.4579C238.406 37.6371 237.212 37.8792 236.508 38.5898C235.992 38.7375 235.481 38.922 234.961 39.0334C234.642 39.1013 234.323 39.1603 234.004 39.2225C233.868 39.7007 233.406 39.6774 232.528 39.6331L232.435 39.6284C233.03 47.3388 231.661 47.431 228.796 47.3734C228.542 47.3681 226.632 47.2803 226.471 47.2711C225.079 47.1988 223.687 47.1039 222.295 47.0126C222.27 47.1168 222.253 47.1875 222.228 47.2954L222.253 47.4466C222.801 50.6782 222.832 50.8622 221.519 50.3858L221.518 50.3875C221.378 51.0233 220.572 50.3334 220.098 50.3006C219.34 50.2486 218.582 50.1848 217.824 50.1338C214.809 49.9317 214.599 49.9261 214.047 49.8761C211.479 49.7409 208.913 49.5308 206.351 49.2517C202.458 48.8155 198.568 48.3056 194.671 47.9481C193.235 47.8331 191.799 47.729 190.362 47.6253C185.713 47.4799 181.062 47.4541 176.412 47.4448C176.578 50.119 175.701 49.8438 173.949 49.718C173.815 50.0174 173.44 49.8114 173.093 49.6659C172.642 49.6397 172.191 49.6136 171.74 49.5876C168.106 49.4098 164.472 49.2612 160.837 49.1172C153.373 49.0236 145.908 49.2408 138.444 49.3703C133.149 49.427 127.852 49.5518 122.558 49.3633C120.444 49.2881 117.57 49.1203 115.437 49.0035C110.584 48.6067 105.73 48.2379 100.877 47.8427C98.842 47.9504 96.8077 48.0846 94.7758 48.2936C87.3182 49.0019 79.8548 49.5701 72.3933 50.1856C69.8623 50.3926 66.4734 50.6885 63.9388 50.8177C58.4648 51.0948 52.9825 51.0268 47.5093 50.8085C43.5068 50.5717 39.5054 50.3078 35.5013 50.123C30.3854 49.8869 32.9323 50.0123 28.1628 49.88C27.2621 49.8549 26.3616 49.8194 25.4609 49.7899C22.3652 49.7079 12.2688 49.677 9.17236 49.6978C5.47198 49.6339 5.67331 44.211 8 42C8.07948 41.9245 8.33259 41.4759 8 41.5C6.47918 41.61 5.64275 41.4975 5.5 41.5C5.02116 41.5083 4.5 41.5 3.87129 41.5123C3.32549 41.366 2.31064 41.6369 2.27138 40.8583C2.15819 38.6146 2.68072 36.4208 3.09717 34.2182C-1.21939 33.753 -0.970958 25.0183 3.51127 25.178C3.99716 25.2075 4.48326 25.2267 4.9694 25.2474C5.2292 25.2603 5.4888 25.2776 5.74857 25.2937C5.72181 24.6563 5.77984 24.0155 5.93424 23.4133C3.42924 21.813 3.42411 16.1717 6.50314 14.9809C5.66566 12.2889 5.55028 8.94907 8.5 9H11C12.7587 9.07973 11.5915 9.04508 13.3505 9.10983C12.2589 6.40741 13.293 2.23105 16.3984 2.28451C18.0195 2.40513 29.6377 2.25962 31.2557 2.11559C37.1457 1.61688 43.0372 1.17822 48.9315 0.799789C56.0986 0.216603 63.2768 0.0937773 70.4529 0.000216888C78.2233 -0.00824042 85.9911 0.231347 93.7561 0.595035C100.479 1.01972 107.204 1.3753 113.929 1.73034C120.446 2.07327 126.967 2.24182 133.487 2.37594C139.774 2.4901 146.055 1.95931 152.337 1.69616C153.467 1.65952 154.597 1.61507 155.727 1.58603C158.937 1.50123 159.154 1.55216 162.305 1.40076C165.236 1.25998 168.166 1.02483 171.094 0.783297C176.216 0.296921 181.347 0.217881 186.477 0.208663Z"
            fill="url(#follow-brush-destructive)"
            className="opacity-0 transition-opacity group-hover:opacity-100"
          />
        </>
      ) : (
        <path
          d="M186.477 0.208663C187.89 0.212811 189.303 0.235174 190.715 0.265592L190.717 0.269671C194.955 0.362725 199.191 0.545209 203.428 0.676331C207.842 0.817294 212.257 0.888021 216.672 0.927888C218.261 0.938258 219.851 0.965472 221.44 0.97469L222.592 0.983902C225.051 1.02458 226.146 3.67677 225.927 6.10058C228.121 6.13538 230.314 6.16603 232.508 6.19299C233.616 6.23751 234.726 6.19481 235.834 6.23814C236.066 6.24689 236.468 5.97096 236.531 6.28561C237.094 9.12782 237.648 14.0329 237.574 15.0164C237.5 16 236.287 16.81 236.287 16.81C237.404 16.8335 238.521 16.8543 239.638 16.8681C243.822 16.9444 244.073 24.5969 240.544 25.7554C240.833 27.8721 240.09 30.2609 238.328 30.9767C238.936 32.1364 239.108 33.7955 238.621 36.4579C238.406 37.6371 237.212 37.8792 236.508 38.5898C235.992 38.7375 235.481 38.922 234.961 39.0334C234.642 39.1013 234.323 39.1603 234.004 39.2225C233.868 39.7007 233.406 39.6774 232.528 39.6331L232.435 39.6284C233.03 47.3388 231.661 47.431 228.796 47.3734C228.542 47.3681 226.632 47.2803 226.471 47.2711C225.079 47.1988 223.687 47.1039 222.295 47.0126C222.27 47.1168 222.253 47.1875 222.228 47.2954L222.253 47.4466C222.801 50.6782 222.832 50.8622 221.519 50.3858L221.518 50.3875C221.378 51.0233 220.572 50.3334 220.098 50.3006C219.34 50.2486 218.582 50.1848 217.824 50.1338C214.809 49.9317 214.599 49.9261 214.047 49.8761C211.479 49.7409 208.913 49.5308 206.351 49.2517C202.458 48.8155 198.568 48.3056 194.671 47.9481C193.235 47.8331 191.799 47.729 190.362 47.6253C185.713 47.4799 181.062 47.4541 176.412 47.4448C176.578 50.119 175.701 49.8438 173.949 49.718C173.815 50.0174 173.44 49.8114 173.093 49.6659C172.642 49.6397 172.191 49.6136 171.74 49.5876C168.106 49.4098 164.472 49.2612 160.837 49.1172C153.373 49.0236 145.908 49.2408 138.444 49.3703C133.149 49.427 127.852 49.5518 122.558 49.3633C120.444 49.2881 117.57 49.1203 115.437 49.0035C110.584 48.6067 105.73 48.2379 100.877 47.8427C98.842 47.9504 96.8077 48.0846 94.7758 48.2936C87.3182 49.0019 79.8548 49.5701 72.3933 50.1856C69.8623 50.3926 66.4734 50.6885 63.9388 50.8177C58.4648 51.0948 52.9825 51.0268 47.5093 50.8085C43.5068 50.5717 39.5054 50.3078 35.5013 50.123C30.3854 49.8869 32.9323 50.0123 28.1628 49.88C27.2621 49.8549 26.3616 49.8194 25.4609 49.7899C22.3652 49.7079 12.2688 49.677 9.17236 49.6978C5.47198 49.6339 5.67331 44.211 8 42C8.07948 41.9245 8.33259 41.4759 8 41.5C6.47918 41.61 5.64275 41.4975 5.5 41.5C5.02116 41.5083 4.5 41.5 3.87129 41.5123C3.32549 41.366 2.31064 41.6369 2.27138 40.8583C2.15819 38.6146 2.68072 36.4208 3.09717 34.2182C-1.21939 33.753 -0.970958 25.0183 3.51127 25.178C3.99716 25.2075 4.48326 25.2267 4.9694 25.2474C5.2292 25.2603 5.4888 25.2776 5.74857 25.2937C5.72181 24.6563 5.77984 24.0155 5.93424 23.4133C3.42924 21.813 3.42411 16.1717 6.50314 14.9809C5.66566 12.2889 5.55028 8.94907 8.5 9H11C12.7587 9.07973 11.5915 9.04508 13.3505 9.10983C12.2589 6.40741 13.293 2.23105 16.3984 2.28451C18.0195 2.40513 29.6377 2.25962 31.2557 2.11559C37.1457 1.61688 43.0372 1.17822 48.9315 0.799789C56.0986 0.216603 63.2768 0.0937773 70.4529 0.000216888C78.2233 -0.00824042 85.9911 0.231347 93.7561 0.595035C100.479 1.01972 107.204 1.3753 113.929 1.73034C120.446 2.07327 126.967 2.24182 133.487 2.37594C139.774 2.4901 146.055 1.95931 152.337 1.69616C153.467 1.65952 154.597 1.61507 155.727 1.58603C158.937 1.50123 159.154 1.55216 162.305 1.40076C165.236 1.25998 168.166 1.02483 171.094 0.783297C176.216 0.296921 181.347 0.217881 186.477 0.208663Z"
          fill="url(#follow-brush-gradient)"
        />
      )}
    </svg>
  );
}
