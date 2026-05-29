import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type BetRow = Database["public"]["Tables"]["bets"]["Row"];

/**
 * Bet status as exposed by the new pari-mutuel pipeline.
 *
 * Legacy "open" rows from the pre-MVP fixed-odds flow are still in the
 * table and map onto "placed" for UI purposes. The new RPC always
 * inserts with status="placed".
 */
export type BetStatus =
  | "open"
  | "placed"
  | "won_pending_payout"
  | "won"
  | "lost"
  | "refunded";

export interface BetWithContext extends BetRow {
  event: {
    id: string;
    title: string;
    cover_url: string | null;
    status:
      | "scheduled"
      | "live"
      | "pending_moderation"
      | "settled"
      | "finished"
      | "cancelled";
    category: string;
  } | null;
  outcome: {
    id: string;
    label: string;
  } | null;
  payout: {
    id: string;
    type: "winner" | "refund";
    amount_cents: number;
    status:
      | "pending"
      | "approved"
      | "completed"
      | "rejected"
      | "on_hold"
      | "failed";
    completed_at: string | null;
  } | null;
}

/**
 * Shape returned by the new `place_bet(text, text, integer, uuid)` RPC.
 * `idempotent_replay` is true when the call short-circuited via the
 * idempotency key — same bet id / balance, no new pool movement.
 */
export interface PlaceBetResult {
  bet_id: string;
  idempotent_replay: boolean;
  new_balance_cents: number;
  live_odds: number | null;
  total_pool_cents: number;
  outcome_pool_cents: number;
}

/**
 * Generates a UUID v4. Falls back to a non-crypto helper for old
 * browsers that lack `crypto.randomUUID`.
 */
function randomUUID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Last-resort RFC4122 v4 builder. Good enough for an idempotency
  // key that just needs to be unique within the user's session.
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
    const r = Math.random() * 16;
    const v = c === "8" ? (r & 0x3) | 0x8 : r;
    return Math.floor(v).toString(16);
  });
}

/**
 * Place a pari-mutuel bet. Generates a fresh idempotency_key per call
 * — re-firing the same call with the same key is a no-op on the
 * server and returns the original result. Callers can pass an explicit
 * key if they need replay-safe behavior across retries.
 */
export async function placeBet(
  eventId: string,
  outcomeId: string,
  amountCents: number,
  idempotencyKey?: string,
): Promise<PlaceBetResult> {
  const { data, error } = await supabase.rpc("place_bet", {
    p_event_id: eventId,
    p_outcome_id: outcomeId,
    p_amount_cents: amountCents,
    p_idempotency_key: idempotencyKey ?? randomUUID(),
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
      odds_snapshot, status, payout_cents, placed_at, settled_at,
      event:events!bets_event_id_fkey ( id, title, cover_url, status, category ),
      outcome:event_outcomes!bets_outcome_id_fkey ( id, label ),
      payout:payouts!payouts_bet_id_fkey ( id, type, amount_cents, status, completed_at )
    `,
    )
    .order("placed_at", { ascending: false });

  if (error) throw error;
  // payouts join returns an array (one-to-many); normalize to the
  // first (and only) row for UI consumption.
  return ((data ?? []) as unknown as Array<BetWithContext & { payout: unknown }>).map(
    (row) => ({
      ...row,
      payout: Array.isArray(row.payout) ? row.payout[0] ?? null : (row.payout ?? null),
    }),
  );
}
