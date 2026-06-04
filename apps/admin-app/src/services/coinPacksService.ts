import { supabase } from "@/integrations/supabase/client";

/**
 * Admin-side RPC wrappers for the `coin_packs` catalogue table.
 *
 * The three RPCs are gated by `is_admin()` server-side (migration
 * `20260604_000001_ledger_rebuild.sql`) — a non-admin calling them
 * gets a 42501 error. The Settings page UI batches dirty rows + new
 * rows through `upsertCoinPack` and queued deletes through
 * `deleteCoinPack` on Save.
 */

export interface AdminCoinPack {
  id: string;
  coins: number;
  priceDollarCents: number;
  sortOrder: number;
  isActive: boolean;
  /** Computed `price_dollar_cents / coins`, server-side. */
  dollarPerCoinCents: number;
  createdAt: string;
  updatedAt: string;
}

interface ListRow {
  id: string;
  coins: number;
  price_dollar_cents: number;
  sort_order: number;
  is_active: boolean;
  dollar_per_coin_cents: number;
  created_at: string;
  updated_at: string;
}

export async function listCoinPacks(): Promise<AdminCoinPack[]> {
  const { data, error } = await supabase.rpc("list_coin_packs");
  if (error) throw error;
  return ((data ?? []) as ListRow[]).map((row) => ({
    id: row.id,
    coins: row.coins,
    priceDollarCents: Number(row.price_dollar_cents),
    sortOrder: row.sort_order,
    isActive: row.is_active,
    dollarPerCoinCents: Number(row.dollar_per_coin_cents),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export interface UpsertCoinPackInput {
  /** `null` for new packs; the RPC generates a UUID. */
  id: string | null;
  coins: number;
  priceDollarCents: number;
  sortOrder: number;
  isActive: boolean;
}

export async function upsertCoinPack(
  input: UpsertCoinPackInput,
): Promise<void> {
  const { error } = await supabase.rpc("upsert_coin_pack", {
    p_id: input.id,
    p_coins: input.coins,
    p_price_dollar_cents: input.priceDollarCents,
    p_sort_order: input.sortOrder,
    p_is_active: input.isActive,
  });
  if (error) throw error;
}

export async function deleteCoinPack(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_coin_pack", { p_id: id });
  if (error) throw error;
}
