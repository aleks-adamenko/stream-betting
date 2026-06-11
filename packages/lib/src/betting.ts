/**
 * Pari-mutuel betting constants + pure helpers.
 *
 * Mirrors the SQL-side `get_betting_constants()` immutable function in
 * `apps/user-app/supabase/migrations/20260529_000001_betting_mvp.sql`.
 * Keep the two in sync — the SQL function is the source of truth for
 * server-enforced limits, and these constants are the source of truth
 * for client-side previews + form validation.
 *
 * All amounts are virtual currency (cents) for now. When real money
 * lands the only swap is the credit-balance branch in
 * `approve_payout`; these constants stay.
 *
 * As of the admin-editable betting-parameters feature these constants
 * are the LOAD / FALLBACK defaults: the live values come from the
 * `betting_config` table via `get_betting_constants()` (global) or the
 * per-event snapshot via `get_event_constants()`, surfaced to the client
 * through `useBettingConfig()` / `useEventConstants()`. The shared shape
 * those hooks resolve to is `BettingConfig` (below), and
 * `DEFAULT_BETTING_CONFIG` is the fallback assembled from these
 * constants — so an offline / first-paint render still shows sane
 * numbers.
 */

import { MIN_PAYOUT_COINS } from "./coins";

// ---- Stake limits --------------------------------------------------------
export const MIN_BET_CENTS = 100; // $1 — per-bet floor
// Per-OUTCOME ceiling: a single bet on a single outcome can't exceed
// $10. A viewer covering N outcomes can still spread up to N × $10
// of intent across them, gated by MAX_ROUND_STAKE_CENTS below.
export const MAX_BET_CENTS = 1_000; // $10 — per-outcome ceiling
// Aggregate per-round ceiling: sum of the user's bets across all
// outcomes in a single round (= single-round event in the
// single-round case). $30 allows full coverage at $7.50/outcome on a
// 4-outcome event, or any 3-outcome split at $10 each. Each new
// round resets the cap. Enforced inside place_bet alongside the
// per-bet MAX_BET check.
export const MAX_ROUND_STAKE_CENTS = 3_000; // $30 — aggregate per round

// ---- Odds + rake --------------------------------------------------------
/** Hard cap on the effective payout multiple per winner. */
export const MAX_ODDS_CAP = 15.0;
/** Total platform rake, in basis points. 1000 = 10%. */
export const RAKE_BPS = 1000;
/** Platform half of the rake (5% of total pool). */
export const RAKE_PLATFORM_BPS = 500;
/** Streamer half of the rake (5% of total pool). */
export const RAKE_STREAMER_BPS = 500;

// ---- Cancellation guards ------------------------------------------------
/** Minimum unique bettors before settle_event will create payouts. */
export const MIN_UNIQUE_BETTORS = 2;
/** Minimum distinct outcomes that received at least one bet. */
export const MIN_OUTCOMES_WITH_BETS = 2;

// ---- MIN_POOL (spec 4.2-4.3) -------------------------------------------
/**
 * MIN_POOL = max(MAX_BET × multiplier, num_outcomes × MIN_BET, floor)
 *
 * Without this, a single $10 bettor can settle a 2-outcome event and
 * walk away with $9 — losing $1 to the 10% rake on a one-bet pool. The
 * spec's MIN_POOL guard makes those events auto-cancel + refund instead.
 *
 * Effective minimum is $20: MAX_BET($10) × 2 = $20 is the binding term
 * (it dominates num_outcomes × MIN_BET and ties the floor).
 */
export const MIN_POOL_MAX_BET_MULTIPLIER = 2;
export const MIN_POOL_FLOOR_CENTS = 2000; // $20

/** Per-spec MIN_POOL for the given event shape. */
export function minPoolCents(numOutcomes: number): number {
  return Math.max(
    MAX_BET_CENTS * MIN_POOL_MAX_BET_MULTIPLIER,
    numOutcomes * MIN_BET_CENTS,
    MIN_POOL_FLOOR_CENTS,
  );
}

// ---- Stale-streamer auto-cancel (spec 12.6) -----------------------------
/**
 * Grace window after `betting_closes_at` before a live event with no
 * declared winner gets auto-cancelled by the close-betting-windows
 * cron. Server-side value lives in `get_betting_constants()`.
 */
export const STALE_RESULT_GRACE_MINUTES = 15;

// ---- Betting window ----------------------------------------------------
// Window length is stored in SECONDS (events.betting_window_seconds).
// Mirrors get_betting_constants().betting_window_{min,max}_sec.
export const BETTING_WINDOW_MIN_SEC = 10; // 10s floor
export const BETTING_WINDOW_MAX_SEC = 1800; // 30 min ceiling
export const BETTING_WINDOW_DEFAULT_SEC = 60; // 1 min default

// ---- KYC stub ----------------------------------------------------------
/** Per-user daily bet sum cap (cents). Enforced by place_bet. */
export const DAILY_CAP_CENTS = 10_000; // $100/day

// ========================================================================
// Live config shape (admin-editable parameters)
// ========================================================================

/**
 * camelCase mirror of the server `betting_config` row / the
 * `get_betting_constants()` + `get_event_constants()` Returns shape.
 * One field per admin-editable parameter. The `use*` hooks map the
 * snake_case RPC payload onto this and fall back to
 * `DEFAULT_BETTING_CONFIG` while loading / on error.
 */
export interface BettingConfig {
  // Stake limits
  minBetCents: number;
  maxBetCents: number;
  maxRoundStakeCents: number;
  // Minimums
  minUniqueBettors: number;
  minOutcomesWithBets: number;
  minPoolMaxBetMultiplier: number;
  minPoolFloorCents: number;
  // Odds & rake
  maxOddsCap: number;
  rakeBps: number;
  rakePlatformBps: number;
  rakeStreamerBps: number;
  // Betting window (seconds)
  bettingWindowMinSec: number;
  bettingWindowMaxSec: number;
  bettingWindowDefaultSec: number;
  // Daily / payout
  dailyCapCents: number;
  minPayoutCoins: number;
  staleResultGraceMinutes: number;
}

/**
 * Fallback config assembled from the constants above. No new values —
 * this is exactly today's hardcoded set, used as the load default until
 * the live `betting_config` row arrives from the server.
 */
export const DEFAULT_BETTING_CONFIG: BettingConfig = {
  minBetCents: MIN_BET_CENTS,
  maxBetCents: MAX_BET_CENTS,
  maxRoundStakeCents: MAX_ROUND_STAKE_CENTS,
  minUniqueBettors: MIN_UNIQUE_BETTORS,
  minOutcomesWithBets: MIN_OUTCOMES_WITH_BETS,
  minPoolMaxBetMultiplier: MIN_POOL_MAX_BET_MULTIPLIER,
  minPoolFloorCents: MIN_POOL_FLOOR_CENTS,
  maxOddsCap: MAX_ODDS_CAP,
  rakeBps: RAKE_BPS,
  rakePlatformBps: RAKE_PLATFORM_BPS,
  rakeStreamerBps: RAKE_STREAMER_BPS,
  bettingWindowMinSec: BETTING_WINDOW_MIN_SEC,
  bettingWindowMaxSec: BETTING_WINDOW_MAX_SEC,
  bettingWindowDefaultSec: BETTING_WINDOW_DEFAULT_SEC,
  dailyCapCents: DAILY_CAP_CENTS,
  minPayoutCoins: MIN_PAYOUT_COINS,
  staleResultGraceMinutes: STALE_RESULT_GRACE_MINUTES,
};

/**
 * snake_case RPC payload from `get_betting_constants()` /
 * `get_event_constants()` / the `betting_config` row. All optional so a
 * partial / stale row still maps cleanly (missing fields fall back to
 * the matching `DEFAULT_BETTING_CONFIG` value).
 */
export interface BettingConfigRow {
  min_bet_cents?: number | string | null;
  max_bet_cents?: number | string | null;
  max_round_stake_cents?: number | string | null;
  min_unique_bettors?: number | string | null;
  min_outcomes_with_bets?: number | string | null;
  min_pool_max_bet_multiplier?: number | string | null;
  min_pool_floor_cents?: number | string | null;
  max_odds_cap?: number | string | null;
  rake_bps?: number | string | null;
  rake_platform_bps?: number | string | null;
  rake_streamer_bps?: number | string | null;
  betting_window_min_sec?: number | string | null;
  betting_window_max_sec?: number | string | null;
  betting_window_default_sec?: number | string | null;
  daily_cap_cents?: number | string | null;
  min_payout_coins?: number | string | null;
  stale_result_grace_minutes?: number | string | null;
}

/**
 * Map a snake_case RPC row → camelCase `BettingConfig`, coercing
 * pg numeric/text values to numbers and falling back to
 * `DEFAULT_BETTING_CONFIG` for any missing field. Shared by the
 * client hooks (user-app + studio) and the admin service.
 */
export function bettingConfigFromRow(
  row: BettingConfigRow | null | undefined,
): BettingConfig {
  if (!row) return DEFAULT_BETTING_CONFIG;
  const n = (
    v: number | string | null | undefined,
    fallback: number,
  ): number => (v === null || v === undefined ? fallback : Number(v));
  const d = DEFAULT_BETTING_CONFIG;
  return {
    minBetCents: n(row.min_bet_cents, d.minBetCents),
    maxBetCents: n(row.max_bet_cents, d.maxBetCents),
    maxRoundStakeCents: n(row.max_round_stake_cents, d.maxRoundStakeCents),
    minUniqueBettors: n(row.min_unique_bettors, d.minUniqueBettors),
    minOutcomesWithBets: n(row.min_outcomes_with_bets, d.minOutcomesWithBets),
    minPoolMaxBetMultiplier: n(
      row.min_pool_max_bet_multiplier,
      d.minPoolMaxBetMultiplier,
    ),
    minPoolFloorCents: n(row.min_pool_floor_cents, d.minPoolFloorCents),
    maxOddsCap: n(row.max_odds_cap, d.maxOddsCap),
    rakeBps: n(row.rake_bps, d.rakeBps),
    rakePlatformBps: n(row.rake_platform_bps, d.rakePlatformBps),
    rakeStreamerBps: n(row.rake_streamer_bps, d.rakeStreamerBps),
    bettingWindowMinSec: n(row.betting_window_min_sec, d.bettingWindowMinSec),
    bettingWindowMaxSec: n(row.betting_window_max_sec, d.bettingWindowMaxSec),
    bettingWindowDefaultSec: n(
      row.betting_window_default_sec,
      d.bettingWindowDefaultSec,
    ),
    dailyCapCents: n(row.daily_cap_cents, d.dailyCapCents),
    minPayoutCoins: n(row.min_payout_coins, d.minPayoutCoins),
    staleResultGraceMinutes: n(
      row.stale_result_grace_minutes,
      d.staleResultGraceMinutes,
    ),
  };
}

/**
 * Per-event min-pool from a resolved `BettingConfig` (snapshot-aware
 * variant of `minPoolCents`). Same formula the server uses in
 * `settle_round` / `get_event_progress`.
 */
export function minPoolCentsFor(
  config: BettingConfig,
  numOutcomes: number,
): number {
  return Math.max(
    config.maxBetCents * config.minPoolMaxBetMultiplier,
    numOutcomes * config.minBetCents,
    config.minPoolFloorCents,
  );
}

// ========================================================================
// Pure helpers
// ========================================================================

/**
 * Same formula as compute_live_odds in SQL.
 *
 *   live_odds = (total_pool × (1 - rake) / outcome_pool)
 *
 * Returns null when the pool is empty (UI should show "—").
 */
export function liveOddsFor(
  outcomePoolCents: number,
  totalPoolCents: number,
  rakeBps: number = RAKE_BPS,
): number | null {
  if (!outcomePoolCents || !totalPoolCents) return null;
  const distributable = totalPoolCents * (10_000 - rakeBps);
  const odds = distributable / 10_000 / outcomePoolCents;
  return Math.round(odds * 100) / 100;
}

/**
 * Indicative payout preview for the bet panel. Uses the supplied live
 * odds — does NOT apply the MAX_ODDS_CAP, because the cap only matters
 * at settlement, and the bet panel caption says "Indicative — final
 * calculated at settlement" already.
 */
export function payoutPreview(
  stakeCents: number,
  liveOdds: number | null,
): number {
  if (!stakeCents || !liveOdds) return 0;
  return Math.floor(stakeCents * liveOdds);
}

/**
 * Single source of truth for "12345 cents" → "123.45". Negative
 * inputs render with a leading minus.
 *
 * No currency symbol — the platform's soft currency is rush-coins,
 * and the visual unit marker is the coin glyph rendered by
 * `<CoinAmount>` / `<CoinIcon>` from `@liverush/ui`. JSX surfaces
 * pair this string with the icon; pure-text surfaces (toast
 * messages, aria labels) emit the bare number and let surrounding
 * copy carry the unit.
 *
 * Locale-stable: always en-US, two decimal places.
 */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "0.00";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${(abs / 100).toFixed(2)}`;
}
