import { Link, useNavigate, useParams } from "react-router-dom";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell,
  Calendar,
  Users,
  Trophy,
  Wallet,
  LogIn,
  BadgeCheck,
  ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LiveBadge } from "@/components/feed/LiveBadge";
import { HlsPlayer } from "@/components/stream/HlsPlayer";
import { RoundStatus } from "@/components/stream/RoundStatus";
import {
  SocialVideoEmbed,
  resolveSocialEmbedUrl,
} from "@/components/stream/SocialVideoEmbed";
import { PageContainer } from "@/components/layout/PageContainer";
import { useEvent } from "@/hooks/useEvents";
import { useAuth } from "@/contexts/AuthContext";
import { ChatPanel } from "@/components/event/ChatPanel";
import eventCtaImg from "@/assets/event-cta-1.png";
import rewardsBannerImg from "@/assets/rewards-banner-1.jpg";
import { placeBet } from "@/services/betsService";
import { betsKeys } from "@/hooks/useMyBets";
import type { BetOutcome, StreamEvent } from "@/domain/types";
import { cn } from "@/lib/utils";
import { oddsPillClasses, oddsRange } from "@/lib/odds";

const TEST_STREAM = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export default function EventDetails() {
  const { id } = useParams<{ id: string }>();
  const { data: event, isLoading } = useEvent(id);
  const [rulesOpen, setRulesOpen] = useState(false);
  const betPanelRef = useRef<HTMLDivElement>(null);

  const scrollToBetPanel = () => {
    betPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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

  if (!event) {
    return (
      <PageContainer>
        <div className="rounded-xl border border-border/40 bg-card p-8 text-center">
          <h1 className="font-heading text-xl font-semibold">Event not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn't find that event. It may have ended or been removed.
          </p>
          <Button asChild variant="secondary" size="sm" className="mt-4">
            <Link to="/discover">Back to Discover</Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  const isLive = event.status === "live";
  const isScheduled = event.status === "scheduled";

  return (
    <PageContainer className="pt-4 lg:pt-[18px]">
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] lg:gap-8">
        <div className="space-y-4 lg:space-y-6">
          <div className="space-y-3">
          {/* Stream / cover slot — matches the IG embed's rendered video aspect so the frame fills the container */}
          <div className="relative mx-auto aspect-[4/5] max-h-[calc(100dvh-200px)] w-full max-w-[420px] overflow-hidden rounded-2xl border border-border/30 bg-black shadow-lg">
            {isLive ? (
              event.videoUrl && resolveSocialEmbedUrl(event.videoUrl) ? (
                <SocialVideoEmbed url={event.videoUrl} title={event.title} />
              ) : (
                <HlsPlayer src={TEST_STREAM} poster={event.coverUrl} autoPlay muted />
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

            <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2">
              {isLive && <LiveBadge />}
            </div>

            {isLive && (
              <span className="pointer-events-none absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                <Users className="h-3.5 w-3.5" />
                {numberFormatter.format(event.viewersCount)} watching
              </span>
            )}

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

            {/* Title + organizer overlay — sits on top of the video with a bottom-up dark gradient */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pb-4 pt-16">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="font-heading text-base font-extrabold leading-tight text-white drop-shadow sm:text-lg">
                    {event.title}
                  </h1>
                  <div className="mt-2 flex items-center gap-1.5">
                    <img
                      src={event.influencer.avatarUrl}
                      alt={event.influencer.displayName}
                      className="h-6 w-6 flex-shrink-0 rounded-full object-cover ring-2 ring-white/40"
                    />
                    <span className="truncate text-sm font-semibold text-white">
                      {event.influencer.displayName}
                    </span>
                    <BadgeCheck className="h-4 w-4 flex-shrink-0 fill-primary text-white" />
                    <span className="truncate text-sm text-white/85">
                      {compactFormatter.format(event.influencer.followers)} followers
                    </span>
                  </div>
                </div>
                {isLive && (
                  <Button
                    type="button"
                    variant="accent"
                    onClick={scrollToBetPanel}
                    className="pointer-events-auto flex-shrink-0"
                  >
                    Place a bet
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Round status — sits below the video container */}
          {isLive && (
            <RoundStatus
              durationSec={event.roundDurationSec ?? 30}
              className="mx-auto w-full max-w-[420px]"
            />
          )}

          {/* Description */}
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            {event.description}
          </p>
          </div>

          {/* Rules — collapsible on mobile, always expanded on desktop */}
          <section
            className={cn(
              "overflow-hidden rounded-2xl bg-card",
              "shadow-lg lg:border lg:border-border/30 lg:shadow-none",
              !rulesOpen && "ring-1 ring-primary/15 lg:ring-0",
            )}
          >
            <button
              type="button"
              onClick={() => setRulesOpen((o) => !o)}
              aria-expanded={rulesOpen}
              className="flex w-full items-center justify-between p-6 text-left lg:cursor-default"
            >
              <h2 className="font-heading text-lg font-semibold">Rules</h2>
              <ChevronDown
                className={cn(
                  "h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform lg:hidden",
                  rulesOpen && "rotate-180",
                )}
              />
            </button>
            <div className={cn("px-6 pb-6", !rulesOpen && "hidden lg:block")}>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {event.rules}
              </p>
            </div>
          </section>

          {/* Rewards banner — desktop only; mobile renders this after the bet panel inside the aside */}
          <button
            type="button"
            aria-label="Rewards"
            className="hidden w-full overflow-hidden rounded-2xl border border-border/30 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:block"
          >
            <img
              src={rewardsBannerImg}
              alt=""
              className="block h-auto w-full"
            />
          </button>
        </div>

        {/* Right-side / bottom panel */}
        <aside className="flex flex-col gap-4">
          <img
            src={eventCtaImg}
            alt=""
            className="order-4 block h-auto w-full rounded-2xl lg:order-1"
          />
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
          <button
            type="button"
            aria-label="Rewards"
            className="order-2 block w-full overflow-hidden rounded-2xl border border-border/30 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:hidden"
          >
            <img src={rewardsBannerImg} alt="" className="block h-auto w-full" />
          </button>
          <div className="order-3 lg:order-3">
            <ChatPanel />
          </div>
        </aside>
      </div>
    </PageContainer>
  );
}

function BetPanel({ event }: { event: StreamEvent }) {
  const [selected, setSelected] = useState<BetOutcome | null>(null);
  const [stake, setStake] = useState<string>("10");
  const [submitting, setSubmitting] = useState(false);
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const balanceDollars = (profile?.balance_cents ?? 0) / 100;
  const stakeNum = Math.max(0, Number(stake) || 0);
  const potentialPayout = selected ? (stakeNum * selected.odds).toFixed(2) : "0.00";
  const stakeExceedsBalance = !!user && stakeNum > balanceDollars;
  const canPlace = !!selected && stakeNum > 0 && (!user || !stakeExceedsBalance) && !submitting;
  const { min: oddsMin, max: oddsMax } = oddsRange(event.outcomes.map((o) => o.odds));

  async function handlePlaceBet() {
    if (!selected || !canPlace) return;
    if (!user) {
      navigate(`/auth/sign-in?next=${encodeURIComponent(`/event/${event.id}`)}`);
      return;
    }
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

  return (
    <section className="card-elevated overflow-hidden">
      <div className="flex items-center justify-between bg-gradient-to-r from-[#1973FF] to-[#5048FF] px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 fill-[#FED448] text-[#FED448]" />
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide">
            Place a bet
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Open
        </span>
      </div>

      <div className="p-5 sm:p-6">

      {/* Sign-in CTA when unauthenticated */}
      {!user && (
        <Link
          to={`/auth/sign-in?next=${encodeURIComponent(`/event/${event.id}`)}`}
          className="mb-4 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/[0.04] px-3 py-2 text-sm font-medium text-primary hover:bg-primary/[0.08]"
        >
          <span className="flex items-center gap-2">
            <LogIn className="h-4 w-4" /> Sign in to use your balance
          </span>
          <span className="text-xs text-muted-foreground">$1000 on signup</span>
        </Link>
      )}

      <ul className="space-y-2">
        {event.outcomes.map((o) => {
          const active = selected?.id === o.id;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => setSelected(o)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-all",
                  active
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : "border-border/40 bg-background/60 hover:border-primary/40 hover:bg-primary/[0.03]",
                )}
              >
                <span className="truncate text-sm font-medium text-foreground">{o.label}</span>
                <span
                  className={cn(
                    "ml-3 inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums",
                    active
                      ? "bg-primary text-primary-foreground"
                      : oddsPillClasses(o.odds, oddsMin, oddsMax),
                  )}
                >
                  {o.odds.toFixed(2)}×
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 space-y-2">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="bet-stake">
          Stake
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">$</span>
          <input
            id="bet-stake"
            type="number"
            min={1}
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            className="h-10 w-full border-0 bg-transparent text-sm font-semibold focus:outline-none"
          />
        </div>
        <div className="flex gap-1">
          {[5, 10, 25, 50].map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setStake(String(amount))}
              className="flex-1 rounded-md border border-border/40 bg-background/60 px-2 py-1 text-xs font-semibold text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
            >
              ${amount}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Potential payout</span>
        <span className="font-heading text-base font-bold text-foreground">${potentialPayout}</span>
      </div>

      {stakeExceedsBalance && (
        <p className="mt-2 text-center text-xs font-medium text-destructive">
          Stake exceeds available balance.
        </p>
      )}

      <Button onClick={handlePlaceBet} size="lg" className="mt-4 w-full" disabled={!canPlace && !!user}>
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
      </div>
    </section>
  );
}

function UpcomingPanel({ event }: { event: StreamEvent }) {
  const startsAt = new Date(event.scheduledAt);
  const diffH = Math.max(0, Math.round((startsAt.getTime() - Date.now()) / 3600_000));
  const { min: oddsMin, max: oddsMax } = oddsRange(event.outcomes.map((o) => o.odds));

  return (
    <section className="card-elevated overflow-hidden">
      <div className="flex items-center justify-between bg-gradient-to-r from-[#1973FF] to-[#5048FF] px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-[#FED448]" />
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide">
            Upcoming
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide backdrop-blur-sm">
          {diffH < 24 ? `in ${Math.max(diffH, 1)}h` : startsAt.toLocaleDateString()}
        </span>
      </div>

      <div className="space-y-4 p-5 sm:p-6">

      <div className="rounded-xl bg-muted/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Starts at
        </p>
        <p className="mt-1 font-heading text-base font-semibold">
          {startsAt.toLocaleString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-accent" />
          <h3 className="font-heading text-sm font-semibold">Bet outcomes</h3>
        </div>
        <ul className="space-y-2">
          {event.outcomes.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 px-3 py-2"
            >
              <span className="truncate text-sm font-medium">{o.label}</span>
              <span
                className={cn(
                  "ml-3 inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums",
                  oddsPillClasses(o.odds, oddsMin, oddsMax),
                )}
              >
                {o.odds.toFixed(2)}×
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Button
        onClick={() => toast.success("We'll ping you when it starts.")}
        size="lg"
        className="w-full gap-2"
      >
        <Bell className="h-4 w-4" /> Notify me when live
      </Button>
      </div>
    </section>
  );
}

function FinishedPanel({ event }: { event: StreamEvent }) {
  const { min: oddsMin, max: oddsMax } = oddsRange(event.outcomes.map((o) => o.odds));
  return (
    <section className="card-elevated overflow-hidden">
      <div className="flex items-center justify-between bg-gradient-to-r from-[#1973FF] to-[#5048FF] px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-[#FED448]" />
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide">
            Final result
          </h2>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide backdrop-blur-sm">
          Ended
        </span>
      </div>

      <div className="space-y-4 p-5 sm:p-6">

      <div className="rounded-xl bg-muted/50 p-4 text-center">
        <Trophy className="mx-auto mb-2 h-6 w-6 text-accent" />
        <p className="font-heading text-base font-semibold">Winner: {event.outcomes[0].label}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Settled at {new Date(event.scheduledAt).toLocaleDateString()}
        </p>
      </div>

      <div>
        <h3 className="mb-2 font-heading text-sm font-semibold">Final odds</h3>
        <ul className="space-y-2">
          {event.outcomes.map((o, i) => (
            <li
              key={o.id}
              className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm">
                {i === 0 && <Trophy className="h-3.5 w-3.5 text-accent" />}
                {o.label}
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums",
                  oddsPillClasses(o.odds, oddsMin, oddsMax),
                )}
              >
                {o.odds.toFixed(2)}×
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Button asChild variant="secondary" size="lg" className="w-full">
        <Link to="/discover">Discover upcoming events</Link>
      </Button>
      </div>
    </section>
  );
}
