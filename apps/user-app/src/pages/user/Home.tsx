import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Users } from "lucide-react";

import { EventCard } from "@/components/feed/EventCard";
import { FeedArrows } from "@/components/feed/FeedArrows";
import { FeedSkeleton } from "@/components/feed/FeedSkeleton";
import { LiveBadge } from "@/components/feed/LiveBadge";
import { StreamCard } from "@/components/feed/StreamCard";
import { HlsPlayer } from "@/components/stream/HlsPlayer";
import {
  CloudflareStreamPlayer,
  isCloudflareStreamUrl,
} from "@/components/stream/CloudflareStreamPlayer";
import {
  SocialVideoEmbed,
  resolveSocialEmbedUrl,
} from "@/components/stream/SocialVideoEmbed";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { useAuth } from "@/contexts/AuthContext";
import { useEvents } from "@/hooks/useEvents";
import { oddsPillClasses, oddsRange } from "@/lib/odds";
import { cn } from "@/lib/utils";
import rewardsBannerMobile from "@/assets/rewards-banner-1.jpg";
import rewardsBannerDesktop from "@/assets/rewards-banner-2.jpg";
import type { StreamEvent } from "@/domain/types";

const TEST_STREAM = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

const numberFormatter = new Intl.NumberFormat("en-US");

type FeedTab = "live" | "trending";
const PATH_TO_FEED: Record<string, FeedTab> = {
  "/live": "live",
  "/trending": "trending",
};

export default function Home() {
  const { pathname } = useLocation();
  const { data: allEvents, isLoading } = useEvents();
  const feedTab = PATH_TO_FEED[pathname];

  // /live and /trending still use the original TikTok-style snap feed.
  if (feedTab) {
    return (
      <FeedView events={allEvents} isLoading={isLoading} tab={feedTab} />
    );
  }

  return (
    <SectionedHome events={allEvents} isLoading={isLoading} />
  );
}

/* ============================================================
 * New sectioned home for "/"
 * ============================================================ */

function SectionedHome({
  events,
  isLoading,
}: {
  events: StreamEvent[] | undefined;
  isLoading: boolean;
}) {
  const { featured, live, upcoming, more } = useMemo(() => {
    if (!events) {
      return { featured: null, live: [], upcoming: [], more: [] };
    }
    const live = events.filter((e) => e.status === "live");
    const scheduled = events.filter((e) => e.status === "scheduled");
    const finished = events.filter((e) => e.status === "finished");
    const featured = live[0] ?? null;
    // "Discover more" highlights everything else the user hasn't seen above.
    const seen = new Set<string>();
    if (featured) seen.add(featured.id);
    live.slice(0, 4).forEach((e) => seen.add(e.id));
    scheduled.slice(0, 4).forEach((e) => seen.add(e.id));
    const more = [
      ...live,
      ...scheduled,
      ...finished,
    ].filter((e) => !seen.has(e.id));
    return { featured, live, upcoming: scheduled, more };
  }, [events]);

  return (
    <PageContainer className="lg:pt-[18px]">
      {isLoading && <HomeSkeleton />}

      {!isLoading && featured && (
        <FeaturedLiveSection event={featured} />
      )}

      {!isLoading && live.length > 0 && (
        <Section title="Live now" showAllHref="/live" className="mt-8 sm:mt-10">
          <EventGrid events={live.slice(0, 4)} />
        </Section>
      )}

      {!isLoading && upcoming.length > 0 && (
        <Section title="Upcoming" showAllHref="/discover" className="mt-8 sm:mt-10">
          <EventGrid events={upcoming.slice(0, 4)} />
        </Section>
      )}

      {!isLoading && more.length > 0 && (
        <Section
          title="Discover more"
          showAllHref="/discover"
          className="mt-8 sm:mt-10"
        >
          <EventGrid events={more.slice(0, 4)} />
        </Section>
      )}

      {!isLoading && <RewardsBanner className="mt-8 sm:mt-10" />}
    </PageContainer>
  );
}

function RewardsBanner({ className }: { className?: string }) {
  // ProtectedRoute on /rewards bounces unauthenticated users to
  // /auth/sign-in?next=/rewards, so this single link covers both cases.
  return (
    <Link
      to="/rewards"
      aria-label="Rewards"
      className={cn(
        "block w-full overflow-hidden rounded-2xl border border-border/40 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className,
      )}
    >
      <img
        src={rewardsBannerMobile}
        alt=""
        className="block h-auto w-full lg:hidden"
      />
      <img
        src={rewardsBannerDesktop}
        alt=""
        className="hidden h-auto w-full lg:block"
      />
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr] lg:gap-8">
        <div className="aspect-video animate-pulse rounded-2xl bg-muted" />
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[5/4] animate-pulse rounded-xl bg-muted"
          />
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  showAllHref,
  className,
  children,
}: {
  title: string;
  showAllHref: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="font-heading text-xl font-bold sm:text-2xl">{title}</h2>
        <Link
          to={showAllHref}
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          Show all
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      {children}
    </section>
  );
}

function EventGrid({ events }: { events: StreamEvent[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}

/* ---------- featured live section ---------- */

function FeaturedLiveSection({ event }: { event: StreamEvent }) {
  // Desktop: horizontal player (16:9) + a 420px bet panel matching
  // the EventDetails layout exactly. Mobile: stacked.
  return (
    <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      <div className="min-w-0 flex-1">
        <FeaturedPlayer event={event} />
      </div>
      <div className="w-full lg:w-[420px] lg:flex-shrink-0">
        <SimpleBetPanel event={event} />
      </div>
    </section>
  );
}

function FeaturedPlayer({ event }: { event: StreamEvent }) {
  const socialUrl =
    event.videoUrl && resolveSocialEmbedUrl(event.videoUrl) ? event.videoUrl : null;
  return (
    <Link
      to={`/event/${event.id}`}
      // Horizontal 16:9 player — matches a video frame's natural ratio
      // so external Instagram / TikTok / WebRTC sources don't end up
      // letterboxed inside a portrait container. Cloudflare HLS streams
      // play through the same HlsPlayer as the fallback test stream.
      className="group relative block aspect-video w-full overflow-hidden rounded-2xl border border-border/30 bg-black shadow-lg"
    >
      {socialUrl ? (
        <SocialVideoEmbed url={socialUrl} title={event.title} fit="contain" />
      ) : isCloudflareStreamUrl(event.playbackUrl) ? (
        <CloudflareStreamPlayer
          src={event.playbackUrl!}
          poster={event.coverUrl}
          autoPlay
          muted
        />
      ) : (
        <HlsPlayer
          src={event.playbackUrl ?? TEST_STREAM}
          poster={event.coverUrl}
          autoPlay
          muted
        />
      )}

      {/* Top-left badges */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2">
        <LiveBadge />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          <Users className="h-3.5 w-3.5" />
          {numberFormatter.format(event.viewersCount)} watching
        </span>
      </div>

      {/* Bottom gradient + title */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pb-4 pt-16">
        <h2 className="font-heading text-base font-extrabold leading-tight text-white drop-shadow sm:text-lg">
          {event.title}
        </h2>
        <div className="mt-2 flex items-center gap-2">
          <img
            src={event.influencer.avatarUrl}
            alt={event.influencer.displayName}
            className="h-6 w-6 flex-shrink-0 rounded-full object-cover ring-2 ring-white/40"
          />
          <span className="truncate text-sm font-semibold text-white">
            {event.influencer.displayName}
          </span>
        </div>
      </div>
    </Link>
  );
}

function SimpleBetPanel({ event }: { event: StreamEvent }) {
  const { user } = useAuth();
  const { min: oddsMin, max: oddsMax } = oddsRange(
    event.outcomes.map((o) => o.odds),
  );

  const eventHref = user
    ? `/event/${event.id}`
    : `/auth/sign-in?next=${encodeURIComponent(`/event/${event.id}`)}`;

  return (
    <section className="card-elevated flex flex-col overflow-hidden">
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        {/* Plain list of outcomes — informational only. The Place bet
            button below takes the user to the event page to actually bet. */}
        <ul className="space-y-2">
          {event.outcomes.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate text-sm font-medium text-foreground">
                {o.label}
              </span>
              <span
                className={cn(
                  "inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums",
                  oddsPillClasses(o.odds, oddsMin, oddsMax),
                )}
              >
                {o.odds.toFixed(2)}×
              </span>
            </li>
          ))}
        </ul>

        <Button
          asChild
          variant="accent"
          size="lg"
          className="mt-8 w-full"
        >
          <Link to={eventHref}>
            {user ? "Place a bet" : "Sign in to bet"}
          </Link>
        </Button>
      </div>
    </section>
  );
}

/* ============================================================
 * Old TikTok-style feed view — used for /live and /trending
 * ============================================================ */

function FeedView({
  events,
  isLoading,
  tab,
}: {
  events: StreamEvent[] | undefined;
  isLoading: boolean;
  tab: FeedTab;
}) {
  const filtered = useMemo(() => {
    if (!events) return [];
    if (tab === "live") return events.filter((e) => e.status === "live");
    return events
      .filter((e) => e.status !== "finished")
      .sort(
        (a, b) =>
          b.viewersCount + b.totalPool - (a.viewersCount + a.totalPool),
      );
  }, [events, tab]);

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-4 sm:px-4 sm:py-6">
      <FeedArrows />
      <div className="flex flex-col gap-5 sm:gap-6">
        {isLoading && <FeedSkeleton count={2} />}
        {!isLoading &&
          filtered.map((event, i) => (
            <Fragment key={event.id}>
              <StreamCard event={event} />
              {i === 0 && <RewardsBannerCard />}
            </Fragment>
          ))}
        {!isLoading && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
            <p className="font-heading text-base font-semibold">
              Nothing here yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a different tab or check back soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function RewardsBannerCard() {
  return (
    <article className="relative mx-auto w-full max-w-[520px] snap-start scroll-mt-4">
      <Link
        to="/rewards"
        aria-label="Rewards"
        className="block w-full overflow-hidden rounded-2xl border border-border/40 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <img src={rewardsBannerMobile} alt="" className="block h-auto w-full" />
      </Link>
    </article>
  );
}
