import { Link, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell,
  Calendar,
  Users,
  Trophy,
  Clock,
  Wallet,
  LogIn,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LiveBadge } from "@/components/feed/LiveBadge";
import { HlsPlayer } from "@/components/stream/HlsPlayer";
import { RoundStatus } from "@/components/stream/RoundStatus";
import { PageContainer } from "@/components/layout/PageContainer";
import { useEvent } from "@/hooks/useEvents";
import { useAuth } from "@/contexts/AuthContext";
import { placeBet } from "@/services/betsService";
import { betsKeys } from "@/hooks/useMyBets";
import type { BetOutcome, StreamEvent } from "@/domain/types";
import { cn } from "@/lib/utils";

const TEST_STREAM = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

const numberFormatter = new Intl.NumberFormat("en-US");

export default function EventDetails() {
  const { id } = useParams<{ id: string }>();
  const { data: event, isLoading } = useEvent(id);

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
    <PageContainer>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:gap-8">
        <div className="space-y-6">
          {/* Stream / cover slot — phone-screen vertical aspect, fully fits viewport height */}
          <div className="relative mx-auto aspect-[9/16] max-h-[calc(100dvh-130px)] w-full max-w-[420px] overflow-hidden rounded-2xl border border-border/30 bg-black shadow-lg">
            {isLive ? (
              <HlsPlayer src={TEST_STREAM} poster={event.coverUrl} autoPlay muted />
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
              <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-white backdrop-blur">
                {event.category}
              </span>
            </div>

            {isLive && (
              <span className="pointer-events-none absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                <Users className="h-3.5 w-3.5" />
                {numberFormatter.format(event.viewersCount)} watching
              </span>
            )}

            {isLive && (
              <RoundStatus
                durationSec={event.roundDurationSec ?? 30}
                className="absolute left-3 right-14 bottom-3 sm:left-4 sm:right-16 sm:bottom-4"
              />
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
          </div>

          {/* Title + meta */}
          <div>
            <h1 className="font-heading text-2xl font-bold sm:text-3xl">{event.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">{event.description}</p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <img
                  src={event.influencer.avatarUrl}
                  alt={event.influencer.displayName}
                  className="h-9 w-9 rounded-full object-cover ring-1 ring-border"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">
                    {event.influencer.displayName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {event.influencer.handle} · {numberFormatter.format(event.influencer.followers)}{" "}
                    followers
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                <Clock className="h-3.5 w-3.5" />
                {event.roundFormat === "time"
                  ? `Timed rounds — ${event.roundDurationSec ?? 0}s`
                  : "Event-triggered rounds"}
              </span>
              <div className="flex gap-1.5">
                {Object.entries(event.influencer.socials).map(([key, url]) =>
                  url ? (
                    <a
                      key={key}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-border/50 bg-secondary/50 px-2.5 py-1 text-xs font-medium capitalize text-foreground transition-colors hover:bg-secondary"
                    >
                      {key}
                    </a>
                  ) : null,
                )}
              </div>
            </div>
          </div>

          {/* Rules */}
          <section className="rounded-2xl border border-border/30 bg-card p-6">
            <h2 className="mb-2 font-heading text-lg font-semibold">Rules</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{event.rules}</p>
          </section>
        </div>

        {/* Right-side / bottom panel */}
        <aside className="space-y-4">
          {isLive ? (
            <BetPanel event={event} />
          ) : isScheduled ? (
            <UpcomingPanel event={event} />
          ) : (
            <FinishedPanel event={event} />
          )}
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
  const isLow = balanceDollars < 10;
  const stakeNum = Math.max(0, Number(stake) || 0);
  const potentialPayout = selected ? (stakeNum * selected.odds).toFixed(2) : "0.00";
  const stakeExceedsBalance = !!user && stakeNum > balanceDollars;
  const canPlace = !!selected && stakeNum > 0 && (!user || !stakeExceedsBalance) && !submitting;

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
    <section className="card-elevated p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-accent" />
          <h2 className="font-heading text-base font-semibold">Place a bet</h2>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-success">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Open
        </span>
      </div>

      {/* Balance pill / sign-in CTA */}
      {user ? (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-border/40 bg-muted/40 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Your balance</span>
          <span
            className={cn(
              "font-heading text-base font-bold tabular-nums",
              isLow ? "text-destructive" : "text-foreground",
            )}
          >
            ${balanceDollars.toFixed(2)}
          </span>
        </div>
      ) : (
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
                    "ml-3 inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold",
                    active ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
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
    </section>
  );
}

function UpcomingPanel({ event }: { event: StreamEvent }) {
  const startsAt = new Date(event.scheduledAt);
  const diffH = Math.max(0, Math.round((startsAt.getTime() - Date.now()) / 3600_000));

  return (
    <section className="card-elevated space-y-4 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-semibold">Upcoming</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-foreground">
          {diffH < 24 ? `in ${Math.max(diffH, 1)}h` : startsAt.toLocaleDateString()}
        </span>
      </div>

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
              <span className="ml-3 inline-flex flex-shrink-0 items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
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
    </section>
  );
}

function FinishedPanel({ event }: { event: StreamEvent }) {
  return (
    <section className="card-elevated space-y-4 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-semibold">Final result</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Ended
        </span>
      </div>

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
              <span className="text-xs font-bold text-muted-foreground">{o.odds.toFixed(2)}×</span>
            </li>
          ))}
        </ul>
      </div>

      <Button asChild variant="secondary" size="lg" className="w-full">
        <Link to="/discover">Discover upcoming events</Link>
      </Button>
    </section>
  );
}
