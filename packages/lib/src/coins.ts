/**
 * Coin economy constants + conversion helpers.
 *
 * Two units to keep track of:
 *
 *   1. `balance_cents` — the integer stored on `profiles.balance_cents`
 *      and `ledger_entries.amount_cents`. 1 coin = 100 balance_cents.
 *      That mapping has been the case since the betting MVP migration
 *      (`20260529_000001_betting_mvp.sql`).
 *
 *   2. `dollar_cents` — the dollar-cent side of a top-up or payout,
 *      stored on `ledger_entries.amount_cash_cents` and
 *      `coin_packs.price_dollar_cents`. 1 coin = 10 dollar cents
 *      ($0.10) at the locked storefront / cashout rate.
 *
 * Currency is shown as generic `$` in the UI — the actual currency
 * code (USD vs AUD vs anything else) is deferred. Don't bake a country
 * label into copy that touches these helpers.
 */

/** 1 coin = 100 balance_cents internally. */
export const COIN_TO_BALANCE_CENTS = 100;

/** 1 coin = $0.10 = 10 dollar cents. 100 coins = $10. */
export const COIN_TO_DOLLAR_CENTS = 10;

/** Minimum payout request: 1,000 coins = $100. */
export const MIN_PAYOUT_COINS = 1000;

/** Coin count → dollar cents at the locked rate. */
export const coinsToDollarCents = (coins: number): number =>
  coins * COIN_TO_DOLLAR_CENTS;

/** Dollar cents → coin count at the locked rate (truncates fractions). */
export const dollarCentsToCoins = (cents: number): number =>
  Math.floor(cents / COIN_TO_DOLLAR_CENTS);

/** `profiles.balance_cents` → display coin count. */
export const balanceCentsToCoins = (balanceCents: number): number =>
  balanceCents / COIN_TO_BALANCE_CENTS;

/** `profiles.balance_cents` → equivalent dollar cents at the rate. */
export const balanceCentsToDollarCents = (balanceCents: number): number =>
  balanceCentsToCoins(balanceCents) * COIN_TO_DOLLAR_CENTS;

/**
 * Format dollar cents as `$X.XX`. Locale-stable: always en-US two
 * decimals. Negative inputs render with a leading minus.
 */
export function formatDollarCents(
  cents: number | null | undefined,
): string {
  if (cents == null || Number.isNaN(cents)) return "$0.00";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}
