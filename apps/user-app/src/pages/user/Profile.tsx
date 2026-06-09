import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarDays,
  Camera,
  Flag,
  KeyRound,
  ListChecks,
  LogOut,
  Mail,
  ShieldAlert,
  Target,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CoinAmount, CoinIcon } from "@/components/ui/CoinAmount";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useMyBets } from "@/hooks/useMyBets";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  uploadAvatar,
  updateDisplayName,
  AVATAR_MAX_BYTES,
  AVATAR_ALLOWED_MIME,
} from "@/services/profileService";
import {
  DAILY_CAP_CENTS,
  MAX_BET_CENTS,
  MAX_ROUND_STAKE_CENTS,
} from "@liverush/lib";
// Tier-1 badge artwork lives in src/assets/icons. `?url` hands Vite
// a stable URL we can drop straight into <img src=> — same pattern
// the Rewards page uses for rs-icon.svg.
import tier1BadgeUrl from "@/assets/icons/tier-1-badge.png?url";

export default function Profile() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState<string>(profile?.display_name ?? "");
  const initialName = profile?.display_name ?? "";

  useEffect(() => {
    setNameDraft(profile?.display_name ?? "");
  }, [profile?.display_name]);

  // `fallbackHandle` is still passed to uploadAvatar's success
  // toast indirectly via the profile refresh — the avatar circle
  // moved into the ProfileLayout sidebar so we no longer render it
  // here, just keep the file upload trigger inside the "Profile
  // photo" card.

  const avatarMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Not signed in");
      return uploadAvatar(file, user.id);
    },
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Profile photo updated");
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message);
    },
  });

  const nameMutation = useMutation({
    mutationFn: async (name: string) => updateDisplayName(name),
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Display name updated");
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Update failed";
      toast.error(message);
    },
  });

  const handleFile = (file: File) => {
    if (!AVATAR_ALLOWED_MIME.includes(file.type)) {
      toast.error("Use a JPG or PNG file.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error(
        `File is too large (${(file.size / 1024).toFixed(0)} KB). Max 200 KB.`,
      );
      return;
    }
    avatarMutation.mutate(file);
  };

  const trimmed = nameDraft.trim();
  const nameChanged = trimmed !== initialName.trim();
  const nameValid = trimmed.length >= 2 && trimmed.length <= 30;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="font-heading text-2xl font-bold sm:text-3xl">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Manage how you appear on LiveRush.
        </p>

        {/* TierLimits sits first — the tier hero (badge, XP bar,
            betting limits) is the most "what am I right now" piece
            of context the user wants on landing, so the gradient
            block leads the page. AccountSummary (joined / verified /
            lifetime stats) follows directly beneath as the
            "how I got here" companion. */}
        <TierLimits />
        <AccountSummary />

        {/* Photo upload card */}
        <div className="mt-6 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="font-heading text-base font-semibold">Profile photo</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            JPG or PNG, max 200 KB. Square images look best.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarMutation.isPending}
            >
              <Camera className="h-4 w-4" />
              {avatarMutation.isPending ? "Uploading…" : "Change photo"}
            </Button>
          </div>
        </div>

        {/* Display name card */}
        <div className="mt-5 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="font-heading text-base font-semibold">Display name</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Shown instead of your email throughout LiveRush.
          </p>
          <div className="mt-4 space-y-2">
            <label htmlFor="display-name" className="sr-only">
              Display name
            </label>
            <Input
              id="display-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={30}
              placeholder={user?.email?.split("@")[0] ?? "your name"}
            />
            <p className="text-xs text-muted-foreground">
              2–30 characters. Letters, numbers and basic punctuation.
            </p>
          </div>
          <div className="mt-4">
            <Button
              type="button"
              disabled={!nameChanged || !nameValid || nameMutation.isPending}
              onClick={() => nameMutation.mutate(trimmed)}
            >
              {nameMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Account — sign-in email + connected accounts. The two
            buttons are UI-only for now: no backend wiring exists
            for password reset or Google account linking — they
            fire a "coming soon" toast so the affordance is
            testable without dead-clicks. */}
        <div className="mt-5 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="font-heading text-base font-semibold">Account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign-in email and connected accounts.
          </p>

          {/* Email row */}
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-muted/50 p-4">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Email
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                {user?.email}
              </p>
            </div>
          </div>

          {/* Sign-in options. `justify-start` so the icon + label
              hug the left edge instead of centring inside a wide
              w-full button — reads like a list row. */}
          <div className="mt-4 space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() =>
                toast.info("Password reset is coming soon.")
              }
            >
              <KeyRound className="h-4 w-4" />
              Reset password
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() =>
                toast.info("Google sign-in is coming soon.")
              }
            >
              <GoogleIcon className="h-4 w-4" />
              Connect Google
            </Button>
          </div>
        </div>

        {/* Notifications card — global email opt-out + per-category
            opt-out for payouts/refunds. Both rows align on the left
            so the relationship reads as siblings; the payouts row
            still grays out when the global one is off, signalling the
            gating without nested indentation. In-app notifications
            on /notifications are not affected by either toggle. */}
        <div className="mt-5 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="font-heading text-base font-semibold">Notifications</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which emails you receive from LiveRush.
          </p>
          <div className="mt-4 space-y-2">
            <NotificationsToggle />
            <PayoutsNotificationsToggle />
          </div>
        </div>

        {/* Mobile-only sign out */}
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await signOut();
              navigate("/", { replace: true });
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
    </div>
  );
}

/**
 * Static-for-now tier definition. All viewers start at Tier 1; a
 * future migration will introduce promotion criteria (e.g. lifetime
 * stake, win rate, active-days) plus per-tier limit overrides. Today
 * Tier 1 mirrors the platform-wide constants in @liverush/lib /
 * get_betting_constants() — so the limits shown here always match
 * what `place_bet` actually enforces. When tiered limits arrive,
 * `getViewerTier()` becomes data-driven and TIERS gains additional
 * entries; the component contract stays unchanged.
 */
const TIERS = {
  1: {
    label: "Tier 1",
    maxBetCents: MAX_BET_CENTS,
    maxRoundStakeCents: MAX_ROUND_STAKE_CENTS,
    dailyCapCents: DAILY_CAP_CENTS,
    description: "Starter tier. Stay active to unlock higher tiers.",
    /** Badge artwork shown in the TierLimits header. */
    badgeUrl: tier1BadgeUrl,
    /** Marketing copy below the tier name in the header. */
    nextRewardCopy: "Keep playing to unlock even better rewards!",
    /** Faked XP for now — no XP system landed yet, but the header
     *  has a progress bar so the design reads as "in-progress, not
     *  flat". When the XP system arrives, swap these to data-driven
     *  values returned by a `get_viewer_xp(user_id)` RPC; the
     *  component contract stays the same. */
    xpCurrent: 320,
    xpNextThreshold: 1000,
  },
} as const;

type TierId = keyof typeof TIERS;

function getViewerTier(): TierId {
  // No promotion logic yet — every signed-in viewer is Tier 1.
  return 1;
}

const joinedFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * Lifetime-activity + verification + tier limits block. Renders at
 * the top of the Profile page above the photo card. Pure read-only
 * — pulls `user` / `profile` from AuthContext, lifetime bet stats
 * from `useMyBets` (the same cached query MyBets / DesktopTopNav
 * use, so no extra fetch), and the tier limits from the static
 * TIERS map above.
 *
 * Stat semantics:
 *   • Events bet on  — distinct event_ids the viewer has ever bet on
 *     (any status, including refunded — the bet was placed).
 *   • Events won     — distinct event_ids where AT LEAST one of the
 *     viewer's bets settled as 'won'.
 *   • Total staked   — sum of every bet's amount_cents (lifetime).
 *     Includes losses and refunds because the money WAS at risk
 *     when the bet was placed.
 *   • Total won      — sum of payout_cents on bets in 'won' status.
 *     The gross payout, not net of stake.
 */
function AccountSummary() {
  const { user, profile } = useAuth();
  const { data: bets } = useMyBets();

  // Derive lifetime stats once. `bets` is React-Query-cached, so the
  // useMemo dependency keeps this cheap on every Profile re-render.
  const stats = useMemo(() => {
    const eventsBetOn = new Set<string>();
    const eventsWon = new Set<string>();
    let totalStakedCents = 0;
    let totalWonCents = 0;
    for (const b of bets ?? []) {
      if (b.event_id) eventsBetOn.add(b.event_id);
      totalStakedCents += b.amount_cents ?? 0;
      if (b.status === "won") {
        if (b.event_id) eventsWon.add(b.event_id);
        totalWonCents += b.payout_cents ?? 0;
      }
    }
    return {
      eventsBetOnCount: eventsBetOn.size,
      eventsWonCount: eventsWon.size,
      totalStakedCents,
      totalWonCents,
    };
  }, [bets]);

  const tier = TIERS[getViewerTier()];
  // `user.created_at` is the Supabase-auth account-creation
  // timestamp. profile.created_at would also work but we prefer
  // the auth-side stamp so we don't depend on the profile row
  // trigger having run yet. Defensive ?? in case the auth user
  // somehow loads without it (shouldn't, but harmless).
  const joinedAt = user?.created_at ? new Date(user.created_at) : null;
  const joinedLabel = joinedAt ? joinedFormatter.format(joinedAt) : "—";
  // Supabase auth: email_confirmed_at is non-null once the user
  // clicked the confirmation link. Also accept profile.viewer_activated_at
  // as a fallback signal for users who confirmed via legacy flows
  // (the activate_viewer RPC stamps it independently).
  const isVerified =
    !!user?.email_confirmed_at || !!profile?.viewer_activated_at;

  return (
    <section className="mt-6 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
      {/* Title only — matches the other Profile section headers
          (`Profile photo`, `Display name`, `Account`,
          `Notifications`) for consistency. The standalone TIER
          chip + the description subheader that used to sit here
          were dropped per operator feedback — the tier hero card
          above this one already carries that context. */}
      <h2 className="font-heading text-base font-semibold">Your activity</h2>

      {/* Account row — joined date + verification chip. Always
          two-up: the rows are short and reading them on a single
          column on mobile wasted half the available width. No
          internal divider; the dl rhythm + stat-row icons give the
          section enough structure without a hairline rule. */}
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <SummaryRow
          icon={CalendarDays}
          label="Joined"
          value={joinedLabel}
        />
        <SummaryRow
          icon={isVerified ? BadgeCheck : ShieldAlert}
          label="Email"
          value={isVerified ? "Verified" : "Not verified"}
          valueClassName={
            isVerified ? "text-success" : "text-muted-foreground"
          }
        />
      </dl>

      {/* Activity stats — always 2×2 grid (was 1-col on phones, but
          the rows are compact and pair nicely two-up at any width). */}
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <SummaryRow
          icon={ListChecks}
          label="Events bet on"
          value={stats.eventsBetOnCount.toString()}
        />
        <SummaryRow
          icon={Trophy}
          label="Events won"
          value={stats.eventsWonCount.toString()}
        />
        <SummaryRow
          label="Total staked"
          coinValue={stats.totalStakedCents}
        />
        <SummaryRow
          label="Total won"
          coinValue={stats.totalWonCents}
          valueClassName="text-success"
        />
      </dl>

    </section>
  );
}

/**
 * Standalone "Tier N betting limits" card. Sits as a sibling card
 * to AccountSummary so the activity stats (joined / verified /
 * lifetime numbers) and the policy values read as two separate
 * concerns instead of a single wide block — operator-requested
 * layout from the dev-feedback pass.
 *
 * Values mirror MAX_BET_CENTS / MAX_ROUND_STAKE_CENTS /
 * DAILY_CAP_CENTS in @liverush/lib (single source of truth shared
 * with get_betting_constants() + place_bet). Future tiers swap the
 * TIERS map entry; the component stays.
 */
function TierLimits() {
  const tier = TIERS[getViewerTier()];
  // Pre-compute the XP progress percent. Math.min keeps the bar at
  // 100% even if a future XP overshoots the threshold while we wait
  // for the tier-promote job to run. Clamping to 100 also stops a
  // bad value from rendering a bar wider than its container.
  const xpPercent = Math.min(
    100,
    Math.round((tier.xpCurrent / tier.xpNextThreshold) * 100),
  );
  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm">
      {/* Hero header — vertical brand gradient (purple → deep blue)
          per the design spec. Badge artwork on the left, "Current
          tier" + tier label + reward teaser in the middle. The XP
          progress bar sits in the third column on desktop (`lg:`+)
          alongside the text, and falls back to a full-width row
          below the badge/text on mobile so the badge can keep its
          generous size and the text column doesn't collapse. */}
      <div className="relative bg-gradient-to-b from-[#6525FF] to-[#0124C7] px-6 py-6 text-white">
        <div className="flex items-center gap-4 sm:gap-5">
          <img
            src={tier.badgeUrl}
            alt={`${tier.label} badge`}
            // Lock HEIGHT only, `w-auto` so the artwork's natural
            // aspect ratio is mostly preserved (the badge is portrait
            // — medallion on top with a ribbon hanging below). A
            // light `scale-y-95` deliberately squeezes 5% vertically
            // per design feedback — the ribbon reads too tall at the
            // native ratio and the medallion needs to anchor closer
            // to the text column's baseline.
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

          {/* Desktop XP bar — sits to the right of the text column.
              `lg:w-44` (~176px) gives the bar room to read as a
              progress indicator without elbowing the title.
              `flex-shrink-0` keeps it from collapsing when the text
              column is wide. Hidden below `lg`; the mobile copy
              below the row picks it up. */}
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

        {/* Mobile XP bar — full-width row below the badge/text. The
            duplicated JSX is acceptable because Tailwind `hidden` /
            `lg:hidden` collapses each variant to display:none on the
            opposite breakpoint, so only one copy is in the
            accessibility tree at any time. */}
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

      {/* Limit list — neutral card surface so the gradient hero
          stays the visual centerpiece. Header matches the
          `Profile photo` / `Display name` / `Account` cards below
          for visual consistency. */}
      <div className="p-6">
        <h2 className="font-heading text-base font-semibold">
          {tier.label} betting limits
        </h2>
        <ul className="mt-3 space-y-1">
          <LimitRow
            icon={Target}
            label="Max per outcome"
            cents={tier.maxBetCents}
          />
          <LimitRow
            icon={Flag}
            label="Max per event (or round, multi-round)"
            cents={tier.maxRoundStakeCents}
          />
          <LimitRow
            icon={CalendarDays}
            label="Max per day"
            cents={tier.dailyCapCents}
          />
        </ul>
      </div>
    </section>
  );
}

/**
 * One row inside the AccountSummary stat grids. Either renders a
 * plain text value (`value`) or a coin amount (`coinValue` —
 * passed in cents). Keeps the visual rhythm consistent across the
 * three stat blocks.
 */
function SummaryRow({
  icon: Icon,
  label,
  value,
  coinValue,
  valueClassName,
}: {
  icon?: typeof Trophy;
  label: string;
  value?: string;
  coinValue?: number;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {Icon ? (
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
      ) : (
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <CoinIcon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </dt>
        <dd
          className={cn(
            "mt-0.5 font-heading text-sm font-bold tabular-nums text-foreground",
            valueClassName,
          )}
        >
          {/* For coin-value rows we render the bare formatted
              number (no inline coin glyph). The circular CoinIcon
              avatar on the left of the row already carries the
              "this is coins" signal — using <CoinAmount> here would
              paint a second, smaller coin glyph immediately before
              the digits, which read as a duplicate icon next to
              the avatar. */}
          {coinValue !== undefined
            ? (coinValue / 100).toFixed(2)
            : value}
        </dd>
      </div>
    </div>
  );
}

/**
 * Tier 1/2/3 dots a viewer sees below the XP progress bar. The
 * three visible dots represent the next steps in the progression
 * ladder, with the track behind them fading to transparent on the
 * right so the viewer reads "there are more tiers past what's
 * shown here" without us having to enumerate every future tier
 * label. Today we just hardcode three slots — when the real tier
 * system ships, this becomes data-driven from the TIERS map.
 */
const TIER_TIMELINE = [
  { id: 1, label: "Tier 1" },
  { id: 2, label: "Tier 2" },
  { id: 3, label: "Tier 3" },
];

function TierTimeline({ currentTierId }: { currentTierId: number }) {
  return (
    // mt-4 puts a clearer breathing gap between the XP bar and the
    // timeline (the previous pt-1 read as crowded). The relative
    // positioning anchors the absolutely-positioned track line below.
    <div className="relative mt-4">
      {/* Horizontal track. The dots cluster in the first 70% of the
          row; the gradient stays solid (white at 28% opacity) over
          that span and then fades to transparent over the right 30%
          to hint at unseen future tiers. `top-1/2 -translate-y-1/2`
          centers the 1px line on the vertical midpoint of the dot
          row (the dot row is the only thing in this absolute layer's
          coordinate space — the labels live in a sibling block
          below). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-3 h-px -translate-y-1/2"
        style={{
          background:
            "linear-gradient(to right, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.28) 70%, transparent 100%)",
        }}
      />

      {/* Dot strip — three dots `justify-between` across 70% of the
          row, so Tier 1 sits at the left edge, Tier 3 at 70% and
          Tier 2 evenly between, leaving the right 30% to the
          fading track. Each dot uses an opaque background so the
          track line is hidden where they sit, rather than bleeding
          through the centre. */}
      <div
        className="relative flex justify-between"
        style={{ width: "70%" }}
      >
        {TIER_TIMELINE.map((t) => {
          const isActive = t.id === currentTierId;
          return (
            <div
              key={t.id}
              className="flex flex-col items-center"
            >
              {/* Active dot styling went through three previous
                  iterations — `bg-[#FFDD49]` Tailwind class, inline
                  `style={backgroundColor: ...}`, and `bg-accent`
                  design-token class — none of which painted yellow
                  on the mobile bundle (the desktop bundle was fine).
                  Best guess: a stray rule somewhere in a base layer
                  is overriding the background with higher
                  specificity. The bulletproof escape hatch is to
                  set the rule via the DOM `style.setProperty(...,
                  "important")` API in a ref callback — that flag
                  beats any CSS-side specificity. Inactive dots use
                  the brand notification-badge blue #2A1FCF
                  (already in ProfileLayout / DesktopTopNav) so they
                  sit comfortably against the header's purple →
                  deep-blue gradient instead of looking near-black
                  like the previous #0E1849. <div> (not <span>)
                  sidesteps any inline-element rendering quirks on
                  iOS Safari. */}
              {/* Active dot: brand-accent yellow with an outer glow.
                  Inactive dot: brand notification-badge blue
                  (#2A1FCF, also used by ProfileLayout / DesktopTopNav)
                  with a thin white-ish border so it reads against
                  the header's purple → deep-blue gradient.
                  Backgrounds use inline style purely so the values
                  can't be lost to a JIT pass on arbitrary-value
                  Tailwind classes. <div> (not <span>) for clean
                  block-level rendering across mobile browsers. */}
              <div
                style={
                  isActive
                    ? {
                        backgroundColor: "#FFDD49",
                        color: "#1B1F4E",
                        boxShadow:
                          "0 0 10px rgba(255,221,73,0.55)",
                      }
                    : {
                        backgroundColor: "#2A1FCF",
                        border: "1px solid rgba(255,255,255,0.35)",
                        color: "rgba(255,255,255,0.7)",
                      }
                }
                // h-6 w-6 = 24px. The track line uses top-3 +
                // -translate-y-1/2, which lands exactly on the
                // dot's vertical centre.
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
 * "320 / 1000 XP" counter on top of an accent-gradient progress
 * bar, then a TIER 1/2/3 progression timeline beneath it. Lives
 * inside the TierLimits hero header — used twice (once for desktop
 * placement to the right of the text column, once for mobile
 * placement on its own row below the badge/text), so the markup is
 * factored out to avoid drift between the two surfaces.
 *
 * The accent gradient (#FFDD49 → #FFBE3B) is the same one
 * BrushButton's "accent" variant uses, so the brand-yellow signals
 * the same "earn / progress" affordance the Place-bet CTA does.
 */
function XpProgress({
  current,
  threshold,
  percent,
  tierLabel,
  currentTierId,
}: {
  current: number;
  threshold: number;
  percent: number;
  tierLabel: string;
  currentTierId: number;
}) {
  return (
    <>
      <p className="text-sm font-semibold tabular-nums text-white">
        {current} / {threshold} <span className="text-white/70">XP</span>
      </p>
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
      <TierTimeline currentTierId={currentTierId} />
    </>
  );
}

/** Row in the Tier-limits block — icon + label on the left, coin
 *  amount with glyph on the right. Icons get a primary-tinted
 *  background to match the visual language of SummaryRow's avatar
 *  circles. */
function LimitRow({
  icon: Icon,
  label,
  cents,
}: {
  icon: typeof Target;
  label: string;
  cents: number;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <span className="flex min-w-0 items-center gap-2.5 text-sm text-muted-foreground">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="inline-flex flex-shrink-0 items-center gap-1 font-heading font-bold tabular-nums text-foreground">
        <CoinAmount cents={cents} fractionDigits={0} />
      </span>
    </li>
  );
}

/**
 * Inline toggle for `profiles.notifications_enabled` — controls
 * whether the user receives transactional event emails (Resend).
 * In-app notifications on /notifications are always delivered for
 * registered users; this is email-only opt-out, by product decision.
 *
 * The toggle reads its current state from the auth-context profile
 * and writes via the `set_notifications_enabled` RPC. We also honor
 * the URL hint `?notifications=off` — emails put that on their
 * unsubscribe link so clicking through from an inbox drops the
 * viewer right onto this row with the toggle already flipped.
 */
function NotificationsToggle() {
  const { profile, refreshProfile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [enabled, setEnabled] = useState(
    profile?.notifications_enabled ?? true,
  );
  const [saving, setSaving] = useState(false);

  // Sync state when the profile loads / changes.
  useEffect(() => {
    if (profile) setEnabled(profile.notifications_enabled !== false);
  }, [profile]);

  // Honor ?notifications=off deep link from email unsubscribe.
  useEffect(() => {
    if (searchParams.get("notifications") !== "off") return;
    if (!profile || profile.notifications_enabled === false) return;
    void (async () => {
      setSaving(true);
      try {
        const { error } = await supabase.rpc("set_notifications_enabled", {
          p_enabled: false,
        });
        if (error) throw error;
        await refreshProfile();
        setEnabled(false);
        toast.success("Email notifications turned off.");
      } catch (err) {
        console.warn("Auto-unsubscribe failed:", err);
      } finally {
        setSaving(false);
        const next = new URLSearchParams(searchParams);
        next.delete("notifications");
        setSearchParams(next, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const toggle = async () => {
    const next = !enabled;
    setSaving(true);
    setEnabled(next); // optimistic
    try {
      const { error } = await supabase.rpc("set_notifications_enabled", {
        p_enabled: next,
      });
      if (error) throw error;
      await refreshProfile();
      toast.success(
        next ? "Email notifications turned on." : "Email notifications turned off.",
      );
    } catch (err) {
      setEnabled(!next); // revert
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't update notifications";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          Event updates
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          When subscribed events go live or creators you follow schedule new ones.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle email notifications"
        onClick={toggle}
        disabled={saving}
        className={cn(
          "relative h-7 w-12 flex-shrink-0 rounded-full transition-colors disabled:opacity-50",
          enabled ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
            enabled ? "left-6" : "left-1",
          )}
        />
      </button>
    </div>
  );
}

/**
 * Per-category toggle for payout/refund/settlement emails. Sibling
 * of NotificationsToggle and visually nested under it — disabled +
 * muted when the global toggle is off, since the global flag is the
 * master gate. Writes via the `set_payouts_notifications_enabled` RPC.
 */
function PayoutsNotificationsToggle() {
  const { profile, refreshProfile } = useAuth();
  const globalEnabled = profile?.notifications_enabled !== false;
  const [enabled, setEnabled] = useState(
    profile?.notifications_enabled_payouts ?? true,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile)
      setEnabled(profile.notifications_enabled_payouts !== false);
  }, [profile]);

  const toggle = async () => {
    if (!globalEnabled) return; // gated by master
    const next = !enabled;
    setSaving(true);
    setEnabled(next); // optimistic
    try {
      const { error } = await supabase.rpc(
        "set_payouts_notifications_enabled",
        { p_enabled: next },
      );
      if (error) throw error;
      await refreshProfile();
      toast.success(
        next
          ? "Payout & refund emails turned on."
          : "Payout & refund emails turned off.",
      );
    } catch (err) {
      setEnabled(!next); // revert
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't update payout notifications";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const effective = globalEnabled && enabled;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl bg-muted/50 p-3",
        !globalEnabled && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          Payouts & refunds
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          When a bet wins, gets refunded, or a payout is on hold.
          {!globalEnabled && " Turn event updates on first."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={effective}
        aria-label="Toggle payout and refund emails"
        onClick={toggle}
        disabled={saving || !globalEnabled}
        className={cn(
          "relative h-7 w-12 flex-shrink-0 rounded-full transition-colors disabled:cursor-not-allowed",
          effective ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
            effective ? "left-6" : "left-1",
          )}
        />
      </button>
    </div>
  );
}

/**
 * Brand-coloured Google "G" mark. Lucide deliberately ships no
 * brand icons, so we inline the official multi-tone SVG. Sized
 * via `h-* w-*` from the parent like a Lucide icon.
 */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      aria-hidden
      focusable="false"
    >
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
