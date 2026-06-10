/**
 * Map a raw `place_bet` RPC error message to a friendly toast
 * payload that renders inside the standard NotificationToastCard
 * shell (`pushLocalToast({ type: "bet_limit", ... })`).
 *
 * Server-side messages come from
 *   apps/user-app/supabase/migrations/20260610_000003_max_round_stake.sql
 * and look like:
 *   • "min_bet: stake must be ≥ 100 cents"
 *   • "max_bet: stake must be ≤ 1000 cents (per outcome)"
 *   • "max_round_stake_exceeded: total stake this round would be 31.00, max is 30.00"
 *   • "daily_cap_exceeded: 200 cents over daily limit"
 *   • "already_bet_outcome: you have already bet on this outcome this round"
 *   • "insufficient_balance"
 *   • "window_closed: ..."
 *
 * For anything that smells like a limit we return a `{title, body}`
 * with copy that reads like the rest of the toast layer (one short
 * sentence each). For everything else we return null and let the
 * caller fall back to the generic Sonner error toast.
 *
 * Limit constants are imported from @liverush/lib so the friendly
 * dollar amounts ($1 / $10 / $30 / $100) stay in lockstep with the
 * server-side ceilings even if those constants change.
 */

import {
  DAILY_CAP_CENTS,
  MAX_BET_CENTS,
  MAX_ROUND_STAKE_CENTS,
  MIN_BET_CENTS,
} from "@liverush/lib";

export interface FriendlyBetError {
  title: string;
  body: string;
}

function dollars(cents: number): string {
  // No decimals when the value is a whole-dollar — matches the rest
  // of the user-facing limit copy ($10, $30, $100). For oddball
  // values fall through to `.toFixed(2)` so we don't lie about
  // precision.
  if (cents % 100 === 0) return `$${cents / 100}`;
  return `$${(cents / 100).toFixed(2)}`;
}

export function parseBetError(rawMessage: string): FriendlyBetError | null {
  const msg = rawMessage.trim();

  // --- Per-outcome ceiling ($10) ---------------------------------------
  if (msg.startsWith("max_bet:") || /^max_bet\b/i.test(msg)) {
    return {
      title: "Per-outcome limit reached",
      body: `You can stake up to ${dollars(MAX_BET_CENTS)} on a single outcome.`,
    };
  }

  // --- Min bet ($1) ----------------------------------------------------
  if (msg.startsWith("min_bet:") || /^min_bet\b/i.test(msg)) {
    return {
      title: "Stake too low",
      body: `Minimum bet is ${dollars(MIN_BET_CENTS)}.`,
    };
  }

  // --- Aggregate per-round cap ($30) -----------------------------------
  if (msg.includes("max_round_stake_exceeded")) {
    // Try to surface the actual would-be total from the server
    // message ("…total stake this round would be 31.00, max is 30.00").
    const match = msg.match(
      /would be\s+([\d.,]+)\s*,\s*max is\s+([\d.,]+)/i,
    );
    if (match) {
      return {
        title: "Round cap reached",
        body: `Total this round would be $${match[1]} — cap is $${match[2]}.`,
      };
    }
    return {
      title: "Round cap reached",
      body: `You can stake up to ${dollars(MAX_ROUND_STAKE_CENTS)} per round across all outcomes.`,
    };
  }

  // --- Daily cap ($100) -----------------------------------------------
  if (msg.includes("daily_cap_exceeded")) {
    return {
      title: "Daily limit reached",
      body: `You can stake up to ${dollars(DAILY_CAP_CENTS)} per day across all events.`,
    };
  }

  // --- Already bet on this outcome ------------------------------------
  if (msg.includes("already_bet_outcome") || msg.includes("already_bet")) {
    return {
      title: "Already bet this outcome",
      body: "You can still back other outcomes this round.",
    };
  }

  // --- Insufficient balance -------------------------------------------
  // Raw server token is `insufficient_balance`; the client-side
  // pre-flight in placeBetAt throws "Insufficient balance for N coins."
  if (
    msg === "insufficient_balance" ||
    msg.toLowerCase().includes("insufficient balance")
  ) {
    return {
      title: "Not enough coins",
      body: "Top up your balance to keep betting.",
    };
  }

  // --- Client-side stake-range guard ----------------------------------
  // placeBetAt throws "Stake must be between 1 and 10 coins." before
  // hitting the server. Friendly-ify it too.
  if (msg.toLowerCase().startsWith("stake must be between")) {
    return {
      title: "Stake out of range",
      body: `Pick a stake between ${dollars(MIN_BET_CENTS)} and ${dollars(MAX_BET_CENTS)}.`,
    };
  }

  // --- Window closed --------------------------------------------------
  if (msg.includes("window_closed")) {
    return {
      title: "Betting closed",
      body: "This round's betting window is no longer open.",
    };
  }

  // Anything else (Profile not found, Outcome not found, etc.) goes
  // through the generic Sonner red toast — those are catastrophic,
  // not user-fixable.
  return null;
}
