/**
 * Mock USDT holdings — paired 1:1 with USD for display since USDT is dollar-
 * pegged. Real on-chain wallets / payments arrive in a later phase. Until
 * then, this constant powers every total-balance display in the app so the
 * sidebar, top bar, profile, my-bets, and balance page all stay in sync.
 *
 * Note: bet placement validation (`stake <= balance_cents`) still uses the
 * USD portion only, since the `place_bet` RPC deducts from `balance_cents`.
 */
export const MOCK_USDT_CENTS = 12500;

export function totalBalanceCents(
  usdCents: number | null | undefined,
): number {
  return (usdCents ?? 0) + MOCK_USDT_CENTS;
}
