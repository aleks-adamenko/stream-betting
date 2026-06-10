import { useId } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Flame, Gift, Lock } from "lucide-react";

import {
  DAILY_CAP_CENTS,
  MAX_BET_CENTS,
  MAX_ROUND_STAKE_CENTS,
} from "@liverush/lib";

import { cn } from "@/lib/utils";
// Tier-1 badge artwork. `?url` hands Vite a stable URL we can drop
// straight into <img src=> — same pattern Rewards uses for its
// rs-icon.svg, and what the Profile page used before this extraction.
import tier1BadgeUrl from "@/assets/icons/tier-1-badge.png?url";

/**
 * Tier system — single source of truth.
 *
 * Static-for-now: every signed-in viewer is Tier 1. A future
 * migration will introduce promotion criteria (e.g. lifetime stake,
 * win rate, active-days) plus per-tier limit overrides. Today Tier
 * 1's betting limits mirror the platform-wide constants in
 * @liverush/lib / get_betting_constants(), so the values shown to
 * viewers always match what `place_bet` actually enforces.
 *
 * Lives here (not in the Profile page) because two surfaces now
 * read it — the Profile tier-hero + limits card, and the Home page
 * "no live streams" panel.
 */
export const TIERS = {
  1: {
    label: "Tier 1",
    maxBetCents: MAX_BET_CENTS,
    maxRoundStakeCents: MAX_ROUND_STAKE_CENTS,
    dailyCapCents: DAILY_CAP_CENTS,
    description: "Starter tier. Stay active to unlock higher tiers.",
    /** Badge artwork shown in the hero header. */
    badgeUrl: tier1BadgeUrl,
    /** Marketing copy below the tier name in the header. */
    nextRewardCopy: "Keep playing to unlock even better rewards!",
    /** Faked XP for now — no XP system landed yet, but the hero has
     *  a progress bar so the design reads as "in-progress, not
     *  flat". When the XP system arrives, swap these to data-driven
     *  values returned by a `get_viewer_xp(user_id)` RPC; the
     *  component contract stays the same. */
    xpCurrent: 320,
    xpNextThreshold: 1000,
  },
} as const;

export type TierId = keyof typeof TIERS;

export function getViewerTier(): TierId {
  // No promotion logic yet — every signed-in viewer is Tier 1.
  return 1;
}

const TIER_TIMELINE = [
  { id: 1, label: "Tier 1" },
  { id: 2, label: "Tier 2" },
  { id: 3, label: "Tier 3" },
];

/**
 * Tier 1/2/3 dots a viewer sees below the XP progress bar. The
 * three visible dots represent the next steps in the progression
 * ladder, with the track behind them fading to transparent on the
 * right so the viewer reads "there are more tiers past what's
 * shown" without us having to enumerate every future tier label.
 */
function TierTimeline({ currentTierId }: { currentTierId: number }) {
  return (
    <div className="relative mt-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-3 h-px -translate-y-1/2"
        style={{
          background:
            "linear-gradient(to right, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.28) 70%, transparent 100%)",
        }}
      />
      <div
        className="relative flex justify-between"
        style={{ width: "70%" }}
      >
        {TIER_TIMELINE.map((t) => {
          const isActive = t.id === currentTierId;
          return (
            <div key={t.id} className="flex flex-col items-center">
              <div
                style={
                  isActive
                    ? {
                        backgroundColor: "#FFDD49",
                        color: "#1B1F4E",
                        boxShadow: "0 0 10px rgba(255,221,73,0.55)",
                      }
                    : {
                        backgroundColor: "#2A1FCF",
                        border: "1px solid rgba(255,255,255,0.35)",
                        color: "rgba(255,255,255,0.7)",
                      }
                }
                className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
              >
                {t.id}
              </div>
              <span
                className={cn(
                  "mt-1.5 text-[10px] font-medium",
                  isActive ? "text-white" : "text-white/60",
                )}
              >
                {t.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Faked 7-day check-in streak — six green flames for completed
 * days, one muted slot for the day that hasn't been claimed yet.
 * Matches the design reference the operator attached. Mock data
 * for now (`[true, true, true, true, true, true, false]`); when
 * the streak system ships, replace with values from a
 * `get_viewer_streak(user_id)` RPC and keep this component's
 * contract identical.
 */
const STREAK_MOCK = [true, true, true, true, true, true, false];

/**
 * Lucide's `Flame` icon path, filled with our brand-yellow
 * gradient (#FFDD49 → #FFBE3B — same accent gradient the XP bar
 * uses) via an SVG `<linearGradient>`. A plain Lucide component
 * can only take a single `currentColor`, which would flatten the
 * fire to a solid yellow; this inline copy lets the gradient
 * actually render on the icon path itself.
 *
 * `useId()` gives every instance a unique gradient `id` so two
 * flames side-by-side don't collide on the same `<defs>` lookup.
 */
function FlameGradient({ className }: { className?: string }) {
  const reactId = useId();
  // useId() returns ":r1:" — colons break SVG id refs, so sanitise.
  const gradId = `flame-grad-${reactId.replace(/:/g, "")}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFDD49" />
          <stop offset="100%" stopColor="#FFBE3B" />
        </linearGradient>
      </defs>
      <path
        d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
        fill={`url(#${gradId})`}
        stroke={`url(#${gradId})`}
      />
    </svg>
  );
}

/**
 * "Next achievement" block — small dashboard-style container that
 * teases the next XP-earning task and how close the viewer is to
 * finishing it. Static mock data today (the achievements system
 * isn't shipped yet); when the real one lands, replace
 * `ACHIEVEMENT_MOCK` with hook data — the component contract stays
 * the same.
 *
 * Sits between the XP progress bar and the streak strip so the
 * widget reads top-to-bottom as: where you are (XP) → what to do
 * next (achievement) → keep showing up (streak).
 */
const ACHIEVEMENT_MOCK = {
  title: "Place 10 bets",
  current: 2,
  target: 10,
  rewardXp: 50,
};

function NextAchievement() {
  const a = ACHIEVEMENT_MOCK;
  return (
    <div className="mt-5 rounded-lg bg-white/[0.07] p-3 ring-1 ring-inset ring-white/15">
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/65">
        Next achievement
      </p>
      {/* Title + inline progress pill on the left, XP reward on
          the right. The progress pill is a dark-navy chip with a
          thin white ring — visually distinct from the brand-yellow
          accents elsewhere in the panel (TIER pill, +XP, streak
          flames) so the eye reads it as a stat badge, not another
          highlight. */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-white">
          <span className="truncate">{a.title}</span>
          <span className="inline-flex flex-shrink-0 items-center rounded-md bg-[#1B1F4E]/60 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white ring-1 ring-inset ring-white/20">
            {a.current}/{a.target}
          </span>
        </p>
        <span className="flex-shrink-0 text-xs font-bold text-[#FFDD49]">
          +{a.rewardXp} XP
        </span>
      </div>
    </div>
  );
}

function StreakRow() {
  const completedDays = STREAK_MOCK.filter(Boolean).length;
  const remainingDays = STREAK_MOCK.length - completedDays;
  // Motivational line shown below the day strip. We tailor the copy
  // by whether the reward is still locked or already claimable so
  // the user always reads something actionable for their current
  // state. Plural-aware ("1 day" vs "N days") so the wording stays
  // natural across the whole arc.
  const motivationalLine =
    remainingDays > 0
      ? `${remainingDays} day${remainingDays === 1 ? "" : "s"} to go — keep your streak alive to unlock the reward.`
      : "Streak complete — your reward is ready to claim.";
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        {/* Animated, gradient-filled flame. The `flame-flicker`
            class lives in apps/user-app/src/index.css and gives a
            subtle scale + rotation jitter so the fire reads as
            alive against the static gradient header. */}
        <FlameGradient className="h-4 w-4 flame-flicker" />
        <span className="text-sm font-semibold text-white">
          {completedDays} day streak
        </span>
      </div>

      {/* Row of 7 day-cells PLUS an 8th "reward" cell — the prize
          you unlock after a full streak. `grid-cols-8` keeps every
          slot equal width; on the narrow Home tier card (~280px
          wide) that lands each cell at ~22px, still readable at
          `text-[9px]`. Completed days use the brand-yellow gradient
          + dark-navy flame; pending days fade to transparent-white.
          The reward slot is yellow-tinted (suggesting the unlock
          colour) with a small Lock badge overlay so its
          "available but locked" state reads at a glance. */}
      <ul className="mt-2 grid grid-cols-8 gap-1.5">
        {STREAK_MOCK.map((active, i) => {
          const day = i + 1;
          return (
            <li
              key={day}
              className="flex min-w-0 flex-col items-center gap-1"
            >
              <span className="truncate text-[9px] font-medium text-white/65">
                Day {day}
              </span>
              <div
                className={cn(
                  "flex aspect-square w-full items-center justify-center rounded-md",
                  active
                    ? "bg-gradient-to-br from-[#FFDD49] to-[#FFBE3B] shadow-[0_0_6px_rgba(255,221,73,0.45)]"
                    : "bg-white/10 ring-1 ring-inset ring-white/15",
                )}
                aria-label={
                  active
                    ? `Day ${day} completed`
                    : `Day ${day} not yet completed`
                }
              >
                {active && (
                  <Flame
                    className="h-3 w-3 fill-[#1B1F4E] text-[#1B1F4E]"
                    aria-hidden
                  />
                )}
              </div>
            </li>
          );
        })}

        {/* Reward slot — 8th cell. Gift icon inside (the reward
            itself), with a small Lock badge anchored to the
            bottom-right corner so the locked state is unmistakable
            without removing the gift. Yellow-tinted bg + ring hints
            at the brand-accent palette the unlocked state would
            switch to. `relative` on the cell lets the lock badge
            absolutely position over its corner. */}
        <li className="flex min-w-0 flex-col items-center gap-1">
          <span className="truncate text-[9px] font-medium text-white/65">
            Reward
          </span>
          <div
            className="relative flex aspect-square w-full items-center justify-center rounded-md bg-[#FFDD49]/15 ring-1 ring-inset ring-[#FFDD49]/35"
            aria-label="7-day streak reward — locked"
          >
            <Gift
              className="h-3 w-3 text-[#FFDD49]"
              aria-hidden
            />
            {/* Lock badge — a small dark circle in the corner
                holding the lock icon. The negative inset
                (-right-0.5 -bottom-0.5) overlaps the cell's edge
                so the badge reads as "stamped on top" rather than
                competing for the cell's center with the gift. */}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-[#1B1F4E] ring-1 ring-white/20">
              <Lock
                className="h-2 w-2 text-white"
                aria-hidden
                strokeWidth={3}
              />
            </span>
          </div>
        </li>
      </ul>

      {/* Motivational copy — short, plural-aware, swaps to a
          "ready to claim" message once all 7 days are complete. */}
      <p className="mt-3 text-[11px] leading-snug text-white/75">
        {motivationalLine}
      </p>
    </div>
  );
}

/**
 * "320 / 1000 XP" counter on top of an accent-gradient progress
 * bar, optionally followed by the TIER 1/2/3 progression timeline.
 *
 * `actionSlot` is rendered to the right of the XP counter on the
 * same row — used by the Home widget's compact variant to surface
 * an "Explore tier" link that deep-links into the full Profile
 * tier card. `showTimeline=false` drops the dots below; the Home
 * widget hides them because the "Explore tier" link already gives
 * viewers a way to see the full ladder.
 */
function XpProgress({
  current,
  threshold,
  percent,
  tierLabel,
  currentTierId,
  showTimeline = true,
  actionSlot,
}: {
  current: number;
  threshold: number;
  percent: number;
  tierLabel: string;
  currentTierId: number;
  showTimeline?: boolean;
  actionSlot?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold tabular-nums text-white">
          {current} / {threshold} <span className="text-white/70">XP</span>
        </p>
        {actionSlot}
      </div>
      <div
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={threshold}
        aria-valuenow={current}
        aria-label={`${tierLabel} XP progress`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#FFDD49] to-[#FFBE3B] shadow-[0_0_8px_rgba(255,221,73,0.6)] transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      {showTimeline && <TierTimeline currentTierId={currentTierId} />}
    </>
  );
}

/**
 * The gradient-interior block — badge + "CURRENT TIER" copy + XP +
 * tier dots. Exported so the Profile page can drop it inside a
 * larger card that ALSO has the per-tier betting-limits list
 * underneath, without duplicating this JSX.
 *
 * `compact` keeps the badge/text in a single row but ALWAYS stacks
 * the XP bar below them (instead of switching to a side column on
 * `lg:`). Use for narrow containers like the Home "no live streams"
 * panel where the side-by-side desktop layout would overflow.
 */
export function TierHeroContent({
  compact = false,
  className,
}: { compact?: boolean; className?: string } = {}) {
  const tier = TIERS[getViewerTier()];
  // Clamp at 100% in case a future XP value overshoots the threshold
  // while we wait for the tier-promote job to run.
  const xpPercent = Math.min(
    100,
    Math.round((tier.xpCurrent / tier.xpNextThreshold) * 100),
  );

  // Compact mode owns its own layout because the Home tier card is
  // narrow enough that the desktop "badge on the left, headline +
  // teaser in the middle, XP block on the right" shape would
  // overflow. Operator-requested layout: drop the "Current tier" /
  // "Tier 1" / reward-copy header entirely, shrink the badge, and
  // line up [TIER pill] [XP counter] [Explore tier link] in one row
  // above the progress bar, with the small badge sitting to the
  // left of the bar.
  if (compact) {
    return (
      // `flex h-full flex-col` lets the inner content spread via
      // mt-auto on the streak block. Min-height is OWNED by the
      // outer card (passed via `className` from the home page so
      // both right-panel cards — tier hero AND anon sign-up — share
      // the same `min-h-[X]` and end up visually identical).
      <div
        className={cn(
          "relative flex h-full flex-col bg-gradient-to-b from-[#6525FF] to-[#0124C7] px-6 py-6 text-white",
          className,
        )}
      >
        <div className="flex items-center gap-3">
          <img
            src={tier.badgeUrl}
            alt={`${tier.label} badge`}
            // h-12 keeps the badge present without dominating the
            // narrow card; the slight scaleY squeeze inherited from
            // the original styling stays so the ribbon sits closer
            // to the medallion's baseline.
            style={{ transform: "scaleY(0.95)" }}
            className="h-12 w-auto flex-shrink-0 drop-shadow-[0_4px_8px_rgba(0,0,0,0.35)]"
          />
          <div className="min-w-0 flex-1">
            {/* Counter row — [TIER pill] [320 / 1000 XP] on the
                left, "Explore tier →" on the right. The pill uses
                the brand-yellow gradient + dark-navy text, matching
                the colour pairing of the active tier-progress dot
                and the streak-cell pattern so the highlight
                signals "this is YOU" across the whole panel. */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-flex flex-shrink-0 items-center rounded-md bg-gradient-to-br from-[#FFDD49] to-[#FFBE3B] px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#1B1F4E] shadow-[0_0_6px_rgba(255,221,73,0.35)]"
                >
                  {tier.label}
                </span>
                <p className="truncate text-sm font-semibold tabular-nums text-white">
                  {tier.xpCurrent} / {tier.xpNextThreshold}{" "}
                  <span className="text-white/70">XP</span>
                </p>
              </div>
              {/* Circular "go to profile" affordance — arrow-only,
                  outline-style. Transparent interior with a 1px
                  brand-yellow border and yellow arrow keeps the
                  control visually quiet while still reading as
                  tappable. A tiny yellow-tinted hover fill gives
                  feedback without flipping to the previous filled
                  pill shape. */}
              <Link
                to="/profile"
                aria-label="Explore tier"
                className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-[#FFDD49] text-[#FFDD49] transition-colors hover:bg-[#FFDD49]/15"
              >
                <ArrowRight
                  className="h-3 w-3"
                  strokeWidth={2.5}
                  aria-hidden
                />
              </Link>
            </div>
            {/* Progress bar. Same accent gradient + glow the XpProgress
                helper uses for the non-compact variant; inlined here
                because the surrounding markup (TIER pill on the
                left of the counter, badge to the left of the bar)
                diverges enough that sharing XpProgress wasn't
                worth a third prop slot. */}
            <div
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={tier.xpNextThreshold}
              aria-valuenow={tier.xpCurrent}
              aria-label={`${tier.label} XP progress`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#FFDD49] to-[#FFBE3B] shadow-[0_0_8px_rgba(255,221,73,0.6)] transition-[width] duration-500"
                style={{ width: `${xpPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Next-achievement teaser sits between XP and the streak
            so the eye flows: where you are (XP) → next thing to do
            (achievement) → keep showing up (streak). */}
        <NextAchievement />

        {/* Streak strip is pinned to the bottom via `mt-auto` so any
            extra height the card inherits from the grid row (or
            our min-h-[26rem] floor) lands BETWEEN the achievement
            block and the streak — same balance the SignUpPromptCard
            uses for its CTA. */}
        <div className="mt-auto">
          <StreakRow />
        </div>
      </div>
    );
  }

  // Non-compact (Profile page) — keeps the original "badge on the
  // left, headline + teaser in the middle, XP block on the right
  // at lg:+" layout. Streak row is hidden because the Profile
  // page surfaces the full tier limits + tier-progress timeline
  // separately and the streak strip would duplicate the same
  // "keep playing" message.
  return (
    <div
      className={cn(
        "relative bg-gradient-to-b from-[#6525FF] to-[#0124C7] px-6 py-6 text-white",
        className,
      )}
    >
      <div className="flex items-center gap-4 sm:gap-5">
        <img
          src={tier.badgeUrl}
          alt={`${tier.label} badge`}
          style={{ transform: "scaleY(0.95)" }}
          className="h-20 w-auto flex-shrink-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)] sm:h-28"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
            Current tier
          </p>
          <h3 className="mt-0.5 font-heading text-2xl font-extrabold uppercase tracking-wide sm:text-3xl">
            {tier.label}
          </h3>
          <p className="mt-1.5 text-xs leading-snug text-white/80 sm:text-sm">
            {tier.nextRewardCopy}
          </p>
        </div>

        {/* Side-by-side XP column — only at `lg:` and up; below
            that the stacked variant just below takes over. */}
        <div className="hidden flex-shrink-0 lg:block lg:w-44">
          <XpProgress
            current={tier.xpCurrent}
            threshold={tier.xpNextThreshold}
            percent={xpPercent}
            tierLabel={tier.label}
            currentTierId={getViewerTier()}
          />
        </div>
      </div>

      {/* Stacked XP — full-width row below the badge/text. Hidden
          on `lg:` (the side column above takes over). */}
      <div className="mt-5 lg:hidden">
        <XpProgress
          current={tier.xpCurrent}
          threshold={tier.xpNextThreshold}
          percent={xpPercent}
          tierLabel={tier.label}
          currentTierId={getViewerTier()}
        />
      </div>
    </div>
  );
}

/**
 * Self-contained "tier hero" card — gradient interior wrapped in a
 * rounded card with the same chrome as other Profile-page cards
 * (border + shadow + bg-card). Drop-in for Home and any other
 * standalone use.
 *
 * Pass `compact` when the container is narrow (e.g., 1 event-card
 * width on Home). In compact mode the XP bar stacks below the
 * badge/text instead of taking a side column.
 */
export function TierHeroCard({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    // `flex h-full flex-col` + `flex-1` on the gradient interior so
    // the purple-to-blue fill stretches to the card's full height
    // whenever the parent (e.g., the Home page's grid with
    // items-stretch) makes the card taller than the hero's natural
    // content. Without this, a white strip would peek out at the
    // bottom from the section's `bg-card`. `bg-card` is dropped on
    // the standalone card variant for the same reason — the
    // gradient is the only background that should show through.
    <section
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl border border-border/40 shadow-sm",
        className,
      )}
    >
      <TierHeroContent compact={compact} className="flex-1" />
    </section>
  );
}
