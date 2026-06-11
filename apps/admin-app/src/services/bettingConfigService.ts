import {
  type BettingConfig,
  type BettingConfigRow,
  bettingConfigFromRow,
} from "@liverush/lib";

import { supabase } from "@/integrations/supabase/client";

/**
 * Admin-side RPC wrappers for the singleton `betting_config` row.
 *
 * Both RPCs are gated by `is_admin()` server-side (migration
 * `20260611_000003_betting_config_table.sql`) — a non-admin caller
 * gets a 42501 error. `update_betting_config` re-validates every
 * cross-field guardrail and raises friendly 22023 messages; the table
 * CHECK constraints sit underneath as the un-bypassable backstop.
 *
 * Saved changes propagate to NEW events only — live events read the
 * snapshot frozen onto `events.betting_constants` at go-live.
 */

/** Resolved config plus the audit columns the panel surfaces. */
export interface AdminBettingConfig extends BettingConfig {
  /** ISO timestamp of the last successful save (null until first edit). */
  updatedAt: string | null;
  /** auth.uid() of the admin who last saved (null until first edit). */
  updatedBy: string | null;
}

/** snake_case row from the config RPCs, incl. the audit columns. */
interface ConfigRow extends BettingConfigRow {
  updated_at?: string | null;
  updated_by?: string | null;
}

function mapRow(row: ConfigRow): AdminBettingConfig {
  return {
    ...bettingConfigFromRow(row),
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

export async function getBettingConfig(): Promise<AdminBettingConfig> {
  const { data, error } = await supabase.rpc("get_betting_config");
  if (error) throw error;
  const row = ((data ?? []) as ConfigRow[])[0];
  if (!row) throw new Error("Betting config row not found");
  return mapRow(row);
}

/** Full editable parameter set (camelCase). All 17 fields required. */
export type UpdateBettingConfigInput = BettingConfig;

export async function updateBettingConfig(
  input: UpdateBettingConfigInput,
): Promise<AdminBettingConfig> {
  const { data, error } = await supabase.rpc("update_betting_config", {
    p_min_bet_cents: input.minBetCents,
    p_max_bet_cents: input.maxBetCents,
    p_max_round_stake_cents: input.maxRoundStakeCents,
    p_min_unique_bettors: input.minUniqueBettors,
    p_min_outcomes_with_bets: input.minOutcomesWithBets,
    p_min_pool_max_bet_multiplier: input.minPoolMaxBetMultiplier,
    p_min_pool_floor_cents: input.minPoolFloorCents,
    p_max_odds_cap: input.maxOddsCap,
    p_rake_bps: input.rakeBps,
    p_rake_platform_bps: input.rakePlatformBps,
    p_rake_streamer_bps: input.rakeStreamerBps,
    p_betting_window_min_sec: input.bettingWindowMinSec,
    p_betting_window_max_sec: input.bettingWindowMaxSec,
    p_betting_window_default_sec: input.bettingWindowDefaultSec,
    p_daily_cap_cents: input.dailyCapCents,
    p_min_payout_coins: input.minPayoutCoins,
    p_stale_result_grace_minutes: input.staleResultGraceMinutes,
  });
  if (error) throw error;
  const row = ((data ?? []) as ConfigRow[])[0];
  if (!row) throw new Error("Betting config update returned no row");
  return mapRow(row);
}
