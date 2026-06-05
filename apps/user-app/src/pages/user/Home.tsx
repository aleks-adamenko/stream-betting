import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, BadgeCheck, Users } from "lucide-react";

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
import { useEventProgress } from "@/hooks/useEventProgress";
import { useLiveOdds } from "@/hooks/useLiveOdds";
import { cn } from "@/lib/utils";
import rewardsBannerMobile from "@/assets/rewards-banner-1.jpg";
import rewardsBannerDesktop from "@/assets/rewards-banner-2.jpg";
import noLiveCoverMobile from "@/assets/live-rush-cover-image-3.jpg";
import noLiveCoverDesktop from "@/assets/live-rush-cover-image-2.jpg";
import type { Influencer, StreamEvent } from "@/domain/types";

const TEST_STREAM = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// `/trending` was retired together with the desktop layout overhaul —
// `/live` is now the only path that opens the snap-feed view. Kept as
// a const-set rather than a hardcoded equality check so re-adding a
// snap-feed route in the future is a one-line tweak.
const FEED_ROUTES = new Set<string>(["/live"]);

export default function Home() {
  const { pathname } = useLocation();
  const { data: allEvents, isLoading } = useEvents();
  const isFeedRoute = FEED_ROUTES.has(pathname);

  // /live uses the TikTok-style snap feed.
  if (isFeedRoute) {
    return <FeedView events={allEvents} isLoading={isLoading} />;
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
  const { featured, live, upcoming, past, topCreators } = useMemo(() => {
    if (!events) {
      return {
        featured: null,
        live: [],
        upcoming: [],
        past: [],
        topCreators: [] as CreatorTally[],
      };
    }
    const live = events.filter((e) => e.status === "live");
    const scheduled = events.filter((e) => e.status === "scheduled");
    // Finished spans every terminal state — finished + settled +
    // pending_moderation + cancelled. The card UI treats them all
    // the same; the difference (winner declared, payouts released,
    // fully cancelled with refunds) only matters on the detail page.
    // Cancelled stays visible so the public feed mirrors the
    // creator's complete stream history; archive_event / delete_event
    // are the only hide signals.
    const finished = events.filter(
      (e) =>
        e.status === "finished" ||
        e.status === "pending_moderation" ||
        e.status === "settled" ||
        e.status === "cancelled",
    );
    const featured = live[0] ?? null;
    // Top creators — count every event (any status) per creator,
    // then sort descending. The Top Creators row shows whichever
    // creators have run the most challenges so far. Capped to 6 so
    // the row stays a single line at lg+ (matches the 5-up event
    // grids — one extra slot fits comfortably with the narrower
    // avatar tiles).
    const tally = new Map<string, CreatorTally>();
    for (const event of events) {
      const id = event.influencer.id;
      const entry = tally.get(id) ?? {
        creator: event.influencer,
        total: 0,
      };
      entry.total += 1;
      tally.set(id, entry);
    }
    const topCreators = Array.from(tally.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 7);
    // "Past challenges" surfaces finished/settled/cancelled streams
    // only — the section's Show more link drops the viewer onto
    // /discover/ended, so the home preview matches what the
    // ended-filter route would show.
    return {
      featured,
      live,
      upcoming: scheduled,
      past: finished,
      topCreators,
    };
  }, [events]);

  return (
    <PageContainer className="lg:pt-[18px]">
      {isLoading && <HomeSkeleton />}

      {!isLoading && featured && (
        <FeaturedLiveSection event={featured} />
      )}

      {/* No live streams right now — render a branded cover hero in the
          slot the FeaturedLiveSection would otherwise occupy. Two
          aspect ratios baked into the source files: 1200×630 social-card
          for phones, 1920×418 letterbox for desktop. */}
      {!isLoading && !featured && (
        <NoLiveCover />
      )}

      {!isLoading && live.length > 0 && (
        <Section
          title="Live now"
          showAllHref="/discover/live"
          className="mt-8 sm:mt-10"
        >
          <EventGrid events={live.slice(0, 4)} />
        </Section>
      )}

      {!isLoading && upcoming.length > 0 && (
        <Section
          title="Upcoming"
          showAllHref="/discover/upcoming"
          className="mt-8 sm:mt-10"
        >
          <EventGrid events={upcoming.slice(0, 4)} />
        </Section>
      )}

      {!isLoading && topCreators.length > 0 && (
        <Section
          title="Top Creators"
          showAllHref="/following"
          className="mt-8 sm:mt-10"
        >
          <TopCreatorsRow creators={topCreators} />
        </Section>
      )}

      {!isLoading && past.length > 0 && (
        <Section
          title="Past Challenges"
          showAllHref="/discover/ended"
          className="mt-8 sm:mt-10"
        >
          <EventGrid events={past.slice(0, 4)} />
        </Section>
      )}

      {!isLoading && <RewardsBanner className="mt-8 sm:mt-10" />}
    </PageContainer>
  );
}

/**
 * "Nothing live right now" hero — drops in where the live-stream
 * featured card would normally sit on the Home page. Same rounded
 * card visual language as the rest of the page (border, shadow).
 * Decorative only (no link) since there's no clear destination —
 * the sections below it (Upcoming / Discover more) carry the actual
 * navigation. Two source files: 1200×630 for phones, 1920×418
 * letterbox for desktop.
 */
function NoLiveCover() {
  return (
    <div className="block w-full overflow-hidden rounded-2xl border border-border/30 bg-card shadow-lg">
      <img
        src={noLiveCoverMobile}
        alt=""
        className="block h-auto w-full lg:hidden"
      />
      <img
        src={noLiveCoverDesktop}
        alt=""
        className="hidden h-auto w-full lg:block"
      />
    </div>
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
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

interface CreatorTally {
  creator: Influencer;
  /** Total events run by this creator (any status). */
  total: number;
}

/**
 * Top creators row sorted by most challenges. Single horizontal
 * row at every breakpoint — 5 tiles on mobile (`grid-cols-5`), 7
 * on desktop (`lg:grid-cols-7`). We render up to 7 always; the 6th
 * and 7th `<li>` are `hidden lg:flex` so they're invisible on
 * mobile and don't claim grid cells there.
 *
 * Per-row tiles aren't individually clickable — the section's
 * "Show all" link in the header already routes to /following, and
 * there's no per-creator detail page yet.
 */
function TopCreatorsRow({ creators }: { creators: CreatorTally[] }) {
  return (
    <ul className="grid grid-cols-5 gap-2 sm:gap-3 lg:grid-cols-7 lg:gap-4">
      {creators.map(({ creator }, index) => (
        <li
          key={creator.id}
          className={cn(
            "flex min-w-0 flex-col items-center text-center",
            // Mobile fits 5; everything past that is desktop-only.
            index >= 5 && "hidden lg:flex",
          )}
        >
          <img
            src={creator.avatarUrl}
            alt={creator.displayName}
            className="h-16 w-16 rounded-full object-cover ring-2 ring-primary/20 lg:h-24 lg:w-24"
          />
          <p className="mt-2 w-full truncate font-heading text-xs font-semibold text-foreground lg:mt-3 lg:text-sm">
            {creator.displayName}
          </p>
        </li>
      ))}
    </ul>
  );
}

function EventGrid({ events }: { events: StreamEvent[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}

/* ---------- featured live section ---------- */

/**
 * Featured-live hero on the Home page.
 *
 * Single rounded container that splits into two columns on desktop:
 *   • Left: video player (16:9, no own border-radius — parent clips it).
 *   • Right: event title, description, creator avatar + name + follower
 *     count. No bet panel here anymore — viewers tap through to the
 *     event page to actually bet.
 *
 * The whole card is a single <Link> so any tap that isn't inside the
 * player iframe takes the viewer to /event/:id. Iframe controls
 * (play/pause/volume) stay isolated inside their own document and
 * don't bubble to the parent.
 *
 * On mobile it stacks: video on top, info card under it. Same rounded
 * outer container clips both into one card.
 */
function FeaturedLiveSection({ event }: { event: StreamEvent }) {
  const { user } = useAuth();
  // Same Realtime channel that the BetPanel uses on the event page —
  // every bet placed anywhere in the system pings every connected
  // viewer's `useLiveOdds`, so the Home hero's odds chips re-flow
  // without a refresh. Per-outcome live odds are null until the
  // pool gets its first bet; we render "Open" in that case.
  const { data: liveOddsData } = useLiveOdds(event.id);
  // Same readiness gate as the event-page BetPanel: don't surface
  // odds in the Home hero until the event has enough unique bettors,
  // outcomes with bets, and pool to actually settle. Otherwise
  // viewers see misleading "2.00×" / sub-1× numbers on an event
  // that's guaranteed to refund.
  const { data: progress } = useEventProgress(event.id);
  const liveOddsById = new Map(
    liveOddsData.outcomes.map((o) => [o.outcome_id, o.live_odds] as const),
  );
  // Signed-in viewers go straight to the event page where the
  // BetPanel lives. Signed-out viewers hit sign-in first with a
  // `next=` redirect so they land on the event after auth.
  const betHref = user
    ? `/event/${event.id}`
    : `/auth/sign-in?next=${encodeURIComponent(`/event/${event.id}`)}`;

  return (
    <Link
      to={`/event/${event.id}`}
      // `lg:min-h-[440px]` makes the desktop hero ~30% taller than the
      // natural 16:9 footprint, giving the featured stream more visual
      // weight on the page. items-stretch makes both columns share the
      // same height; the player letterboxes the 16:9 video inside the
      // taller frame.
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/30 bg-card shadow-lg transition-shadow hover:shadow-xl lg:min-h-[440px] lg:flex-row lg:items-stretch"
    >
      {/* Video column — flex-1 so it absorbs whatever horizontal space
          the info column doesn't claim. Mobile keeps the 16:9 aspect
          for a clean phone shot; on lg+ we let height come from the
          parent's min-h so the video fills the taller frame. */}
      <div className="relative aspect-video w-full bg-black lg:aspect-auto lg:flex-1">
        <FeaturedPlayerInner event={event} />
        {/* Top-left badges — LIVE + viewer count. These stay over the
            video; everything else (title, creator) has moved into the
            info column to clean up the player frame. */}
        <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2">
          <LiveBadge />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white backdrop-blur">
            <Users className="h-3.5 w-3.5" />
            {numberFormatter.format(event.viewersCount)} watching
          </span>
        </div>
      </div>

      {/* Info column — title / description / creator. The width is
          `(parent − 16px) / 2`, which is exactly the span of two
          EventCards plus the gap between them in the grid below. That
          way the card edges align visually as the eye runs down the
          page. mt-auto on the creator row pins it to the bottom of
          the column when the description is short. */}
      <div className="flex min-w-0 flex-col gap-3 p-5 sm:p-6 lg:w-[calc((100%-1rem)/2)] lg:flex-shrink-0">
        {/* Title + description sizing matches EventCard below the
            featured hero — same `text-base font-semibold` for the
            title and `text-sm` for the description, so the typography
            reads consistent down the page even though the featured
            card is laid out larger. */}
        <h2 className="font-heading text-base font-semibold leading-tight text-foreground">
          {event.title}
        </h2>
        {event.description && (
          <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
            {event.description}
          </p>
        )}

        {/* Outcomes list with odds. flex-1 lets this section absorb
            the remaining vertical space in the info column; overflow
            + mask-image gradient fades the bottom 25% so an
            outcome list too long for the container trails off
            smoothly instead of getting hard-clipped or pushing the
            CTA below the fold. */}
        {event.outcomes.length > 0 && (
          <div
            className="min-h-0 flex-1 overflow-hidden"
            style={{
              WebkitMaskImage:
                "linear-gradient(to bottom, black 75%, transparent 100%)",
              maskImage:
                "linear-gradient(to bottom, black 75%, transparent 100%)",
            }}
          >
            <ul className="space-y-1.5">
              {event.outcomes.map((o) => {
                const odds = progress.minimumsMet
                  ? (liveOddsById.get(o.id) ?? null)
                  : null;
                return (
                  <li
                    key={o.id}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="truncate font-medium text-foreground">
                      {o.label}
                    </span>
                    <span
                      className={
                        odds == null
                          ? "flex-shrink-0 font-heading text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                          : "flex-shrink-0 font-heading font-bold tabular-nums text-foreground"
                      }
                    >
                      {odds == null ? "Open" : `${odds.toFixed(2)}×`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Place a bet — routes to the event page (or sign-in for
            signed-out viewers). stopPropagation on the inner Link
            click stops the parent Link from also navigating, so the
            sign-in redirect for unauthed viewers doesn't race the
            outer "go to event" nav. */}
        <Button asChild variant="accent" size="lg" className="w-full">
          <Link to={betHref} onClick={(e) => e.stopPropagation()}>
            {user ? "Place a bet" : "Sign in to bet"}
          </Link>
        </Button>

        <div className="flex items-center gap-2 pt-2">
          <img
            src={event.influencer.avatarUrl}
            alt={event.influencer.displayName}
            className="h-8 w-8 flex-shrink-0 rounded-full object-cover ring-2 ring-border/40"
          />
          <span className="truncate text-sm font-semibold text-foreground">
            {event.influencer.displayName}
          </span>
          <BadgeCheck className="h-4 w-4 flex-shrink-0 fill-primary text-white" />
          <span className="truncate text-xs text-muted-foreground">
            {compactFormatter.format(event.influencer.followers)} followers
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * The actual stream player choice — externalised so the surrounding
 * container can own positioning + overlays without nested concerns.
 * Picks between SocialVideoEmbed (Instagram / TikTok), Cloudflare
 * iframe (live streams), and HlsPlayer fallback (legacy / test).
 */
function FeaturedPlayerInner({ event }: { event: StreamEvent }) {
  const socialUrl =
    event.videoUrl && resolveSocialEmbedUrl(event.videoUrl)
      ? event.videoUrl
      : null;

  if (socialUrl) {
    return <SocialVideoEmbed url={socialUrl} title={event.title} fit="contain" />;
  }
  if (isCloudflareStreamUrl(event.playbackUrl)) {
    return (
      <CloudflareStreamPlayer
        src={event.playbackUrl!}
        poster={event.coverUrl}
        autoPlay
        muted
      />
    );
  }
  return (
    <HlsPlayer
      src={event.playbackUrl ?? TEST_STREAM}
      poster={event.coverUrl}
      autoPlay
      muted
    />
  );
}

/* ============================================================
 * Old TikTok-style feed view — used for /live and /trending
 * ============================================================ */

function FeedView({
  events,
  isLoading,
}: {
  events: StreamEvent[] | undefined;
  isLoading: boolean;
}) {
  // After the layout overhaul `/live` is the only snap-feed route, so
  // FeedView always shows live events. The old `tab` prop + trending
  // branch (sorted by viewers+pool) was retired together with the
  // /trending route.
  const filtered = useMemo(() => {
    if (!events) return [];
    return events.filter((e) => e.status === "live");
  }, [events]);

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
