import {
  AlertCircle,
  Ban,
  Bell,
  CalendarClock,
  Coins,
  Heart,
  PhoneOff,
  RotateCcw,
  Radio,
  Star,
  Trophy,
  Wallet,
  XCircle,
} from "lucide-react";

import type { NotificationType } from "@/services/notificationsService";

/**
 * Toast type domain — `NotificationType` (sourced from the DB enum
 * via generated types) PLUS purely client-side toast keys that have
 * no backing row in `public.notifications`. The toast layer accepts
 * either; the DB realtime channel only ever produces NotificationType.
 *
 * Add a new client-only key here when an interactive UX path needs
 * the same custom-card chrome as DB-driven toasts but doesn't
 * justify a DB enum migration (e.g. transient validation errors).
 */
export type ToastType = NotificationType | "bet_limit";

/**
 * Single source of truth for the icon + colour styling of every
 * notification type. Consumed by:
 *   • The Notifications page (apps/user-app/src/pages/user/Notifications.tsx)
 *     — renders the persistent feed.
 *   • The toast layer
 *     (apps/user-app/src/components/notifications/NotificationToastCard.tsx)
 *     — renders the popup card.
 *
 * Both surfaces stay visually in sync by reading the same map.
 *
 * `iconClassName` tints the avatar circle background + icon colour.
 * Pick tokens that exist in design-tokens (success / destructive /
 * primary / muted / pink-500) — random hex values would diverge from
 * the rest of the app.
 *
 * `iconFilled` makes the Lucide icon a solid silhouette
 * (`fill-current` on the SVG) instead of the default outline. Used
 * for the welcome / round_starting cards where the design calls for
 * a filled-star look rather than the thin-stroke AI-style icons.
 */
export interface NotificationTypeMeta {
  icon: typeof Bell;
  iconClassName: string;
  iconFilled?: boolean;
}

export const TYPE_META: Record<ToastType, NotificationTypeMeta> = {
  welcome: {
    icon: Star,
    iconClassName: "bg-primary/10 text-primary",
    iconFilled: true,
  },
  // bet_placed is new in 20260609_000001 — tinted accent yellow so a
  // viewer immediately recognises the "you just bet" beat without
  // confusing it with a win (which uses green/success).
  bet_placed: { icon: Coins, iconClassName: "bg-accent/20 text-accent" },
  bet_won: { icon: Trophy, iconClassName: "bg-success/15 text-success" },
  bet_lost: { icon: XCircle, iconClassName: "bg-destructive/15 text-destructive" },
  bet_refunded: {
    icon: RotateCcw,
    iconClassName: "bg-muted text-muted-foreground",
  },
  event_starting: { icon: Radio, iconClassName: "bg-primary/10 text-primary" },
  // 20260610_000004_event_reschedule_notifications.sql — inserted by
  // the notify-event-rescheduled edge function for every subscriber +
  // follower when a creator edits scheduled_at on an already-
  // announced event. CalendarClock icon + primary tint (not destructive
  // — a reschedule is informational, not an error). Tap on the toast
  // navigates to the event page so the viewer can see the new time
  // alongside everything else.
  event_rescheduled: {
    icon: CalendarClock,
    iconClassName: "bg-primary/10 text-primary",
  },
  // Ephemeral — only fires as a toast. The notifications page
  // filters this type out so a "Stream ended" line doesn't crowd
  // the persistent feed (bet_won / bet_lost / bet_refunded already
  // carry the win/loss info that matters).
  event_finished: {
    icon: PhoneOff,
    iconClassName: "bg-muted text-muted-foreground",
  },
  round_starting: {
    icon: Star,
    iconClassName: "bg-primary/10 text-primary",
    iconFilled: true,
  },
  new_follower: { icon: Heart, iconClassName: "bg-pink-500/15 text-pink-600" },
  top_up: { icon: Wallet, iconClassName: "bg-success/15 text-success" },
  rake_credited: { icon: Coins, iconClassName: "bg-success/15 text-success" },
  payout_rejected: {
    icon: Ban,
    iconClassName: "bg-destructive/15 text-destructive",
  },
  // Client-only — fires from EventDetails when place_bet rejects on
  // a stake-limit guard (per-outcome cap, per-round cap, daily cap,
  // already-bet-this-outcome, insufficient balance, window closed).
  // Routed via pushLocalToast so it adopts the standard custom-card
  // chrome (avatar circle + title + body + X close) instead of
  // Sonner's red bare-bones error toast that the raw server message
  // used to land in. Destructive tint matches the "you can't do
  // this" connotation.
  bet_limit: {
    icon: AlertCircle,
    iconClassName: "bg-destructive/15 text-destructive",
  },
};

/**
 * Defensive fallback so an unknown notification type (e.g. a new
 * DB-side type the client hasn't shipped support for yet) renders
 * as a neutral bell instead of crashing the consumer with
 * `Cannot read properties of undefined (reading 'icon')`.
 */
export const DEFAULT_META: NotificationTypeMeta = {
  icon: Bell,
  iconClassName: "bg-muted text-muted-foreground",
};

/**
 * Types that should NOT render in the persistent Notifications page
 * list. The DB rows still exist (so the toast layer fires once via
 * Realtime, and the unread-count badge can include them), but the
 * page surface stays focused on persistent outcomes — bet placed,
 * won, lost, refunded, plus the lifecycle types (welcome / new
 * follower / top_up).
 *
 * Ephemeral types are by definition "things that happened in the
 * stream" — the streamer went live, the next round opened, the
 * stream ended. Once the moment passes, having a row in the feed
 * adds noise without value.
 */
export const PAGE_HIDDEN_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "event_starting",
  "event_finished",
  "round_starting",
]);

/**
 * Streamer-only types — surfaced on the studio Profile page, never
 * on the user-app feed. A creator who also bets on other people's
 * events still shouldn't see "rake credited 5.00" rows mixed in
 * with their personal bet history on the viewer side.
 */
export const STREAMER_ONLY_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "rake_credited",
]);

// =========================================================================
// renderWithCoins — inline-coin formatting for notification bodies.
// =========================================================================
//
// Notification bodies generated by SQL triggers (bet_placed body
// `"You bet 5.00 on \"X\""`), SQL functions (welcome, top_up via
// 20260514 migration), and the notify-payout edge function ("27.00
// credited from ...") carry money values formatted as either `$X` or
// bare `X.XX`. We turn every match into a coin glyph + bare digit
// span so the reader sees coins, not dollar signs.
//
// Regex matches:
//   `$<number>`               — strips the dollar sign, replaces with coin
//   `<number>.<dd>` (bare)    — requires two-digit decimal + word
//                               boundary so we don't accidentally
//                               match things like "Round 2" or year
//                               numbers.

// Re-exported here so toast + page share one implementation. The
// raw helper lives in CoinAmount.tsx — we keep that import here
// rather than duplicating the regex.

export { renderWithCoins } from "./renderWithCoins";
