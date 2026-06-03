import { supabase } from "@/integrations/supabase/client";

/**
 * Result shape returned by the post-rebuild `top_up_balance` RPC.
 *
 * Migration `20260604_000001_ledger_rebuild.sql` changed the RPC
 * signature from `(p_amount_cents)` to `(p_coins, p_cash_cents)` so the
 * ledger now records both the coin credit on the user side and the
 * dollar inflow on the platform_cash side. The toast surfaces the
 * coin count, but we keep all four numbers in the response in case
 * future UI wants the cash + ID for receipts.
 */
export interface TopUpResult {
  topup_id: string;
  coins_added: number;
  amount_cents: number;
  cash_cents: number;
  new_balance_cents: number;
}

/** Sanity ceiling matches the RPC's $10,000 / 100,000-coin cap. */
export const TOP_UP_MAX_CASH_CENTS = 1_000_000;
export const TOP_UP_MAX_COINS = 100_000;

/**
 * Credit the signed-in user with `coins` and record `cashCents` as the
 * dollar amount they "paid". Mock-Stripe checkout — no real card is
 * charged; the cash side just lands on the platform_cash ledger
 * account so the admin Wallet treasury reflects pretend revenue.
 */
export async function topUpBalance(
  coins: number,
  cashCents: number,
): Promise<TopUpResult> {
  const { data, error } = await supabase.rpc("top_up_balance", {
    p_coins: coins,
    p_cash_cents: cashCents,
  });
  if (error) throw error;
  return data as unknown as TopUpResult;
}
