import { supabase } from "@/integrations/supabase/client";

export interface TopUpResult {
  new_balance_cents: number;
  amount_cents: number;
}

export const TOP_UP_MAX_CENTS = 1_000_000; // $10,000 — must match RPC cap
export const TOP_UP_MIN_CENTS = 100; // $1

export async function topUpBalance(amountCents: number): Promise<TopUpResult> {
  const { data, error } = await supabase.rpc("top_up_balance", {
    p_amount_cents: amountCents,
  });
  if (error) throw error;
  return data as unknown as TopUpResult;
}
