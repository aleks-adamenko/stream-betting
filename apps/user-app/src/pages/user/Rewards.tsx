import { useState, type ComponentType, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CoinIcon } from "@/components/ui/CoinAmount";
import { cn } from "@/lib/utils";
// Vite resolves `?url` to a public URL for the bundled SVG. The
// reward glyph (`rs-icon.svg`) is the visual mark for the *second*
// virtual currency — "reward shards" — which doesn't have a real
// ledger yet. Until it does, the Rewards screen only renders the
// icon next to the integer amount; nothing else in the app reads
// `rewardCents` as that currency.
import rsIconUrl from "@/assets/icons/rs-icon.svg?url";

type Unit = "count" | "money" | "days";

interface RewardActivity {
  id: string;
  // `title` + `description` are ReactNodes (not strings) so money-
  // denominated copy can inline the coin glyph in place of "$". The
  // two staking rows ("Stake _coin_ 1,000 in total") use JSX; the
  // rest stay as plain strings, which React still renders verbatim.
  title: ReactNode;
  description: ReactNode;
  icon: ComponentType<{ className?: string }>;
  iconColor: string;
  progress: number;
  target: number;
  unit: Unit;
  rewardCents: number;
}

// First activity is the simple one — pre-completed so Claim is active.
// The rest are in-progress so Claim stays disabled.
const ACTIVITIES: RewardActivity[] = [
  {
    id: "complete-profile",
    title: "Complete your profile",
    description: "Add a photo and display name to start earning rewards.",
    icon: DoodleCrown,
    iconColor: "text-yellow-400",
    progress: 1,
    target: 1,
    unit: "count",
    rewardCents: 500,
  },
  {
    id: "first-bet",
    title: "Place your first bet",
    description: "Pick any live challenge and place one bet.",
    icon: DoodleTarget,
    iconColor: "text-rose-500",
    progress: 0,
    target: 1,
    unit: "count",
    rewardCents: 500,
  },
  {
    id: "ten-bets",
    title: "Place 10 bets",
    description: "Become a regular — 10 bets, any size, any event.",
    icon: DoodleDice,
    iconColor: "text-blue-500",
    progress: 0,
    target: 10,
    unit: "count",
    rewardCents: 1500,
  },
  {
    id: "fifty-bets",
    title: "Place 50 bets",
    description: "Power-user badge — 50 bets across any events.",
    icon: DoodleLayers,
    iconColor: "text-violet-500",
    progress: 0,
    target: 50,
    unit: "count",
    rewardCents: 5000,
  },
  {
    id: "seven-day-streak",
    title: "Bet 7 days in a row",
    description: "Keep the streak — one bet each day for a week.",
    icon: DoodleFlame,
    iconColor: "text-orange-500",
    progress: 0,
    target: 7,
    unit: "days",
    rewardCents: 2500,
  },
  {
    id: "fourteen-day-streak",
    title: "Bet 14 days in a row",
    description: "Hardcore streak — two full weeks of daily bets.",
    icon: DoodleFlameBig,
    iconColor: "text-red-600",
    progress: 0,
    target: 14,
    unit: "days",
    rewardCents: 7500,
  },
  {
    id: "one-k-staked",
    title: (
      <>
        Stake <InlineCoin /> 1,000 in total
      </>
    ),
    description: (
      <>
        Hit <InlineCoin /> 1,000 cumulative across all your bets.
      </>
    ),
    icon: DoodleCoin,
    iconColor: "text-amber-500",
    progress: 5000,
    target: 100000,
    unit: "money",
    rewardCents: 5000,
  },
  {
    id: "ten-k-staked",
    title: (
      <>
        Stake <InlineCoin /> 10,000 in total
      </>
    ),
    description: (
      <>
        Big-stakes club — <InlineCoin /> 10,000 cumulative.
      </>
    ),
    icon: DoodleDiamond,
    iconColor: "text-cyan-500",
    progress: 5000,
    target: 1000000,
    unit: "money",
    rewardCents: 25000,
  },
  {
    id: "five-wins",
    title: "Win 5 bets",
    description: "Show your edge with five winning bets.",
    icon: DoodleTrophy,
    iconColor: "text-emerald-500",
    progress: 0,
    target: 5,
    unit: "count",
    rewardCents: 3000,
  },
  {
    id: "follow-ten",
    title: "Follow 10 creators",
    description: "Build your feed by following ten streamers.",
    icon: DoodleHeart,
    iconColor: "text-pink-500",
    progress: 1,
    target: 10,
    unit: "count",
    rewardCents: 2000,
  },
];

/** Whole-coin amount from a cents value. `5000` → `50`. The coin
 *  glyph is rendered separately by the caller so we keep the helper
 *  string-typed for cases where pure text is enough (e.g. counters). */
const coins = (cents: number) => Math.round(cents / 100).toLocaleString("en-US");

/** Reward shards are denominated as integer counts. `rewardCents` is
 *  stored as cents for compatibility with the rest of the schema, but
 *  in the UI we drop the cents and show the bare integer alongside the
 *  rs-icon glyph. e.g. `rewardCents = 500` → "5". */
const rewardCount = (cents: number) => Math.round(cents / 100);

function RsIcon({ className }: { className?: string }) {
  return (
    <img
      src={rsIconUrl}
      alt=""
      aria-hidden
      className={cn("inline-block h-[1em] w-[1em] align-[-0.125em]", className)}
    />
  );
}

/** Inline-safe coin glyph for use inside flowing text. The shared
 *  `<CoinIcon />` is `display: block` (expects an inline-flex parent
 *  for vertical alignment), which forces a line break when dropped
 *  bare inside a `<p>`. Wrap it in an `inline-flex` span so it
 *  behaves like an inline image alongside the surrounding words. */
function InlineCoin({ className }: { className?: string }) {
  return (
    <span className="inline-flex align-middle">
      <CoinIcon className={className} />
    </span>
  );
}

function formatProgress(
  progress: number,
  target: number,
  unit: Unit,
): ReactNode {
  if (unit === "money") {
    // Coin glyph in place of "$". Format the integer with thousands
    // separators so "1,000" reads the same as the title text.
    return (
      <>
        <InlineCoin /> {coins(progress)} / <InlineCoin /> {coins(target)}
      </>
    );
  }
  if (unit === "days") return `${progress} / ${target} days`;
  return `${progress} / ${target}`;
}

export default function Rewards() {
  const [claimed, setClaimed] = useState<Set<string>>(new Set());

  // Reward shards are a SEPARATE virtual currency from the coins that
  // power top-ups / bets / payouts (the `balance_cents` pot). The rs
  // ledger / wallet doesn't exist yet, so the Claim button is a true
  // no-op for now: no balance mutation, no local "claimed" state, no
  // toast. When the rs wallet ships, restore the mutation here.
  const handleClaim = (_activity: RewardActivity) => {
    /* intentional no-op until reward-shard backend exists */
  };

  const totalEarnedCents = ACTIVITIES.filter((a) =>
    claimed.has(a.id),
  ).reduce((sum, a) => sum + a.rewardCents, 0);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold sm:text-3xl">
              Rewards
            </h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              Complete activities to earn cash bonuses.
            </p>
          </div>
          {totalEarnedCents > 0 && (
            <span className="inline-flex items-center gap-1.5 font-heading text-base font-bold tabular-nums text-foreground sm:text-lg">
              + <RsIcon /> {rewardCount(totalEarnedCents)} earned
            </span>
          )}
        </div>

        <ul className="mt-6 space-y-3 sm:space-y-4">
          {ACTIVITIES.map((activity) => (
            <ActivityWidget
              key={activity.id}
              activity={activity}
              claimed={claimed.has(activity.id)}
              onClaim={() => handleClaim(activity)}
            />
          ))}
        </ul>
    </div>
  );
}

function ActivityWidget({
  activity,
  claimed,
  onClaim,
}: {
  activity: RewardActivity;
  claimed: boolean;
  onClaim: () => void;
}) {
  const Icon = activity.icon;
  const isComplete = activity.progress >= activity.target;
  const percent = Math.min(
    100,
    Math.round((activity.progress / activity.target) * 100),
  );

  return (
    <li className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
      <div className="flex gap-3 sm:gap-4">
        {/* Left column: icon + title/description + progress, fills remaining width */}
        <div className="flex min-w-0 flex-1 gap-3 sm:gap-4">
          {/* Doodle icon — no container, just the SVG. `self-center` so the
              icon centers vertically against the taller content column. */}
          <Icon
            className={cn(
              "h-14 w-14 flex-shrink-0 self-center sm:h-16 sm:w-16",
              activity.iconColor,
            )}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <p className="font-heading text-base font-semibold leading-tight text-foreground sm:text-lg">
              {activity.title}
            </p>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              {activity.description}
            </p>

            {/* Progress pinned to the bottom so it lines up with the right-
                column button regardless of how long the description wraps. */}
            <div className="mt-auto space-y-2 pt-3 sm:pt-4">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="font-medium text-muted-foreground">
                  Progress
                </span>
                <span className="font-bold tabular-nums text-foreground">
                  {formatProgress(
                    activity.progress,
                    activity.target,
                    activity.unit,
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    isComplete
                      ? "bg-gradient-to-r from-success to-emerald-400"
                      : "bg-gradient-to-r from-primary to-blue-400",
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right column: amount on top, Claim button on bottom */}
        <div className="flex flex-shrink-0 flex-col items-end justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 font-heading text-lg font-bold tabular-nums text-foreground sm:text-xl">
            + <RsIcon /> {rewardCount(activity.rewardCents)}
          </span>
          <Button
            variant="accent"
            size="lg"
            disabled={!isComplete || claimed}
            onClick={onClaim}
          >
            {claimed ? "Claimed" : "Claim"}
          </Button>
        </div>
      </div>
    </li>
  );
}

/* ---------- doodle icons ----------
 * Hand-drawn outline style matching Crown/Bolt in SideNavUserCard. Each uses
 * `currentColor` so the parent's `text-*` class drives the contrast color.
 */

function DoodleCrown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path
        d="M4 22 L2 9 L9 17 L16 5 L23 17 L30 9 L28 22 Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <circle cx="2" cy="9" r="2" fill="currentColor" />
      <circle cx="16" cy="5" r="2.5" fill="currentColor" />
      <circle cx="30" cy="9" r="2" fill="currentColor" />
    </svg>
  );
}

function DoodleTarget({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <circle
        cx="16"
        cy="16"
        r="13"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
    </svg>
  );
}

function DoodleDice({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <rect
        x="4"
        y="4"
        width="24"
        height="24"
        rx="4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <circle cx="10" cy="10" r="2" fill="currentColor" />
      <circle cx="22" cy="10" r="2" fill="currentColor" />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
      <circle cx="10" cy="22" r="2" fill="currentColor" />
      <circle cx="22" cy="22" r="2" fill="currentColor" />
    </svg>
  );
}

function DoodleLayers({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path
        d="M16 3 L29 11 L16 19 L3 11 Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path
        d="M3 16 L16 24 L29 16"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M3 22 L16 30 L29 22"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function DoodleFlame({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path
        d="M16 3 C 20 9, 19 13, 22 18 C 24 23, 22 29, 16 29 C 10 29, 8 23, 10 18 C 12 14, 15 13, 13 9 C 14 7, 14 5, 16 3 Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path
        d="M16 16 C 18 19, 18 23, 16 26 C 14 23, 14 19, 16 16 Z"
        fill="currentColor"
        fillOpacity="0.5"
      />
    </svg>
  );
}

function DoodleFlameBig({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path
        d="M16 3 C 21 9, 20 13, 23 18 C 25 23, 23 29, 16 29 C 9 29, 7 23, 9 18 C 11 14, 14 13, 12 9 C 14 7, 14 5, 16 3 Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.22"
      />
      <path
        d="M16 14 C 18 17, 19 22, 16 27 C 13 22, 14 17, 16 14 Z"
        fill="currentColor"
        fillOpacity="0.55"
      />
      <circle cx="5" cy="10" r="1.5" fill="currentColor" />
      <circle cx="27" cy="9" r="1.5" fill="currentColor" />
      <circle cx="3" cy="22" r="1" fill="currentColor" />
      <circle cx="29" cy="21" r="1" fill="currentColor" />
    </svg>
  );
}

function DoodleCoin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <circle
        cx="16"
        cy="16"
        r="12.5"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <line
        x1="16"
        y1="8"
        x2="16"
        y2="24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 12 C 20 10, 18 9, 16 9 C 13 9, 11 11, 11 13 C 11 15, 13 16, 16 16 C 19 16, 21 17, 21 19 C 21 21, 19 23, 16 23 C 14 23, 12 22, 11 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function DoodleDiamond({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path
        d="M8 4 L24 4 L29 12 L16 29 L3 12 Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path
        d="M3 12 L29 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8 4 L13 12 L16 29"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M24 4 L19 12 L16 29"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function DoodleTrophy({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path
        d="M10 4 L22 4 L21 14 C 21 17, 18 19, 16 19 C 14 19, 11 17, 11 14 Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path
        d="M11 7 C 7 7, 6 11, 9 13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M21 7 C 25 7, 26 11, 23 13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <line
        x1="16"
        y1="19"
        x2="16"
        y2="24"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M10 28 L22 28 L21 24 L11 24 Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.18"
      />
    </svg>
  );
}

function DoodleHeart({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path
        d="M16 28 C 7 22, 3 16, 3 11 C 3 7, 6 4, 10 4 C 13 4, 15 6, 16 8 C 17 6, 19 4, 22 4 C 26 4, 29 7, 29 11 C 29 16, 25 22, 16 28 Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.22"
      />
    </svg>
  );
}
