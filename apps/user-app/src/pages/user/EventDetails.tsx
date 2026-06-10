import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell,
  Calendar,
  ChevronDown,
  ChevronUp,
  Users,
  Trophy,
  LogIn,
  BadgeCheck,
  Star,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { BrushButton } from "@/components/ui/BrushButton";
import { Button } from "@/components/ui/button";
import { CoinAmount, CoinIcon } from "@/components/ui/CoinAmount";
import { LiveBadge } from "@/components/feed/LiveBadge";
import { HlsPlayer } from "@/components/stream/HlsPlayer";
import {
  CloudflareStreamPlayer,
  isCloudflareStreamUrl,
} from "@/components/stream/CloudflareStreamPlayer";
import { BettingCountdown } from "@liverush/ui";
import {
  SocialVideoEmbed,
  resolveSocialEmbedUrl,
} from "@/components/stream/SocialVideoEmbed";
import { PageContainer } from "@/components/layout/PageContainer";
import { eventsKeys, useEvent, useEvents } from "@/hooks/useEvents";
import { supabase } from "@/integrations/supabase/client";
import { useCreatorFollow } from "@/hooks/useCreatorFollow";
import { useEventSubscription } from "@/hooks/useEventSubscription";
import { useEventViewers } from "@/hooks/useEventViewers";
import { useAuth } from "@/contexts/AuthContext";
import { useNotificationsToast } from "@/contexts/NotificationsContext";
import { parseBetError } from "@/lib/betError";
import { ChatPanel } from "@/components/event/ChatPanel";
import rewardsBannerImg from "@/assets/rewards-banner-1.jpg";
import { placeBet } from "@/services/betsService";
import { betsKeys, useMyBets } from "@/hooks/useMyBets";
import { useLiveOdds } from "@/hooks/useLiveOdds";
import { useEventProgress, type EventProgress } from "@/hooks/useEventProgress";
import { useEventRoundsSummary } from "@/hooks/useEventRoundsSummary";
import { useEventChat } from "@/hooks/useEventChat";
import type { BetOutcome, StreamEvent } from "@/domain/types";
import { cn } from "@/lib/utils";
import { oddsPillClasses, oddsRange } from "@/lib/odds";
import {
  liveOddsFor,
  payoutPreview,
  MAX_BET_CENTS,
  MIN_BET_CENTS,
} from "@liverush/lib";

// Stake chips shown beneath the stake input. Capped to MAX_BET so a
// viewer can't pick a chip that would fail the server-side validator.
const STAKE_CHIPS = [1, 5, 10];

// Statuses the bet form is allowed to be open in — every betting
// gate elsewhere (RPC + Realtime status flips) hangs off this.
const BETTING_OPEN_STATUSES = new Set(["live"]);
import { useSeo } from "@/lib/useSeo";

const TEST_STREAM = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export default function EventDetails() {
  const { id } = useParams<{ id: string }>();
  const { data: event, isLoading } = useEvent(id);
  const { data: allEvents } = useEvents();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [overlaysHidden, setOverlaysHidden] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Other events list (desktop-only left column). Excludes the
  // current event + finished/cancelled ones. Live first, then
  // scheduled. Within the scheduled bucket the soonest upcoming
  // event sits at the top (ascending `scheduledAt`); live events
  // keep whatever order the upstream `useEvents` query returns.
  const otherEvents = useMemo(() => {
    if (!allEvents) return [];
    return allEvents
      .filter(
        (e) =>
          e.id !== id &&
          (e.status === "live" || e.status === "scheduled"),
      )
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "live" ? -1 : 1;
        if (a.status === "live") return 0;
        return (
          new Date(a.scheduledAt).getTime() -
          new Date(b.scheduledAt).getTime()
        );
      });
  }, [allEvents, id]);
  // Mute state lifted from CloudflareStreamPlayer so the fullscreen
  // bet overlay can render its own sound toggle at bottom-centre
  // (the player's own button would otherwise sit behind the overlay
  // gradient). Defaults to true — muted is what browser autoplay
  // policies expect, and the user-app player loads on page mount.
  const [videoMuted, setVideoMuted] = useState(true);
  const betPanelRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  // Real-time viewer count. `track: true` registers this client in
  // the presence channel so it counts towards the total — the studio
  // creator on the LiveStream page sees it instantly via the same
  // channel.
  const viewerCount = useEventViewers(id, { track: true });

  // Subscribe to UPDATE events on this event row so the page reacts
  // to status flips without manual refresh — most importantly,
  // live → finished when the creator hits End stream. We invalidate
  // the useEvent query on every update; React Query refetches and
  // the page re-renders into whatever the new status calls for
  // (e.g. CloudflareStreamPlayer → cover image + "Event ended" pill).
  //
  // Defer the channel setup to a microtask so React Strict Mode's
  // mount → cleanup → remount sequence resolves cleanly. Without
  // the defer, calling `.on()` on a channel that has already
  // transitioned to "joined" from the discarded first mount throws
  // inside Supabase.
  useEffect(() => {
    if (!id) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    const setupId = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`event:${id}:status`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "events",
            filter: `id=eq.${id}`,
          },
          () => {
            void queryClient.invalidateQueries({
              queryKey: eventsKeys.detail(id),
            });
            // Multi-round: when the streamer advances rounds
            // (advance_round → current_round bumps and the prior
            // round's bets settle to won/lost/refunded), we want the
            // viewer's bet list to refresh too so My Bets / the "Your
            // bet" panel show the new status without a manual reload.
            // The BetPanel's myEventBets filter is keyed on
            // round_index === currentRound so each outcome becomes
            // clickable again the moment the new event row arrives;
            // this just keeps the underlying bet rows accurate.
            void queryClient.invalidateQueries({ queryKey: betsKeys.mine() });
          },
        )
        .subscribe();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  // Hide LIVE / viewers / title overlay once the user starts scrolling so the
  // sticky video container looks like a clean fixed player while reading.
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const onScroll = () => setOverlaysHidden(main.scrollTop > 0);
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, []);

  useSeo(
    event
      ? {
          title: `${event.title} | LiveRush`,
          description: event.description,
          image: event.coverUrl,
        }
      : null,
  );

  const handleHeaderBet = () => {
    if (!user) {
      navigate(`/auth/sign-in?next=${encodeURIComponent(`/event/${id}`)}`);
      return;
    }
    betPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Close fullscreen on Escape
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  if (isLoading) {
    return (
      <PageContainer>
        <div className="grid gap-6 lg:grid-cols-[240px_1.6fr_1fr] lg:gap-8">
          <div className="hidden h-96 animate-pulse rounded-2xl bg-muted lg:block" />
          <div className="space-y-4">
            <div className="aspect-video animate-pulse rounded-2xl bg-muted" />
            <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
          </div>
          <div className="h-96 animate-pulse rounded-2xl bg-muted" />
        </div>
      </PageContainer>
    );
  }

  // Deleted / never-existed event → bounce to home. We don't show a
  // "not found" interstitial because most of these come from stale
  // share links and the creator/viewer expectation is "where is it?"
  // not "why is it missing?". Home gives them somewhere to go.
  if (!event) {
    return <Navigate to="/" replace />;
  }

  const isLive = event.status === "live";
  const isScheduled = event.status === "scheduled";

  return (
    <PageContainer className="pt-4 lg:pt-[18px]">
      {/* 3-column desktop grid: [240px other-events | 1.6fr player+rules | 1fr bet+chat].
          Mobile collapses to a single column and the OtherEventsList
          is hidden — Home / Discover already surface the same data on
          phones. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1.6fr_1fr] lg:gap-8">
        {/* Left column — Other events (desktop only). Sticky so the
            viewer can browse other streams without losing the player. */}
        <aside className="hidden lg:sticky lg:top-[66px] lg:block lg:h-[calc(100dvh-84px)] lg:min-w-0">
          <OtherEventsList events={otherEvents} />
        </aside>

        <div className="contents lg:block lg:min-w-0 lg:space-y-6">
          <div className="contents lg:block lg:min-w-0 lg:space-y-3">
          {/* Stream / cover slot — full-bleed on mobile (negative margins cancel PageContainer padding), framed on desktop. Sticky on mobile so it pins to the top of the viewport as the user scrolls. Mobile only: tapping it expands to fullscreen (X close + bet overlay). */}
          <div
            ref={videoContainerRef}
            data-fullscreen-video={isFullscreen ? "true" : undefined}
            className={cn(
              isFullscreen
                ? "fixed inset-0 z-[60] bg-black"
                : // `lg:relative` (not `lg:static`) so the title overlay below
                  // anchors to the video container on desktop — `static` removes
                  // the positioning context and the overlay otherwise falls
                  // back to the viewport, appearing as a sticky page-bottom bar.
                  // Desktop: container fills the center column (1.6fr of the
                  // 3-col grid) at the default 16:9 aspect — the old 4:5 cap
                  // at 420px is gone so cover/live video both span the full
                  // column width. `max-h` still gates so the player never
                  // pushes everything else below the fold on short screens.
                  // Mobile keeps the natural 16:9 footprint. Desktop
                  // drops the aspect lock entirely and sets an
                  // explicit height — `100dvh − 84px` matches the
                  // sticky aside heights (48px topnav + 18px top +
                  // 18px bottom gutter) so the player fills the
                  // visible viewport and scales with the user's
                  // resolution. The video / cover inside uses
                  // object-contain (player) or object-cover
                  // (cover), so the tall container letterboxes
                  // 16:9 video while cropping cover art to fill.
                  "sticky top-0 z-20 -mx-4 -mt-4 aspect-[16/9] overflow-hidden bg-black shadow-lg sm:-mx-6 lg:relative lg:mx-0 lg:mt-0 lg:aspect-auto lg:h-[calc(100dvh-84px)] lg:rounded-2xl lg:border lg:border-border/30",
            )}
          >
            {isLive ? (
              event.videoUrl && resolveSocialEmbedUrl(event.videoUrl) ? (
                <SocialVideoEmbed
                  url={event.videoUrl}
                  title={event.title}
                  fullscreen={isFullscreen}
                />
              ) : isCloudflareStreamUrl(event.playbackUrl) ? (
                <CloudflareStreamPlayer
                  src={event.playbackUrl!}
                  poster={event.coverUrl}
                  muted={videoMuted}
                  onMutedChange={setVideoMuted}
                  // Suppress the player's own mute button while the
                  // fullscreen bet overlay is up — it would otherwise
                  // hide behind the overlay gradient. The overlay
                  // renders its own mute toggle at bottom-centre.
                  hideMuteButton={isFullscreen}
                />
              ) : (
                <HlsPlayer
                  src={event.playbackUrl ?? TEST_STREAM}
                  poster={event.coverUrl}
                  autoPlay
                  muted
                />
              )
            ) : (
              <img
                src={event.coverUrl}
                alt={event.title}
                className={cn(
                  "h-full w-full object-cover",
                  isScheduled ? "opacity-95" : "opacity-80",
                )}
              />
            )}

            {!isLive && (
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
            )}

            {/* Betting countdown — absolute against server's
                betting_closes_at so every viewer sees the same number.
                Centered at the top of the video container, fades with
                the rest of the overlays when the user hides them. */}
            {isLive && event.bettingClosesAt && (
              <div
                className={cn(
                  "pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 flex-col items-center gap-1.5 transition-opacity duration-200",
                  overlaysHidden && !isFullscreen && "opacity-0 lg:opacity-100",
                )}
              >
                {/* Round pill — multi-round events only. Sits ABOVE
                    the betting countdown so the viewer sees "Round 3
                    · betting ends in 4:12" as one stacked overlay.
                    Final round flips the pill to a destructive red
                    "FINAL ROUND" badge so it's unmistakable that no
                    more rounds follow. */}
                {event.roundFormat === "multi" && (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider tabular-nums backdrop-blur",
                      event.isFinalRound
                        ? "bg-destructive/85 text-destructive-foreground ring-1 ring-destructive-foreground/40"
                        : "bg-black/60 text-white ring-1 ring-white/20",
                    )}
                  >
                    {event.isFinalRound
                      ? "Final round"
                      : `Round ${event.currentRound}`}
                  </span>
                )}
                <BettingCountdown closesAt={event.bettingClosesAt} variant="overlay" />
              </div>
            )}

            <div
              className={cn(
                // Stacked vertically — Live on top, Viewers underneath —
                // so the centered "Betting ends in" countdown overlay
                // doesn't collide with the viewer pill on narrow widths.
                "pointer-events-none absolute left-4 top-4 flex flex-col items-start gap-1.5 transition-opacity duration-200",
                overlaysHidden && !isFullscreen && "opacity-0 lg:opacity-100",
              )}
            >
              {isLive && <LiveBadge />}
              {isLive && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                  <Users className="h-3.5 w-3.5" />
                  {numberFormatter.format(viewerCount)} watching
                </span>
              )}
            </div>

            {isScheduled && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
                  <Calendar className="h-3.5 w-3.5" />
                  Starts {new Date(event.scheduledAt).toLocaleString()}
                </span>
              </div>
            )}

            {!isLive && !isScheduled && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
                  <Trophy className="h-3.5 w-3.5" /> Event ended
                </span>
              </div>
            )}

            {/* Tap-to-expand overlay — mobile only, non-fullscreen */}
            {!isFullscreen && (
              <button
                type="button"
                aria-label="Expand video"
                onClick={() => setIsFullscreen(true)}
                className="absolute inset-0 z-[5] lg:hidden"
              />
            )}

            {/* Mobile-only "Place a bet" floater — used to live inside
                the bottom-gradient title overlay we removed. We keep
                the affordance because it's the fastest path to the
                bet panel on a phone, just without the dark gradient
                behind it. */}
            {isLive && !isFullscreen && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-end px-4 pb-4 lg:hidden">
                {/* Mobile bet CTA — brushed yellow accent, matches
                    the BetPanel and FullscreenBetOverlay buttons. */}
                <BrushButton
                  variant="accent"
                  size="default"
                  onClick={handleHeaderBet}
                  className="pointer-events-auto px-6"
                >
                  {user ? "Place a bet" : "Sign in to bet"}
                </BrushButton>
              </div>
            )}

            {/* Fullscreen-only overlays: X close + bet controls + drag-down close */}
            {isFullscreen && (
              <FullscreenBetOverlay
                event={event}
                containerRef={videoContainerRef}
                onClose={() => setIsFullscreen(false)}
                muted={videoMuted}
                onMutedChange={setVideoMuted}
              />
            )}
          </div>

          {/* Round status — sits below the video container. Only
              meaningful for time-limited round formats: a "Single
              round" event has no per-round timer, so we skip rendering
              the countdown bar entirely (matches the studio setting
              the creator chose). */}
          {/* Legacy RoundStatus removed — the betting countdown
              lives inside the video container now (top-center
              overlay), driven by `event.bettingClosesAt` so every
              viewer sees the same absolute timer. */}

          {/* Rules button — mobile only. Description used to share
              this row but has moved into the EventInfoBlock at the
              bottom of the page (or under Rules on desktop), so the
              Rules button gets its own line. */}
          <div className="lg:hidden">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRulesModalOpen(true)}
              className="w-full sm:w-auto"
            >
              Rules
            </Button>
          </div>
          </div>

          {/* Rules — desktop only; mobile gets the bottom-sheet modal */}
          <section className="hidden overflow-hidden rounded-2xl border border-border/30 bg-card lg:block">
            <div className="px-6 pt-6">
              <h2 className="font-heading text-lg font-semibold">Rules</h2>
            </div>
            <div className="px-6 pb-6 pt-3">
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {event.rules}
              </p>
            </div>
          </section>

          {/* Event info — desktop placement. Title + creator + follower
              count + description in one card under Rules. The same
              block also lives inside the aside (mobile-only) so on
              phones it ends up below the chat container. Rendered
              twice with hidden/lg:block toggles so the mobile and
              desktop positions are independent. */}
          <div className="hidden lg:block">
            <EventInfoBlock event={event} />
          </div>

          {/* Rewards banner — desktop only; mobile renders this after the bet panel inside the aside */}
          <Link
            to="/rewards"
            aria-label="Rewards"
            className="hidden w-full overflow-hidden rounded-2xl border border-border/30 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:block"
          >
            <img
              src={rewardsBannerImg}
              alt=""
              className="block h-auto w-full"
            />
          </Link>
        </div>

        {/* Right-side / bottom panel.
            Desktop: position: sticky BELOW the sticky DesktopTopNav
            (h-12 = 48px). top:66px = 48px topnav + 18px gap, so the
            aside hugs its natural position from PageContainer's
            lg:pt-[18px] and stays put under the bar as the centre
            column scrolls. Height = viewport − 48px topnav − 18px
            top − 18px bottom = 100dvh − 84px, giving the chat card
            the same breathing room from the screen edge at the
            bottom as the betting panel has at the top. Only the
            centre column scrolls on desktop. */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-[66px] lg:h-[calc(100dvh-84px)]">
          <div ref={betPanelRef} className="order-1 scroll-mt-16 lg:order-2">
            {isLive ? (
              <BetPanel event={event} />
            ) : isScheduled ? (
              <UpcomingPanel event={event} />
            ) : (
              <FinishedPanel event={event} />
            )}
          </div>
          {/* Chat slot takes the remaining vertical space inside the
              sticky aside on desktop. min-h-0 is the magic flex
              utility that lets the slot shrink below its content's
              natural height so the inner ul can scroll. When the
              betting panel collapses, its row shrinks and the
              flex-1 chat grows to absorb the freed pixels. On
              mobile this sits directly under the bet panel — the
              rewards banner now drops below it (order-3 below) so
              the chat stays adjacent to the betting flow. */}
          <div className="order-2 lg:order-3 lg:flex-1 lg:min-h-0">
            <ChatPanel eventId={event.id} eventStatus={event.status} />
          </div>
          {/* Mobile-only rewards banner — sits below the chat
              container on phones; desktop renders its own copy in
              the main column under Rules. */}
          <Link
            to="/rewards"
            aria-label="Rewards"
            className="order-3 block w-full overflow-hidden rounded-2xl border border-border/30 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:hidden"
          >
            <img src={rewardsBannerImg} alt="" className="block h-auto w-full" />
          </Link>
          {/* Event info — mobile placement, below the rewards banner.
              On desktop this same block already renders inside the
              main column under Rules; lg:hidden removes the dupe so
              we don't render twice on desktop. */}
          <div className="order-4 lg:hidden">
            <EventInfoBlock event={event} />
          </div>
        </aside>
      </div>

      {/* Mobile-only bottom-sheet modal for Rules */}
      <RulesBottomSheet
        open={rulesModalOpen}
        onClose={() => setRulesModalOpen(false)}
        rules={event.rules}
      />
    </PageContainer>
  );
}

/**
 * Desktop-only sidebar listing the OTHER currently-live + upcoming
 * events the viewer could jump to. One "Other events" header sits
 * above the whole list; live rows are sorted ahead of upcoming
 * rows so the page acts like a mini event browser without leaving
 * the player. Each row is a Link to /event/:id.
 *
 * Per row we show: creator avatar (40px), a status pill (red LIVE
 * badge or a compact scheduled-date pill), creator display name,
 * and the event title clipped to two lines so very long titles
 * don't push neighbouring rows off-balance.
 */
function OtherEventsList({ events }: { events: StreamEvent[] }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      {/* No horizontal padding on the header — the OtherEventsList
          aside already sits at the PageContainer's lg:px-6 gutter,
          so adding extra px in here would push content further
          inward than the rest of the page. */}
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Other events
      </h2>
      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center">
          <p className="font-heading text-sm font-semibold">
            Nothing else live
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Check back soon for more streams.
          </p>
        </div>
      ) : (
        <ul className="space-y-1">
          {events.map((e) => (
            <OtherEventRow key={e.id} event={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

// Compact scheduled-date label, e.g. "Jun 7, 8:30 PM". Uses the
// browser's locale so timezone is implicit-correct.
const otherEventsDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function OtherEventRow({ event }: { event: StreamEvent }) {
  const isLive = event.status === "live";
  return (
    <li>
      <Link
        to={`/event/${event.id}`}
        // Negative -mx so the hover background can still bloom a
        // few px past the column edge for visual breathing room,
        // but the actual content (avatar + name + title) lines up
        // flush with the PageContainer's left gutter.
        className="-mx-2 flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-secondary/40"
      >
        <img
          src={event.influencer.avatarUrl}
          alt=""
          className="h-10 w-10 flex-shrink-0 rounded-full object-cover ring-2 ring-border/30"
        />
        <div className="min-w-0 flex-1">
          {/* Status pill on its own row above the creator name so it
              never gets squeezed by long names. Red animated LIVE
              badge reuses the shared component; upcoming gets a
              neutral muted-bg date pill. */}
          {isLive ? (
            <LiveBadge size="sm" className="mb-1" />
          ) : (
            <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {otherEventsDateFormatter.format(new Date(event.scheduledAt))}
            </span>
          )}
          <p className="truncate text-sm font-semibold text-foreground">
            {event.influencer.displayName}
          </p>
          {/*
           * Two-line clamp keeps even long titles from elbowing the
           * next row downward. `break-words` so very long single
           * words wrap instead of overflowing horizontally.
           */}
          <p
            className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground"
            title={event.title}
          >
            {event.title}
          </p>
        </div>
      </Link>
    </li>
  );
}

/**
 * Title + creator + follower count + description, rendered as a single
 * card. Replaces the old dark-gradient overlay that used to sit at the
 * bottom of the video container. We render this component twice in
 * EventDetails — once under Rules on desktop, once under ChatPanel on
 * mobile — both consume the same StreamEvent so the content stays in
 * sync if data changes.
 */
function EventInfoBlock({ event }: { event: StreamEvent }) {
  // Source the live follower count from the same RPC the rest of
  // the app reads — events.influencer.followers is a cached snapshot
  // that can lag a click behind. Falling back to the static number
  // while the query loads avoids a flash of "0 followers".
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    isFollowing,
    count,
    follow,
    unfollow,
    isPending,
  } = useCreatorFollow(event.influencer.id);
  const followerCount = count || event.influencer.followers;
  const onFollowClick = async () => {
    if (!user) {
      navigate(
        `/auth/sign-in?next=${encodeURIComponent(`/event/${event.id}`)}`,
      );
      return;
    }
    // Await + try/catch so a Postgres-side failure (RLS, missing
    // column, etc.) surfaces as a toast instead of being silently
    // swallowed by a fire-and-forget `void mutation()`. We hit this
    // exact silent-failure footgun on first ship — bare `void
    // follow()` hid a RPC error and the button "did nothing".
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
    <section className="overflow-hidden rounded-2xl border border-border/30 bg-card p-5 sm:p-6">
      <h1 className="font-heading text-lg font-extrabold leading-tight sm:text-xl">
        {event.title}
      </h1>
      {event.description && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {event.description}
        </p>
      )}
      {/* Creator row — moved BELOW the description per the latest
          IA pass so the viewer reads the event hook first, then who's
          behind it. The Follow / Following button sits to the right
          of the follower count; tapping when signed-out routes to
          sign-in then returns here. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <img
          src={event.influencer.avatarUrl}
          alt={event.influencer.displayName}
          className="h-8 w-8 flex-shrink-0 rounded-full object-cover ring-2 ring-border/40"
        />
        <span className="truncate text-sm font-semibold text-foreground">
          {event.influencer.displayName}
        </span>
        <BadgeCheck className="h-4 w-4 flex-shrink-0 fill-primary text-white" />
        <span className="truncate text-sm text-muted-foreground">
          {compactFormatter.format(followerCount)} followers
        </span>
        {/* `group` so the "Following" label swaps to "Unfollow" on
            hover — the standard social-platform toggle pattern.
            Mobile / touch (no hover) sees "Following" + the
            outline-style variant is the affordance. */}
        <Button
          type="button"
          size="sm"
          variant={isFollowing ? "outline" : "default"}
          onClick={onFollowClick}
          disabled={isPending}
          className={cn(
            "ml-auto h-8 px-3 text-xs font-semibold",
            isFollowing && "group hover:border-destructive hover:text-destructive",
          )}
        >
          {isFollowing ? (
            <>
              <span className="group-hover:hidden">Following</span>
              <span className="hidden group-hover:inline">Unfollow</span>
            </>
          ) : (
            "Follow"
          )}
        </Button>
      </div>
    </section>
  );
}

function FullscreenBetOverlay({
  event,
  containerRef,
  onClose,
  muted,
  onMutedChange,
}: {
  event: StreamEvent;
  containerRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
  /** Mute state forwarded down from EventDetails so the overlay's
   *  own bottom-centre toggle stays in sync with whatever the
   *  underlying CloudflareStreamPlayer is doing. */
  muted: boolean;
  onMutedChange: (next: boolean) => void;
}) {
  const { user } = useAuth();
  const [dragY, setDragY] = useState(0);

  // Live pari-mutuel odds — every bet on this event re-flows the
  // pools, the realtime channel re-fetches, and the displayed odds
  // shift instantly. Used by the outcome list at bottom-left, which
  // is now display-only (no chip / payout / place-a-bet flow inside
  // fullscreen — viewers exit to the side panel to bet).
  const { data: liveOddsData } = useLiveOdds(event.id);
  const { data: progress } = useEventProgress(event.id);
  const liveOddsById = new Map(
    liveOddsData.outcomes.map((o) => [o.outcome_id, o.live_odds] as const),
  );
  // Strictly the pari-mutuel live odds. Two gates:
  //   1. Per-spec 8.2: odds only exist once a pool exists.
  //   2. Per-event readiness: we don't show odds until all three
  //      settle guards (unique bettors, distinct outcomes, MIN_POOL)
  //      pass — otherwise viewers see misleading numbers on events
  //      that are guaranteed to refund.
  const oddsFor = (outcome: BetOutcome) =>
    progress.minimumsMet ? (liveOddsById.get(outcome.id) ?? null) : null;

  // Drag-down to close — listen at window level so iframe taps still work.
  // Below the 8px deadzone the finger movement is treated as a tap; beyond
  // it the entire fullscreen container follows the finger via transform.
  // Release past 120px commits the close, otherwise snaps back.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let startY: number | null = null;
    let startX: number | null = null;
    let dragging = false;
    let currentDy = 0;
    const DEADZONE = 8;
    const CLOSE_THRESHOLD = 120;

    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      dragging = false;
      currentDy = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null || startX === null) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      // Only commit to a vertical drag once past the deadzone and mostly
      // vertical — otherwise let the tap propagate to whatever is below.
      if (!dragging) {
        if (Math.abs(dy) < DEADZONE || Math.abs(dx) > Math.abs(dy)) return;
        dragging = true;
      }
      // Resist upward drag (don't move above 0); allow downward.
      currentDy = Math.max(0, dy);
      setDragY(currentDy);
    };
    const onEnd = () => {
      if (!dragging) {
        startY = null;
        startX = null;
        return;
      }
      const finalDy = currentDy;
      startY = null;
      startX = null;
      dragging = false;
      currentDy = 0;
      if (finalDy >= CLOSE_THRESHOLD) {
        onClose();
      } else {
        setDragY(0);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [containerRef, onClose]);

  // Apply drag transform to the fullscreen container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (dragY > 0) {
      container.style.transform = `translateY(${dragY}px)`;
      container.style.transition = "none";
      // Slight fade-out as it drags down
      container.style.opacity = String(Math.max(0.4, 1 - dragY / 600));
    } else {
      container.style.transform = "";
      container.style.transition = "transform 200ms ease-out, opacity 200ms ease-out";
      container.style.opacity = "";
    }
  }, [dragY, containerRef]);


  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* X close button — top right */}
      <button
        type="button"
        aria-label="Close fullscreen"
        onClick={onClose}
        className="pointer-events-auto absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur transition-colors hover:bg-black/75"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Readiness banner — sits just above the bottom controls when
          the event hasn't cleared its settle minimums yet. Same data
          as the side-panel readiness card, compressed to one line so
          it doesn't crowd the fullscreen layout. */}
      {user && !progress.minimumsMet && (
        <div className="pointer-events-none absolute inset-x-0 bottom-32 flex justify-center px-4 sm:bottom-36">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur">
            <span className="text-white/70">Min for payout</span>
            <span className="font-semibold">
              {progress.uniqueBettors}/{progress.minUniqueBettors} bettors
            </span>
            <span className="text-white/40">·</span>
            <span className="font-semibold">
              {progress.outcomesWithBets}/{progress.minOutcomesWithBets} outcomes
            </span>
          </div>
        </div>
      )}

      {/* Bottom-center mute toggle — mirrors the one rendered by
          CloudflareStreamPlayer in non-fullscreen mode. Hosting it
          here (instead of leaving it inside the player) means the
          overlay gradient + bet controls can sit on top of the
          video without burying the audio control. Sits at a fixed
          bottom inset so it doesn't shift when the bet form below
          gains / loses rows. */}
      <button
        type="button"
        onClick={() => onMutedChange(!muted)}
        aria-label={muted ? "Unmute" : "Mute"}
        className="pointer-events-auto absolute bottom-3 left-1/2 z-10 inline-flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-black/60 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/80"
      >
        {muted ? (
          <VolumeX className="h-5 w-5" />
        ) : (
          <Volume2 className="h-5 w-5" />
        )}
      </button>

      {/* Bottom overlay strip — a soft gradient anchors both the
          outcomes list (bottom-left) and the floating chat
          (bottom-right) so they stay legible over arbitrary video
          contents. No betting controls live here anymore: the
          fullscreen view is read-only for outcomes + chat; viewers
          who want to place a bet exit fullscreen and use the side
          panel (the X is one tap away in the top-right). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-4 pt-12">
        <div className="flex items-end justify-between gap-3">
          {/* Left: outcomes list — display-only, no chips / container.
              Just the outcome label + live odds (or "—" before the
              event clears its settle minimums) styled to mirror the
              normal BetPanel outcome rows. Drop shadows + the gradient
              above carry legibility over the video. */}
          <ul className="pointer-events-none flex flex-col items-start gap-1 text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]">
            {event.outcomes.map((o) => {
              const odds = oddsFor(o);
              return (
                <li
                  key={o.id}
                  className="flex max-w-[60vw] items-center gap-2 text-sm font-semibold"
                >
                  <span className="truncate">{o.label}</span>
                  <span className="font-heading text-sm font-extrabold tabular-nums text-white/90">
                    {odds == null ? "—" : `${odds.toFixed(2)}×`}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Right: floating chat — recent messages stacked at the
              bottom-right, fading upward via a mask gradient so older
              lines dim and disappear without abrupt cut-off. Reads
              live from the same `useEventChat` channel the ChatPanel
              uses, so anything typed elsewhere on the page also
              appears here. */}
          <FullscreenChatStream eventId={event.id} />
        </div>
      </div>
    </div>
  );
}

/**
 * Compact Twitch-style chat strip rendered at the bottom-right of
 * the fullscreen overlay. Subscribes to the same `useEventChat`
 * channel the side ChatPanel uses, slices the last N messages,
 * and renders them stacked with a top-fade mask so old lines
 * disappear smoothly as new ones arrive.
 *
 * Intentionally read-only — there's no composer here. The composer
 * is the side ChatPanel; this strip is for ambient visibility
 * while the video fills the screen.
 */
function FullscreenChatStream({ eventId }: { eventId: string }) {
  const { messages } = useEventChat(eventId);
  const recent = messages.slice(-6);
  if (recent.length === 0) return null;
  return (
    <div
      className="pointer-events-none flex max-h-44 w-[44vw] max-w-[280px] flex-col justify-end gap-1 overflow-hidden text-right"
      style={{
        // Top fade so older messages dim out rather than getting
        // hard-clipped against the gradient edge.
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 35%, black 100%)",
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 35%, black 100%)",
      }}
    >
      {recent.map((m) => (
        <p
          key={m.id}
          className="truncate text-xs font-medium leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]"
        >
          <span
            className="font-heading font-semibold"
            style={{ color: usernameHue(eventId, m.user_id) }}
          >
            {m.display_name}
          </span>
          <span className="text-white/95">: {m.body}</span>
        </p>
      ))}
    </div>
  );
}

// Cheap deterministic hue mapper for chat usernames in the
// fullscreen strip — mirrors the (event_id, user_id) hashing in
// ChatPanel's usernameColor() so a viewer's name stays the same
// colour across both surfaces. Kept inline here (instead of
// importing from ChatPanel) so this file's chat snippet doesn't
// pull the whole ChatPanel module on every fullscreen entry.
function usernameHue(eventId: string, userId: string): string {
  let h = 0;
  const s = `${eventId}:${userId}`;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `hsl(${(Math.abs(h) % 50) * (360 / 50)}, 65%, 65%)`;
}

function RulesBottomSheet({
  open,
  onClose,
  rules,
}: {
  open: boolean;
  onClose: () => void;
  rules: string;
}) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    if (open) setDragY(0);
  }, [open]);

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    isDragging.current = true;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setDragY(dy);
  };
  const onTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    startY.current = null;
    if (dragY > 80) {
      onClose();
    } else {
      setDragY(0);
    }
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 lg:hidden",
        !open && "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close rules"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Sheet */}
      <div
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-3xl bg-card"
        style={{
          transform: open
            ? `translateY(${dragY}px)`
            : "translateY(100%)",
          transition: isDragging.current
            ? "none"
            : "transform 240ms cubic-bezier(0.32, 0.72, 0, 1)",
          boxShadow: "0 -10px 32px rgba(0, 0, 0, 0.28)",
          paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pb-2 pt-3">
          <span className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
        </div>
        <h2 className="px-6 font-heading text-lg font-semibold">Rules</h2>
        <p className="mt-2 max-h-[70vh] overflow-y-auto whitespace-pre-line px-6 pb-2 text-sm leading-relaxed text-muted-foreground">
          {rules}
        </p>
      </div>
    </div>
  );
}

function BetPanel({ event }: { event: StreamEvent }) {
  // `selected` is the outcome whose stake-chip row is expanded.
  // No stake state — clicking a chip below an outcome submits the
  // bet at that fixed amount directly (no "Place bet" confirm).
  const [selected, setSelected] = useState<BetOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Collapse toggle — header stays visible, body folds away.
  const [collapsed, setCollapsed] = useState(false);
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushLocalToast } = useNotificationsToast();

  // For studio-published events, event.influencer.id is the
  // creator_profiles.id which equals auth.users.id. The streamer
  // viewing their own event page can't place bets (place_bet RPC
  // would reject with "Streamers cannot bet on their own event"
  // anyway) — we disable the bet chips upfront so they don't see
  // a clickable affordance for an action that's guaranteed to fail.
  const isCreator = !!user && event.influencer.id === user.id;

  // Live pari-mutuel odds — each bet tick re-runs compute_live_odds via
  // a Realtime subscription on event_outcomes.
  const { data: liveOddsData } = useLiveOdds(event.id);
  const { data: progress } = useEventProgress(event.id);
  const liveOddsById = new Map(
    liveOddsData.outcomes.map((o) => [o.outcome_id, o.live_odds] as const),
  );
  const oddsFor = (outcome: BetOutcome) =>
    progress.minimumsMet ? (liveOddsById.get(outcome.id) ?? null) : null;
  const displayOddsList = event.outcomes.map((o) => oddsFor(o) ?? 1);

  // Multi-outcome betting: a viewer can hold one bet per OUTCOME per
  // (event, round). The DB constraint
  // `bets_user_event_round_outcome_unique` enforces this; the UI
  // mirrors the filter so the moment the streamer advances rounds
  // (events.current_round increments via Realtime → React Query
  // invalidates → event re-fetches), the previous round's settled
  // bets drop out and every outcome becomes clickable again for the
  // new round. Single-round events keep current_round = 1 forever,
  // so the behaviour is identical for them.
  const { data: myBets } = useMyBets();
  const myEventBets = useMemo(
    () =>
      (myBets ?? []).filter(
        (b) =>
          b.event_id === event.id &&
          b.round_index === event.currentRound &&
          (b.status === "open" ||
            b.status === "placed" ||
            b.status === "won_pending_payout" ||
            b.status === "won"),
      ),
    [myBets, event.id, event.currentRound],
  );
  // Map for O(1) "does the user already have a bet on this outcome"
  // lookups inside the per-outcome render loop.
  const betsByOutcomeId = useMemo(
    () =>
      new Map(myEventBets.map((b) => [b.outcome_id, b] as const)),
    [myEventBets],
  );
  const balanceDollars = (profile?.balance_cents ?? 0) / 100;
  const { min: oddsMin, max: oddsMax } = oddsRange(displayOddsList);

  async function placeBetAt(outcome: BetOutcome, stakeCoins: number) {
    if (!user) return;
    if (submitting) return;
    if (stakeCoins > balanceDollars) {
      toast.error(`Insufficient balance for ${stakeCoins} coins.`);
      return;
    }
    setSubmitting(true);
    try {
      const cents = stakeCoins * 100;
      if (cents < MIN_BET_CENTS || cents > MAX_BET_CENTS) {
        throw new Error(
          `Stake must be between ${MIN_BET_CENTS / 100} and ${MAX_BET_CENTS / 100} coins.`,
        );
      }
      await placeBet(event.id, outcome.id, cents);
      await refreshProfile();
      // Refetch the bets cache and AWAIT it (not invalidateQueries +
      // fire-and-forget). The BetPanel decides "Place a bet" vs
      // "Your bet" from `myBets`; if we release the submitting lock
      // before the new bet is in the cache, the user sees the stake
      // chips again and double-clicks → place_bet RPC rejects with
      // `already_bet` because the DB-side uniqueness on
      // (user_id, event_id, round_index) already holds. Awaiting the
      // refetch makes the panel flip to "Your bet" before the click
      // target is even re-enabled.
      await queryClient.refetchQueries({ queryKey: betsKeys.mine() });
      // No inline success toast — NotificationsProvider picks up
      // the `bet_placed` row inserted by the AFTER INSERT trigger
      // on public.bets (20260609_000001 migration) and renders the
      // unified custom card. ~200ms latency, Sonner animation
      // covers the gap. Keeping the optimistic toast here would
      // double-toast.
      setSelected(null);
    } catch (err) {
      // PostgrestError carries .message via duck-typing (extends
      // Error in supabase-js, but the `instanceof Error` check
      // sometimes fails when the error came from a different realm
      // — e.g. a Resend error bubbled up from an inner promise).
      // Read .message defensively so the user sees the actual
      // server-side reason ("Streamers cannot bet on their own
      // event", "already_bet", insufficient balance, etc.) instead
      // of the generic fallback.
      const message =
        (err &&
          typeof err === "object" &&
          "message" in err &&
          typeof (err as { message?: unknown }).message === "string" &&
          (err as { message: string }).message) ||
        "Failed to place bet";

      // "Streamers cannot bet on their own event" → route through
      // the custom-card warning toast so it matches the rest of
      // the notification layer visually. Other errors stay on
      // Sonner's native red-toast (sonner.error) — those are
      // catastrophic + want the destructive treatment.
      if (message.toLowerCase().includes("streamers cannot bet")) {
        pushLocalToast({
          type: "payout_rejected",
          title: "Heads up",
          body: "Creators can't bet on their own event.",
          durationMs: 4000,
        });
      } else {
        // Stake-limit / window / balance errors get the friendly
        // red custom-card treatment via parseBetError. Everything
        // else (Profile not found, Outcome not found, network
        // glitches) keeps the bare Sonner red toast — those are
        // catastrophic, not user-fixable.
        const friendly = parseBetError(message);
        if (friendly) {
          pushLocalToast({
            type: "bet_limit",
            title: friendly.title,
            body: friendly.body,
            durationMs: 4000,
          });
        } else {
          toast.error(message);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Header title flip — only switch to "Your bets" once the viewer
  // has covered every outcome (there is literally no further bet
  // they can place this round). Until then "Place a bet" stays
  // accurate even after partial coverage. Single-outcome rebets are
  // blocked at the DB level + the UI hides the stake chips on the
  // outcomes the user already backed.
  const hasBetEveryOutcome =
    myEventBets.length > 0 && myEventBets.length === event.outcomes.length;

  return (
    <section className="card-elevated overflow-hidden">
      {/* Compact header — half the height of the original. py-1.5 +
          smaller icons keeps the gradient bar visible as a section
          divider without the bar eating a chunk of the panel's
          vertical real estate. Same treatment is applied across
          BetPanel / UpcomingPanel / FinishedPanel / ChatPanel so
          all four look consistent in the right rail. */}
      <div className="flex items-center justify-between bg-gradient-to-r from-[#1973FF] to-[#5048FF] px-4 py-1.5 text-white">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 fill-[#FED448] text-[#FED448]" />
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide">
            {hasBetEveryOutcome ? "Your bets" : "Place a bet"}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand bet panel" : "Collapse bet panel"}
          aria-expanded={!collapsed}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
        >
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {!collapsed && (
      // Tight side padding: half the original p-5/p-6 so the
      // outcome rows + stake input use the full width of the
      // right-rail card instead of leaving wide gutters. Top and
      // bottom padding match the side padding so the gap above the
      // first outcome row and below the last element (ReadinessCard
      // or sign-in CTA) are visually symmetric.
      <div className="p-2.5 sm:p-3">

      {/* Outcomes list — clicking an outcome row (signed-in users
          only) replaces its odds pill with three stake chips
          (1 / 5 / 10 coins). Clicking a chip places that bet
          immediately. No separate stake / payout / Place bet
          section below — the row IS the form. Signed-out viewers
          see odds only; outcomes aren't clickable for them. */}
      <ul className="space-y-2">
        {event.outcomes.map((o) => {
          // Multi-outcome: each row is its own "have I bet THIS one?"
          // decision. The trophy + tinted background that used to fire
          // off a global `hasBet` now scopes to the single row.
          const userBet = betsByOutcomeId.get(o.id);
          const hasBetThisOutcome = !!userBet;
          const isSelected = !hasBetThisOutcome && selected?.id === o.id;
          const active = hasBetThisOutcome || isSelected;
          const odds = oddsFor(o);
          const userStakeDollars = userBet
            ? (userBet.amount_cents / 100).toFixed(2)
            : null;
          // Row is clickable ONLY for signed-in users who haven't yet
          // bet on THIS outcome. They can still bet on the others, so
          // disabling per-row (instead of globally on "has placed any
          // bet") is the multi-outcome update. Streamer self-bet
          // block (server rejects with 42501) is still suppressed up
          // front via `isCreator`.
          const rowClickable =
            !!user && !hasBetThisOutcome && !submitting && !isCreator;
          return (
            <li key={o.id}>
              <div
                role={rowClickable ? "button" : undefined}
                tabIndex={rowClickable ? 0 : undefined}
                onClick={() => {
                  if (!rowClickable) return;
                  setSelected((cur) => (cur?.id === o.id ? null : o));
                }}
                onKeyDown={(e) => {
                  if (!rowClickable) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected((cur) => (cur?.id === o.id ? null : o));
                  }
                }}
                className={cn(
                  // Vertical padding halved (py-2.5 → py-1) so the
                  // outcome rows sit tighter together — the row
                  // contents are short (label + odds pill, both with
                  // their own leading) so the extra breathing room
                  // wasn't earning its keep.
                  "flex w-full items-center justify-between rounded-lg border px-3 py-1 text-left transition-all",
                  active
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : "border-border/40 bg-background/60",
                  rowClickable && !active &&
                    "cursor-pointer hover:border-primary/40 hover:bg-primary/[0.03]",
                  !rowClickable && "cursor-default",
                )}
              >
                <span className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                  {hasBetThisOutcome && (
                    <Trophy className="h-3.5 w-3.5 flex-shrink-0 fill-primary text-primary" />
                  )}
                  <span className="truncate">{o.label}</span>
                </span>
                <span className="ml-3 flex flex-shrink-0 items-center gap-2">
                  {/* Three states for the right-side slot:
                      1. User already bet THIS outcome: show their
                         stake pill + the live odds chip.
                      2. Selected outcome (!hasBetThisOutcome & signed
                         in): show stake chips that place the bet on
                         click.
                      3. Default: just the odds (or "—" placeholder
                         until minimums settle). */}
                  {hasBetThisOutcome && userStakeDollars && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold leading-none tabular-nums text-primary">
                      Your bet <CoinIcon /> {userStakeDollars}
                    </span>
                  )}
                  {isSelected && user ? (
                    <span className="flex flex-shrink-0 items-center gap-1">
                      {STAKE_CHIPS.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void placeBetAt(o, amount);
                          }}
                          disabled={submitting}
                          className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-sm font-extrabold leading-none tabular-nums text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <CoinIcon />
                          {amount}
                        </button>
                      ))}
                    </span>
                  ) : odds == null ? (
                    // Pre-minimums: render a bare "—" without the
                    // pill background so the column doesn't look
                    // like every row is a clickable badge before
                    // betting has actually opened.
                    <span className="font-heading text-sm font-bold tabular-nums text-muted-foreground">
                      —
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums",
                        active
                          ? "bg-primary text-primary-foreground"
                          : oddsPillClasses(odds, oddsMin, oddsMax),
                      )}
                    >
                      {`${odds.toFixed(2)}×`}
                    </span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {!progress.minimumsMet && (
        <ReadinessCard progress={progress} className="mt-3" />
      )}

      {/* Streamer self-bet block — only the event creator sees this.
          Renders a small inline caption explaining why the outcome
          rows aren't clickable. Server-side place_bet still rejects
          (42501) if somehow called, and the catch in placeBetAt
          surfaces the same message via pushLocalToast. */}
      {isCreator && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-700 dark:text-amber-300">
          You can't bet on your own event.
        </p>
      )}

      {/* Sign-in CTA for unauthenticated viewers — sits below the
          minimums card so the order reads "here are the outcomes,
          here's why you can't bet yet, here's how to opt in." Uses
          the brush BrushButton with the accent yellow gradient so
          the CTA pops against the surrounding panel and the
          starter-bonus line below feels like a single offer. */}
      {!user && (
        <div className="mt-3 space-y-1">
          <BrushButton
            variant="accent"
            onClick={() =>
              navigate(
                `/auth/sign-in?next=${encodeURIComponent(`/event/${event.id}`)}`,
              )
            }
            className="w-full"
          >
            <LogIn className="h-4 w-4" />
            Sign in to use your balance
          </BrushButton>
          {/* New-viewer starter bonus teaser — the viewer signup
              flow grants 100 coins on first activation. Keep this
              line tight so it reads as a caption to the CTA above. */}
          <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            New here? Get <CoinIcon /> 100 on signup
          </p>
        </div>
      )}

      {/* (The aggregate "You staked X across N outcomes" summary
          block lived here in an earlier multi-outcome iteration but
          was removed at the operator's request — the per-outcome
          "Your bet $X" pill on each row already carries the relevant
          per-bet info, and a separate net-position table was extra
          chrome the panel didn't need.) */}

      {/* Subscriber count line stays visible while the event is live
          as a social-proof signal. NotifyMeBlock returns null when
          it has nothing to show (live event with 0 subscribers) so
          the BetPanel doesn't leave phantom space below the sign-in
          CTA / post-bet footer. It owns its own top margin too. */}
      <NotifyMeBlock event={event} />
      </div>
      )}
    </section>
  );
}

/**
 * Inline card surfaced by BetPanel while the event hasn't yet cleared
 * the three settle guards (unique bettors, distinct outcomes with
 * bets, MIN_POOL). Mirrors the server-side checks in `settle_event`
 * so viewers never see misleading "Open" odds without knowing the
 * event might refund.
 */
function ReadinessCard({
  progress,
  className,
}: {
  progress: EventProgress;
  className?: string;
}) {
  // Viewer-facing variant — deliberately doesn't disclose the exact
  // settlement minimums (participant count, distinct outcomes,
  // minimum pool). The streamer side renders its own card with the
  // numeric guards; here we just signal "not enough bets yet, you
  // get refunded if it stays that way" in one line. The studio
  // LiveStream page has its own multi-row readiness display for the
  // creator to see exactly which guard is missing.
  if (progress.minimumsMet) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2",
        className,
      )}
    >
      <p className="text-xs leading-snug text-amber-700 dark:text-amber-300">
        Waiting for enough bets to start — if the minimum isn't met, all
        bets refund in full.
      </p>
    </div>
  );
}

function UpcomingPanel({ event }: { event: StreamEvent }) {
  // Collapse toggle — chevron in the top-right replaces the old
  // "starts in / starting" status chip. Matches the BetPanel /
  // FinishedPanel header pattern so the three lifecycle variants of
  // the right-rail panel all behave identically.
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="card-elevated overflow-hidden">
      {/* Header is "Bet outcomes" with the Trophy icon — same framing
          a viewer sees once the event goes live, so the panel reads
          as the same surface across upcoming → live → ended. The old
          "UPCOMING / starts in 3h" calendar header is gone; the
          per-event scheduling info is already on the page header. */}
      <div className="flex items-center justify-between bg-gradient-to-r from-[#1973FF] to-[#5048FF] px-4 py-1.5 text-white">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 fill-[#FED448] text-[#FED448]" />
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide">
            Bet outcomes
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand outcomes" : "Collapse outcomes"}
          aria-expanded={!collapsed}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
        >
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {!collapsed && (
      <div className="space-y-4 p-2.5 sm:p-3">

      {/* The inline "Bet outcomes" trophy + subtitle that used to
          live here was redundant with the panel header (now also
          "Bet outcomes"), so it's gone. Outcomes go straight under
          the gradient bar. */}
      <ul className="space-y-2">
        {event.outcomes.map((o) => (
          <li
            key={o.id}
            // px-3 py-1 matches the BetPanel + FinishedPanel rows
            // (live + finished states) so the right-rail card has
            // consistent vertical rhythm across the three lifecycle
            // variants.
            className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 px-3 py-1"
          >
            <span className="truncate text-sm font-medium">{o.label}</span>
            {/* Scheduled events have no pool yet — odds don't exist
                until the stream goes live and viewers start betting.
                Bare muted "—" (no pill bg) matches the BetPanel
                pre-minimums rendering, so a scheduled event reads
                the same as a live event waiting for its first
                bets — both states share "no odds yet" semantics. */}
            <span className="ml-3 font-heading text-sm font-bold tabular-nums text-muted-foreground">
              —
            </span>
          </li>
        ))}
      </ul>

      <NotifyMeBlock event={event} />
      </div>
      )}
    </section>
  );
}

/**
 * Notify-me-when-live CTA + subscriber-count caption. Reused on the
 * UpcomingPanel (here) and on the live/finished view via FinishedPanel
 * so viewers can see the count throughout the event's lifecycle.
 *
 *   • Anon visitors: click the button → routed to /auth/sign-in with
 *     a `next` redirect back here. They tap Notify again on return.
 *   • Authenticated + not yet subscribed: primary CTA, calls
 *     subscribe_event RPC + fires the confirmation email.
 *   • Already subscribed: outline CTA showing "Subscribed ✓",
 *     clicking unsubscribes.
 *
 * The counter line below the button is hidden when count = 0 (don't
 * advertise an empty audience). It stays visible across scheduled,
 * live, and finished states as a social-proof signal.
 */
function NotifyMeBlock({ event }: { event: StreamEvent }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    isSubscribed,
    isSubscribedLoading,
    count,
    subscribe,
    unsubscribe,
    isPending,
  } = useEventSubscription(event.id);

  // Notify button is only meaningful while the event is *scheduled*
  // — once it's live, the viewer is already watching; once it's
  // finished, there's nothing to notify about. The counter below
  // (handled separately) stays visible across all three states as a
  // social-proof signal.
  const showButton = event.status === "scheduled";

  const onClick = async () => {
    if (!user) {
      navigate(`/auth/sign-in?next=${encodeURIComponent(`/event/${event.id}`)}`);
      return;
    }
    try {
      if (isSubscribed) {
        await unsubscribe();
        toast.success("You'll no longer get notifications for this event.");
      } else {
        await subscribe();
        toast.success("We'll email you when it goes live.");
      }
    } catch (err) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Something went wrong";
      toast.error(message);
    }
  };

  // Bail out entirely when there's nothing to show — keeps the
  // BetPanel from leaving phantom space below the sign-in CTA /
  // post-bet footer on a live event with 0 subscribers.
  if (!showButton && count === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      {showButton && (
        // Subscribed state keeps the rectangular secondary Button to
        // signal a passive "already done" affordance; the "Notify
        // me when live" CTA gets the brushed accent yellow gradient
        // so it carries the same visual weight as the sign-in CTA
        // on the live BetPanel — both are the headline action for
        // unauthenticated / pre-live viewers on the right rail.
        isSubscribed ? (
          <Button
            onClick={onClick}
            size="lg"
            variant="secondary"
            disabled={isPending || isSubscribedLoading}
            className="w-full gap-2"
          >
            <Bell className="h-4 w-4" />
            Subscribed ✓
          </Button>
        ) : (
          <BrushButton
            variant="accent"
            onClick={onClick}
            disabled={isPending || isSubscribedLoading}
            className="w-full gap-2"
          >
            <Bell className="h-4 w-4" />
            Notify me when live
          </BrushButton>
        )
      )}
      {count > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          🔔 {count.toLocaleString()}{" "}
          {count === 1 ? "person" : "people"} subscribed to this event
        </p>
      )}
    </div>
  );
}

function FinishedPanel({ event }: { event: StreamEvent }) {
  // Live odds = pari-mutuel ratio from the CURRENT pool_cents on
  // event_outcomes. For a single-round event that's still the right
  // number after the betting window closes (pool_cents doesn't move
  // post-cutoff). For a multi-round event the live pools reflect
  // only the LAST round, so the per-round summary RPC (below) is
  // the source of truth for switching back through earlier rounds.
  const { data: liveOddsData } = useLiveOdds(event.id);
  const { data: progress } = useEventProgress(event.id);
  // Per-round summary — only meaningfully populated for multi-round
  // events. Used to drive the round switcher tabs and to recompute
  // per-round odds from the per-round bet pools.
  const { data: roundsData } = useEventRoundsSummary(
    event.roundFormat === "multi" ? event.id : undefined,
  );
  const isMultiRound = event.roundFormat === "multi";
  // Selected round for the switcher. Defaults to round 1 (user
  // explicitly asked for round 1 as the initial tab). Falls back to
  // 1 when rounds haven't loaded yet — the switcher just won't
  // appear until roundsData populates.
  const [selectedRound, setSelectedRound] = useState<number>(1);

  // For multi-round events, pick the selected round's summary. For
  // single-round, the "round" concept doesn't render so we fall
  // through to the live-odds path below.
  const selectedRoundSummary = useMemo(() => {
    if (!isMultiRound || !roundsData) return null;
    return (
      roundsData.find((r) => r.roundIndex === selectedRound) ??
      roundsData[0] ??
      null
    );
  }, [isMultiRound, roundsData, selectedRound]);

  // Build the per-outcome (odds, isWinner) map for whichever view we're
  // rendering. Multi-round reads from the selected round's summary;
  // single-round uses the live (frozen) odds and event.winning_outcome_ids.
  const liveOddsById = new Map(
    liveOddsData.outcomes.map((o) => [o.outcome_id, o.live_odds] as const),
  );
  const winningIds = new Set<string>();
  const oddsById = new Map<string, number | null>();
  if (isMultiRound && selectedRoundSummary) {
    // Per-round odds: total pool from this round's outcome sums,
    // distributable applies the standard rake (RAKE_BPS = 1000).
    const total = selectedRoundSummary.outcomePools.reduce(
      (acc, p) => acc + p.pool_cents,
      0,
    );
    const poolById = new Map(
      selectedRoundSummary.outcomePools.map((p) => [p.outcome_id, p.pool_cents] as const),
    );
    for (const o of event.outcomes) {
      oddsById.set(o.id, liveOddsFor(poolById.get(o.id) ?? 0, total));
    }
    // Suppress winner highlights entirely when the round was refunded
    // (settle_round short-circuited on minimums, no winner declared).
    if (!selectedRoundSummary.wasRefunded) {
      selectedRoundSummary.winningOutcomeIds.forEach((id) => winningIds.add(id));
    }
  } else {
    // Single-round path: live odds + event-level winner list.
    for (const o of event.outcomes) {
      oddsById.set(o.id, liveOddsById.get(o.id) ?? null);
    }
    (event.winningOutcomeIds ?? []).forEach((id) => winningIds.add(id));
  }

  const displayOddsList = event.outcomes.map((o) => oddsById.get(o.id) ?? 1);
  const { min: oddsMin, max: oddsMax } = oddsRange(displayOddsList);

  const [collapsed, setCollapsed] = useState(false);
  const isAwaitingResult = event.status === "pending_moderation";
  const isCancelled = event.status === "cancelled";
  const hadBets = progress.totalPoolCents > 0
    || (roundsData?.some((r) => r.outcomePools.some((p) => p.pool_cents > 0)) ?? false);

  // Round-switcher is only visible once we have summary data AND the
  // event is genuinely multi-round with at least one settled round.
  const showRoundSwitcher = isMultiRound && (roundsData?.length ?? 0) > 0;
  // Refunded badge under the outcome list — only multi-round, only
  // when the currently-selected round was refunded.
  const selectedWasRefunded = !!selectedRoundSummary?.wasRefunded;

  return (
    <section className="card-elevated overflow-hidden">
      <div className="flex items-center justify-between bg-gradient-to-r from-[#1973FF] to-[#5048FF] px-4 py-1.5 text-white">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-[#FED448]" />
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide">
            {isAwaitingResult ? "Betting closed" : "Final result"}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand result" : "Collapse result"}
          aria-expanded={!collapsed}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
        >
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {!collapsed && (
      <div className="space-y-4 p-2.5 sm:p-3">

      {/* Lifecycle hero — kept only for the two cases that genuinely
          need a sentence of context: awaiting moderator review, and
          a cancelled (refunded) event. The "Stream finished" no-bets
          and legacy no-winner cases are dropped per UX feedback —
          the empty outcomes list speaks for itself. */}
      {isAwaitingResult ? (
        <div className="rounded-xl bg-amber-500/10 p-4 text-center">
          <p className="font-heading text-sm font-semibold text-amber-700 dark:text-amber-300">
            Awaiting result
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Betting is closed. Settlement happens once the streamer's call
            is reviewed.
          </p>
        </div>
      ) : isCancelled ? (
        <div className="rounded-xl bg-muted/50 p-4 text-center">
          <p className="font-heading text-sm font-semibold">Event cancelled</p>
          <p className="mt-1 text-xs text-muted-foreground">
            All bets were refunded.
          </p>
        </div>
      ) : null}

      {/* Final odds list. Winners get a pulsing glow + four
          staggered sparkles drifting around the row so the result
          is unmistakable at a glance. */}
      {hadBets && (
        <div className="space-y-3">
          <ul className="space-y-3">
            {event.outcomes.map((o) => {
              const odds = oddsById.get(o.id) ?? null;
              const isWinner = winningIds.has(o.id);
              return (
                <li
                  key={o.id}
                  className={cn(
                    // px-3 py-1 matches the BetPanel outcome row
                    // (live / upcoming states), keeping the finished
                    // panel's vertical rhythm consistent with the
                    // rest of the right-rail card.
                    "relative flex items-center justify-between rounded-lg border px-3 py-1 transition-colors",
                    isWinner
                      ? "winner-glow border-accent/70 bg-gradient-to-br from-accent/[0.18] via-accent/[0.10] to-transparent"
                      : "border-border/40 bg-background/60",
                  )}
                >
                  {/* Stars — only on winners. Four classic
                      5-point lucide `Star` icons filled solid in
                      accent yellow, positioned at the four corners
                      with unique drift vectors (--sparkle-dx /
                      --sparkle-dy) + staggered animation delays so
                      they twinkle out of phase. We use the simpler
                      Star shape (instead of lucide's busier
                      Sparkles) because the row is small and a
                      filled silhouette reads as "winner" much
                      faster than a multi-point sparkle. pointer-
                      events-none keeps them clear of clicks. */}
                  {isWinner && (
                    <>
                      <Star
                        aria-hidden
                        className="winner-sparkle pointer-events-none absolute -left-1 -top-2 h-4 w-4 fill-accent text-accent drop-shadow-[0_0_6px_hsl(var(--accent)/0.7)]"
                        style={{
                          // Drift up-left.
                          ["--sparkle-dx" as never]: "-6px",
                          ["--sparkle-dy" as never]: "-6px",
                          animationDelay: "0ms",
                        }}
                      />
                      <Star
                        aria-hidden
                        className="winner-sparkle pointer-events-none absolute -right-1 -top-2 h-3 w-3 fill-accent text-accent drop-shadow-[0_0_6px_hsl(var(--accent)/0.7)]"
                        style={{
                          ["--sparkle-dx" as never]: "6px",
                          ["--sparkle-dy" as never]: "-7px",
                          animationDelay: "650ms",
                        }}
                      />
                      <Star
                        aria-hidden
                        className="winner-sparkle pointer-events-none absolute -bottom-2 left-6 h-3.5 w-3.5 fill-accent text-accent drop-shadow-[0_0_6px_hsl(var(--accent)/0.7)]"
                        style={{
                          ["--sparkle-dx" as never]: "-4px",
                          ["--sparkle-dy" as never]: "8px",
                          animationDelay: "1300ms",
                        }}
                      />
                      <Star
                        aria-hidden
                        className="winner-sparkle pointer-events-none absolute -bottom-1 right-10 h-3 w-3 fill-accent text-accent drop-shadow-[0_0_6px_hsl(var(--accent)/0.7)]"
                        style={{
                          ["--sparkle-dx" as never]: "5px",
                          ["--sparkle-dy" as never]: "7px",
                          animationDelay: "1950ms",
                        }}
                      />
                    </>
                  )}
                  <span className="relative flex items-center gap-2 text-sm">
                    {isWinner && (
                      <Trophy className="h-3.5 w-3.5 text-accent drop-shadow-[0_0_4px_hsl(var(--accent)/0.7)]" />
                    )}
                    {o.label}
                  </span>
                  {/* Bare "—" for no-odds (refunded round or no
                      bets on this outcome) matches the BetPanel and
                      StreamCard styling — no pill bg so the column
                      doesn't look like a clickable badge on a
                      result that's already locked in. */}
                  {odds == null ? (
                    <span className="relative font-heading text-sm font-bold tabular-nums text-muted-foreground">
                      —
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "relative inline-flex items-center rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums",
                        oddsPillClasses(odds, oddsMin, oddsMax),
                      )}
                    >
                      {`${odds.toFixed(2)}×`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Round switcher — only renders for multi-round events
              once we have rounds data. Tabs default to round 1; the
              selected tab drives the winners + odds shown above.
              Single-round events skip this block entirely. */}
          {showRoundSwitcher && (roundsData?.length ?? 0) > 1 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {roundsData!.map((r) => {
                const isActive = r.roundIndex === selectedRound;
                return (
                  <button
                    key={r.roundIndex}
                    type="button"
                    onClick={() => setSelectedRound(r.roundIndex)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                      isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/50 bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                    aria-pressed={isActive}
                  >
                    Round {r.roundIndex}
                    {r.wasRefunded && (
                      <span
                        className={cn(
                          "ml-1.5 text-[10px]",
                          isActive ? "opacity-80" : "text-muted-foreground/80",
                        )}
                      >
                        · refunded
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Refund note — surfaces BELOW the round switcher for the
              selected round when settle_round refunded everyone
              (minimums not met). Short + factual; the round-pill
              already carries the "refunded" badge so this is just
              the human-readable reason. */}
          {selectedWasRefunded && (
            <p className="text-center text-xs text-muted-foreground">
              Requirements were not met. Full round refund.
            </p>
          )}
        </div>
      )}
      </div>
      )}
    </section>
  );
}
