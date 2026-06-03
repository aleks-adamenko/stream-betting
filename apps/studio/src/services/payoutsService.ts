import { supabase } from "@/integrations/supabase/client";

/**
 * Streamer-side cashout RPC wrapper.
 *
 * Calls `request_payout(p_coins)` — added by migration
 * `20260604_000001_ledger_rebuild.sql`. The RPC:
 *
 *   • atomically debits the streamer's profile balance
 *   • inserts a `payouts` row (type=rake_streamer, event_id=null, status=pending)
 *   • writes a `payout_request` ledger row on `user:<uid>` with the
 *     negative coin amount + negative dollar cents
 *
 * Throws on insufficient balance, below-minimum threshold (1,000
 * coins), or auth failure — surface the message via toast.
 */

export interface RequestPayoutResult {
  payout_id: string;
  coins: number;
  cash_cents: number;
  new_balance_cents: number;
}

export async function requestPayout(
  coins: number,
): Promise<RequestPayoutResult> {
  const { data, error } = await supabase.rpc("request_payout", {
    p_coins: coins,
  });
  if (error) throw error;
  return data as unknown as RequestPayoutResult;
}
