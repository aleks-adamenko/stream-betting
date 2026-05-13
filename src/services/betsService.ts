import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type BetRow = Database["public"]["Tables"]["bets"]["Row"];

export interface BetWithContext extends BetRow {
  event: {
    id: string;
    title: string;
    cover_url: string | null;
    status: "scheduled" | "live" | "finished";
    category: string;
  } | null;
  outcome: {
    id: string;
    label: string;
  } | null;
}

export interface PlaceBetResult {
  bet_id: string;
  new_balance_cents: number;
  odds: number;
}

export async function placeBet(
  eventId: string,
  outcomeId: string,
  amountCents: number,
): Promise<PlaceBetResult> {
  const { data, error } = await supabase.rpc("place_bet", {
    p_event_id: eventId,
    p_outcome_id: outcomeId,
    p_amount_cents: amountCents,
  });
  if (error) throw error;
  return data as unknown as PlaceBetResult;
}

export async function listMyBets(): Promise<BetWithContext[]> {
  const { data, error } = await supabase
    .from("bets")
    .select(
      `
      id, user_id, event_id, outcome_id, amount_cents, odds_decimal,
      status, payout_cents, placed_at, settled_at,
      event:events!bets_event_id_fkey ( id, title, cover_url, status, category ),
      outcome:event_outcomes!bets_outcome_id_fkey ( id, label )
    `,
    )
    .order("placed_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as BetWithContext[];
}
