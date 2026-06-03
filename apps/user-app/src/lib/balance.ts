/**
 * Single source of truth for the displayed balance.
 *
 * The user-app surfaces one virtual rush-coin balance — there is no
 * separate USD / USDT split any more (the old Balance page that
 * fanned the total out into per-currency chips is gone). This
 * helper exists so every callsite (sidebar, top bar, profile,
 * my-bets) reads the value through the same null-safe getter,
 * which keeps the door open for adding a wallet/balance composition
 * here later without touching the consumers.
 *
 * Bet placement validation (`stake <= balance_cents`) keeps using
 * the same value — the `place_bet` RPC deducts from
 * `balance_cents`, so the number this helper returns is the same
 * number the RPC sees.
 */
export function totalBalanceCents(
  cents: number | null | undefined,
): number {
  return cents ?? 0;
}
