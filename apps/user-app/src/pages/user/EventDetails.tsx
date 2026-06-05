import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

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
import { eventsKeys, useEvent } from "@/hooks/useEvents";
import { supabase } from "@/integrations/supabase/client";
import { useCreatorFollow } from "@/hooks/useCreatorFollow";
import { useEventSubscription } from "@/hooks/useEventSubscription";
import { useEventViewers } from "@/hooks/useEventViewers";
import { useAuth } from "@/contexts/AuthContext";
import { ChatPanel } from "@/components/event/ChatPanel";
import rewardsBannerImg from "@/assets/rewards-banner-1.jpg";
import { placeBet } from "@/services/betsService";
import { betsKeys, useMyBets } from "@/hooks/useMyBets";
import { useLiveOdds } from "@/hooks/useLiveOdds";
import { useEventProgress, type EventProgress } from "@/hooks/useEventProgress";
import type { BetOutcome, StreamEvent } from "@/domain/types";
import { cn } from "@/lib/utils";
import { oddsPillClasses, oddsRange } from "@/lib/odds";
import {
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [overlaysHidden, setOverlaysHidden] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
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
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:gap-8">
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr] lg:gap-8">
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
                  "sticky top-0 z-20 -mx-4 -mt-4 aspect-[16/9] overflow-hidden bg-black shadow-lg sm:-mx-6 lg:relative lg:mx-auto lg:mt-0 lg:aspect-[4/5] lg:max-h-[calc(100dvh-200px)] lg:max-w-[420px] lg:rounded-2xl lg:border lg:border-border/30",
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
                  "pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 transition-opacity duration-200",
                  overlaysHidden && !isFullscreen && "opacity-0 lg:opacity-100",
                )}
              >
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
                <Button
                  type="button"
                  variant="accent"
                  onClick={handleHeaderBet}
                  className="pointer-events-auto"
                >
                  {user ? "Place a bet" : "Sign in to bet"}
                </Button>
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
          {/* Mobile-only rewards banner — sits between bet panel and chat */}
          <Link
            to="/rewards"
            aria-label="Rewards"
            className="order-2 block w-full overflow-hidden rounded-2xl border border-border/30 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:hidden"
          >
            <img src={rewardsBannerImg} alt="" className="block h-auto w-full" />
          </Link>
          {/* Chat slot takes the remaining vertical space inside the
              sticky aside on desktop. min-h-0 is the magic flex
              utility that lets the slot shrink below its content's
              natural height so the inner ul can scroll. When the
              betting panel collapses, its row shrinks and the
              flex-1 chat grows to absorb the freed pixels. */}
          <div className="order-3 lg:order-3 lg:flex-1 lg:min-h-0">
            <ChatPanel eventId={event.id} eventStatus={event.status} />
          </div>
          {/* Event info — mobile placement, below the chat container.
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
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<BetOutcome | null>(
    event.outcomes[0] ?? null,
  );
  const [stake, setStake] = useState<string>("10");
  const [submitting, setSubmitting] = useState(false);
  const [dragY, setDragY] = useState(0);

  // Live pari-mutuel odds — every bet on this event re-flows the
  // pools, the realtime channel re-fetches, and the displayed odds
  // shift instantly.
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
  // The fallback `1` here is for `oddsPillClasses` color math only —
  // never rendered as a number in the UI.
  const displayOddsList = event.outcomes.map((o) => oddsFor(o) ?? 1);

  const balanceDollars = (profile?.balance_cents ?? 0) / 100;
  const stakeNum = Math.max(0, Number(stake) || 0);
  const selectedOdds = selected ? oddsFor(selected) : null;
  const potentialPayout = selected
    ? (payoutPreview(Math.round(stakeNum * 100), selectedOdds) / 100).toFixed(2)
    : "0.00";
  const stakeExceeds = !!user && stakeNum > balanceDollars;
  const canPlace = !!selected && stakeNum > 0 && !stakeExceeds && !submitting;
  const { min: oddsMin, max: oddsMax } = oddsRange(displayOddsList);

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

  async function handlePlace() {
    if (!user) {
      navigate(
        `/auth/sign-in?next=${encodeURIComponent(`/event/${event.id}`)}`,
      );
      return;
    }
    if (!canPlace || !selected) return;
    setSubmitting(true);
    try {
      await placeBet(event.id, selected.id, Math.round(stakeNum * 100));
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: betsKeys.mine() });
      toast.success(
        `Bet placed: $${stakeNum.toFixed(2)} on "${selected.label}"`,
        {
          description: `Potential payout $${potentialPayout}.`,
        },
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to place bet";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

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

      {/* Bottom controls — only when authenticated. Anonymous users see a single
          Sign in to bet CTA pinned to the bottom-right corner so the video can
          be enjoyed unobstructed and the centred mute button stays reachable. */}
      {user ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-4 pt-12">
          <div className="flex items-end justify-between gap-3">
            {/* Left: outcome column directly above the stake row */}
            <div className="pointer-events-auto space-y-2">
              <div className="flex flex-col items-start gap-1.5">
                {event.outcomes.map((o) => {
                  const active = selected?.id === o.id;
                  const odds = oddsFor(o);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setSelected(o)}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition-colors",
                        active && "bg-primary text-primary-foreground ring-2 ring-primary",
                      )}
                    >
                      <span className="max-w-[150px] truncate text-left">
                        {o.label}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums",
                          active
                            ? "bg-white text-primary"
                            : odds == null
                              ? "bg-white/15 text-white/80"
                              : oddsPillClasses(odds, oddsMin, oddsMax),
                        )}
                      >
                        {odds == null ? "Open" : `${odds.toFixed(2)}×`}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STAKE_CHIPS.map((amount) => {
                  const active = stakeNum === amount;
                  return (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setStake(String(amount))}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md bg-black/45 px-3 py-1.5 text-xs font-bold leading-none text-white backdrop-blur transition-colors",
                        active && "bg-primary text-primary-foreground ring-2 ring-primary",
                      )}
                    >
                      <CoinIcon />
                      {amount}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: potential payout + Place a bet */}
            <div className="pointer-events-auto flex flex-shrink-0 flex-col items-end gap-2">
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-wider text-white/70">
                  Potential payout
                </p>
                <p className="font-heading text-2xl font-extrabold leading-none tabular-nums text-white drop-shadow">
                  {progress.minimumsMet ? (
                    <CoinAmount value={Number(potentialPayout)} />
                  ) : (
                    "—"
                  )}
                </p>
                <p className="mt-0.5 text-[9px] leading-tight text-white/60">
                  {progress.minimumsMet
                    ? "Indicative — final at settlement"
                    : "Shown after minimums clear"}
                </p>
              </div>
              <Button
                type="button"
                variant="accent"
                onClick={handlePlace}
                disabled={!canPlace}
              >
                {submitting
                  ? "Placing…"
                  : stakeExceeds
                    ? "Insufficient"
                    : "Place a bet"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        // Anonymous viewers: a single Sign-in CTA pinned to the
        // bottom-right corner. No bottom gradient bar — leaves the
        // bottom-centre clear for the mute button and the rest of
        // the frame unobstructed for the stream.
        <div className="pointer-events-none absolute bottom-4 right-4">
          <Button
            type="button"
            variant="accent"
            onClick={handlePlace}
            className="pointer-events-auto"
          >
            Sign in to bet
          </Button>
        </div>
      )}
    </div>
  );
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
  const [selected, setSelected] = useState<BetOutcome | null>(null);
  const [stake, setStake] = useState<string>("10");
  const [submitting, setSubmitting] = useState(false);
  // Collapse toggle — header stays visible, body folds away. The
  // chevron in the top-right replaces the old "Open / Placed" status
  // chip; lifecycle context is already implied by which panel
  // (BetPanel / UpcomingPanel / FinishedPanel) is rendered.
  const [collapsed, setCollapsed] = useState(false);
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Live pari-mutuel odds — each bet tick re-runs compute_live_odds via
  // a Realtime subscription on event_outcomes.
  const { data: liveOddsData } = useLiveOdds(event.id);
  const { data: progress } = useEventProgress(event.id);
  const liveOddsById = new Map(
    liveOddsData.outcomes.map((o) => [o.outcome_id, o.live_odds] as const),
  );
  // Gate odds on settlement readiness — see FullscreenBetOverlay above
  // for the rationale.
  const oddsFor = (outcome: BetOutcome) =>
    progress.minimumsMet ? (liveOddsById.get(outcome.id) ?? null) : null;
  const displayOddsList = event.outcomes.map((o) => oddsFor(o) ?? 1);

  // One bet per (user, event). If the viewer has already placed a bet
  // on this event, show their position instead of the form.
  const { data: myBets } = useMyBets();
  const existingBet = myBets?.find(
    (b) =>
      b.event_id === event.id &&
      (b.status === "open" ||
        b.status === "placed" ||
        b.status === "won_pending_payout" ||
        b.status === "won"),
  );

  const balanceDollars = (profile?.balance_cents ?? 0) / 100;
  const stakeNum = Math.max(0, Number(stake) || 0);
  const selectedOdds = selected ? oddsFor(selected) : null;
  const potentialPayout = selected
    ? (payoutPreview(Math.round(stakeNum * 100), selectedOdds) / 100).toFixed(2)
    : "0.00";
  const stakeExceedsBalance = !!user && stakeNum > balanceDollars;
  const stakeOverMax = stakeNum > MAX_BET_CENTS / 100;
  const stakeUnderMin = stakeNum > 0 && stakeNum < MIN_BET_CENTS / 100;
  const canPlace =
    !!selected &&
    stakeNum > 0 &&
    !stakeOverMax &&
    !stakeUnderMin &&
    (!user || !stakeExceedsBalance) &&
    !submitting;
  const { min: oddsMin, max: oddsMax } = oddsRange(displayOddsList);

  async function handlePlaceBet() {
    if (!user) {
      navigate(`/auth/sign-in?next=${encodeURIComponent(`/event/${event.id}`)}`);
      return;
    }
    if (!selected || !canPlace) return;
    setSubmitting(true);
    try {
      await placeBet(event.id, selected.id, Math.round(stakeNum * 100));
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: betsKeys.mine() });
      toast.success(`Bet placed: $${stakeNum.toFixed(2)} on "${selected.label}"`, {
        description: `Potential payout $${potentialPayout}. See My Bets for status.`,
      });
      setSelected(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to place bet";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  // After placing a bet the panel keeps the same shape — outcomes
  // list at top, dynamic odds still ticking via the Realtime
  // subscription — but the bottom half flips from "stake + Place bet"
  // to a "Your bet" position summary. This way the bettor can watch
  // the pari-mutuel pool move in real time without losing context
  // about what they backed.
  const hasBet = !!existingBet;

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
            {hasBet ? "Your bet" : "Place a bet"}
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
      // right-rail card instead of leaving wide gutters.
      <div className="p-2.5 sm:p-3">

      {/* Sign-in CTA when unauthenticated */}
      {!user && (
        <Link
          to={`/auth/sign-in?next=${encodeURIComponent(`/event/${event.id}`)}`}
          className="mb-4 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/[0.04] px-3 py-2 text-sm font-medium text-primary hover:bg-primary/[0.08]"
        >
          <span className="flex items-center gap-2">
            <LogIn className="h-4 w-4" /> Sign in to use your balance
          </span>
          <span className="inline-flex items-center gap-1 text-xs leading-none text-muted-foreground">
            <CoinIcon /> 100 on signup
          </span>
        </Link>
      )}

      <ul className="space-y-2">
        {event.outcomes.map((o) => {
          // Once the user has bet, outcomes become read-only and the
          // user's chosen outcome stays highlighted while live odds
          // continue ticking on every row via useLiveOdds.
          const isUserPick = hasBet && existingBet?.outcome_id === o.id;
          const active = hasBet ? isUserPick : selected?.id === o.id;
          const odds = oddsFor(o);
          // The picked outcome's pill shows the viewer's stake in
          // place of the odds — that's the most informative thing for
          // the row they bet on, and we drop the separate "Your bet"
          // card below so the stake doesn't appear twice.
          const userStakeDollars = isUserPick && existingBet
            ? (existingBet.amount_cents / 100).toFixed(2)
            : null;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => {
                  if (hasBet) return; // read-only post-bet
                  setSelected(o);
                }}
                disabled={hasBet}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-all",
                  active
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : "border-border/40 bg-background/60",
                  !hasBet && !active &&
                    "hover:border-primary/40 hover:bg-primary/[0.03]",
                  hasBet && "cursor-default",
                )}
              >
                <span className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                  {isUserPick && (
                    <Trophy className="h-3.5 w-3.5 flex-shrink-0 fill-primary text-primary" />
                  )}
                  <span className="truncate">{o.label}</span>
                </span>
                {/* Right-side stack: stake chip (only on the user's
                    picked row) + the canonical odds chip. The odds
                    chip lives in the same spot on every row so the
                    eye scans straight down a column; the stake chip
                    is a smaller, less attention-grabbing badge to
                    its left so the viewer still gets the "your bet"
                    context without losing the live odds tick. */}
                <span className="ml-3 flex flex-shrink-0 items-center gap-2">
                  {isUserPick && userStakeDollars && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold leading-none tabular-nums text-primary">
                      Your bet <CoinIcon /> {userStakeDollars}
                    </span>
                  )}
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums",
                      active
                        ? "bg-primary text-primary-foreground"
                        : odds == null
                          ? "bg-muted text-muted-foreground"
                          : oddsPillClasses(odds, oddsMin, oddsMax),
                    )}
                  >
                    {odds == null ? "Open" : `${odds.toFixed(2)}×`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {!progress.minimumsMet && (
        <ReadinessCard progress={progress} className="mt-3" />
      )}

      {/* Post-bet footer — the picked outcome row above already shows
          the stake; this block just gives the viewer a way out and an
          honest reminder that the pool will keep moving. The separate
          Stake / Odds-at-placement card has been removed since the
          stake now lives inline in the outcome row. */}
      {hasBet && existingBet && (
        <div className="mt-4 space-y-3">
          <p className="text-center text-[11px] text-muted-foreground">
            One bet per event. Live odds keep moving — final payout is set
            at settlement.
          </p>
          <Button asChild variant="secondary" size="lg" className="w-full">
            <Link to="/my-bets">View in My Bets</Link>
          </Button>
        </div>
      )}

      {!hasBet && (
        <>
          <div className="mt-4 space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Stake
            </label>
            {/* Stake chips only — custom-amount input removed. With
                MAX_BET=$10 the universe of useful values is tiny, so
                three preset buttons cover everyone. Font weight + size
                match the Place bet button below for visual parity. */}
            <div className="grid grid-cols-3 gap-2">
              {STAKE_CHIPS.map((amount) => {
                const active = stakeNum === amount;
                return (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setStake(String(amount))}
                    className={cn(
                      "inline-flex items-center justify-center gap-1 rounded-lg border px-3 py-2.5 text-base font-bold leading-none tabular-nums transition-all",
                      active
                        ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/20"
                        : "border-border/40 bg-background/60 text-foreground hover:border-primary/40 hover:bg-primary/[0.03]",
                    )}
                  >
                    <CoinIcon />
                    {amount}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Potential payout</span>
            <span className="font-heading text-base font-bold text-foreground">
              {progress.minimumsMet ? (
                <CoinAmount value={Number(potentialPayout)} />
              ) : (
                "—"
              )}
            </span>
          </div>
          <p className="mt-1 text-center text-[11px] text-muted-foreground">
            {progress.minimumsMet
              ? "Indicative — final calculated at settlement."
              : "Payout shown once the event clears the minimums above."}
          </p>

          {stakeExceedsBalance && (
            <p className="mt-2 text-center text-xs font-medium text-destructive">
              Stake exceeds available balance.
            </p>
          )}

          <Button
            onClick={handlePlaceBet}
            variant="accent"
            size="lg"
            className="mt-4 w-full"
            disabled={!canPlace && !!user}
          >
            {!user
              ? "Sign in to place bet"
              : submitting
              ? "Placing…"
              : !selected
              ? "Pick an outcome"
              : stakeExceedsBalance
                ? "Insufficient balance"
                : "Place bet"}
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Virtual balance only. Bets settle once the round ends.
          </p>
        </>
      )}

      {/* Subscriber count line stays visible while the event is live
          as a social-proof signal. NotifyMeBlock hides its own button
          here too if the event is past the scheduled state — actually
          we let it stay so viewers who didn't pre-subscribe can still
          tap and follow the creator for next time. */}
      <div className="mt-4">
        <NotifyMeBlock event={event} />
      </div>
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
  // Three guards mirroring `settle_event` server-side. The card
  // shows only the requirements that are STILL outstanding — each
  // cleared guard disappears, and when all three are met the
  // parent's `!progress.minimumsMet` predicate hides the whole
  // card. No progress numbers (3/5, $10/$30) — the viewer just
  // needs the prompt, not the leaderboard.
  // 1 coin = 100 cents internally. The pool minimum reads as
  // "Min <coin> 30 total pool" — the coin glyph replaces the legacy
  // "$" so the unit matches every other balance/odds display.
  const poolCoins = (cents: number) => Math.round(cents / 100);
  // `label` is a ReactNode (the Pool row interleaves a CoinIcon), so
  // we can no longer use it as a React key. Each item gets a stable
  // string id for keying.
  const items: { id: string; label: ReactNode; cleared: boolean }[] = [
    {
      id: "participants",
      label: `Min ${progress.minUniqueBettors} participants`,
      cleared: progress.uniqueBettors >= progress.minUniqueBettors,
    },
    {
      id: "outcomes",
      label: `Min ${progress.minOutcomesWithBets} different outcomes`,
      cleared:
        progress.outcomesWithBets >= progress.minOutcomesWithBets,
    },
    {
      id: "pool",
      label: (
        <>
          Min{" "}
          <span className="inline-flex items-center gap-0.5 align-middle">
            <CoinIcon /> {poolCoins(progress.minPoolCents)}
          </span>{" "}
          total pool
        </>
      ),
      cleared: progress.totalPoolCents >= progress.minPoolCents,
    },
  ];
  const outstanding = items.filter((item) => !item.cleared);

  // Defensive: if every item cleared but minimumsMet hasn't flipped
  // yet (small lag between client compute + server compute), render
  // nothing rather than a bare title with no list underneath.
  if (outstanding.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3",
        className,
      )}
    >
      <p className="font-heading text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        Event needs minimum bets to start
      </p>
      <ul className="mt-2 space-y-1 text-xs text-foreground">
        {outstanding.map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-tight text-muted-foreground">
        If the event doesn't reach these minimums, all bets refund in full.
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
            className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 px-3 py-2"
          >
            <span className="truncate text-sm font-medium">{o.label}</span>
            {/* Scheduled events have no pool yet — odds don't exist
                until the stream goes live and viewers start betting.
                Show "Open" placeholder per spec §8.2 so we don't
                mislead viewers with the legacy 2.00× default. */}
            <span className="ml-3 inline-flex flex-shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-sm font-extrabold tabular-nums text-muted-foreground">
              Open
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

  return (
    <div className="space-y-2">
      {showButton && (
        <Button
          onClick={onClick}
          size="lg"
          variant={isSubscribed ? "secondary" : "default"}
          disabled={isPending || isSubscribedLoading}
          className="w-full gap-2"
        >
          <Bell className="h-4 w-4" />
          {!user
            ? "Notify me when live"
            : isSubscribed
              ? "Subscribed ✓"
              : "Notify me when live"}
        </Button>
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
  // Final odds = pari-mutuel ratio frozen at cutoff. compute_live_odds
  // reads the current pool_cents which is unchanged after the betting
  // window closes, so it's the right number to display here. Legacy
  // event_outcomes.odds is ignored.
  const { data: liveOddsData } = useLiveOdds(event.id);
  const { data: progress } = useEventProgress(event.id);
  const liveOddsById = new Map(
    liveOddsData.outcomes.map((o) => [o.outcome_id, o.live_odds] as const),
  );
  const finalOddsList = event.outcomes.map(
    (o) => liveOddsById.get(o.id) ?? 1,
  );
  const { min: oddsMin, max: oddsMax } = oddsRange(finalOddsList);
  // Collapse toggle — chevron in the top-right replaces the old
  // "Ended / Cancelled / Awaiting result" status chip. Lifecycle
  // context is now carried by the inline hero block (and by the
  // panel just being the FinishedPanel) instead of by the header.
  const [collapsed, setCollapsed] = useState(false);
  // `pending_moderation` and `settled` ride the same "Ended" panel as
  // `finished`, but the inline hero changes to make the in-between
  // states obvious.
  const isAwaitingResult = event.status === "pending_moderation";
  const isCancelled = event.status === "cancelled";
  const hadBets = progress.totalPoolCents > 0;
  // Map declared winning outcome ids → labels. We no longer render a
  // separate "Winners: X · Y" hero card — the yellow-tinted rows in
  // the Final odds list below already tell that story without doubling
  // the headline up.
  const winningIds = new Set(event.winningOutcomeIds ?? []);
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

      {/* Lifecycle hero — only rendered for the "no winner to point
          at" cases (awaiting result, cancelled, finished-but-no-bets,
          or legacy finished events without winning_outcome_ids).
          When winners ARE declared, we skip this block entirely so
          the yellow-tinted rows in the Final odds list below carry
          the message on their own — no duplication. */}
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
      ) : !hadBets ? (
        // Stream ended but nobody ever placed a bet. Showing a
        // "Winner" line here would be misleading — there's no winner
        // because there's nothing to win. Keep it short and neutral.
        <div className="rounded-xl bg-muted/50 p-4 text-center">
          <p className="font-heading text-sm font-semibold">Stream finished</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No bets were placed on this event.
          </p>
        </div>
      ) : winningIds.size === 0 ? (
        // Legacy `finished` events from before the pari-mutuel pipeline
        // — no winning_outcome_ids stamped. Show a generic ended message.
        <div className="rounded-xl bg-muted/50 p-4 text-center">
          <p className="font-heading text-sm font-semibold">Stream finished</p>
        </div>
      ) : null}

      {/* Final odds only make sense when the pool actually had bets.
          Otherwise we'd be showing "Open" or "—" on every row, which
          is just noise on a stream that ended empty. No section title
          here — the panel header ("Final result") already frames what
          the list is, and the yellow-tinted rows carry the "these
          won" signal on their own. */}
      {hadBets && (
        <div>
          <ul className="space-y-2">
            {event.outcomes.map((o) => {
              const odds = liveOddsById.get(o.id) ?? null;
              const isWinner = winningIds.has(o.id);
              return (
                <li
                  key={o.id}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2",
                    isWinner
                      ? "border-accent/60 bg-accent/[0.12]"
                      : "border-border/40 bg-background/60",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm">
                    {isWinner && (
                      <Trophy className="h-3.5 w-3.5 text-accent" />
                    )}
                    {o.label}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums",
                      odds == null
                        ? "bg-muted text-muted-foreground"
                        : oddsPillClasses(odds, oddsMin, oddsMax),
                    )}
                  >
                    {odds == null ? "—" : `${odds.toFixed(2)}×`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      </div>
      )}
    </section>
  );
}
