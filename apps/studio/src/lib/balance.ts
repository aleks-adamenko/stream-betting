// Studio-side balance / commission helpers.
//
// Mirrors `apps/user-app/src/lib/balance.ts` so the two surfaces stay
// visually + numerically consistent — same dollar formatting, same
// MOCK_USDT_CENTS so the withdrawal modal has a non-zero USDT
// pseudo-balance to show in the picker.
//
// When real commission settlement lands, swap MOCK_USDT_CENTS for a
// real source and the rest of the studio surfaces (Balance card,
// WithdrawModal) keep working with no shape change.

export const MOCK_USDT_CENTS = 12500;

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Compact formatter for follower counts and similar large numbers
 *  ("12.3K", "1.5M") — mirrors the inline helper in the user-app. */
export const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// ---- Mock commission ledger ---------------------------------------------
//
// Drives the Balance screen until real settlement infrastructure
// exists. Three statuses:
//
//   • pending_approval — accrued but not yet approved by the platform
//   • payout           — approved, counts toward the available
//                        balance, can be withdrawn
//   • withdrawn        — already paid out
//
// `withdrawn_at` is only set when `status === "withdrawn"`. When the
// withdrawal modal completes, the Balance page flips one or more
// `payout` rows to `withdrawn` locally — no DB write.

export type CommissionStatus = "pending_approval" | "payout" | "withdrawn";

export interface MockCommission {
  id: string;
  event_id: string;
  event_title: string;
  amount_cents: number;
  status: CommissionStatus;
  created_at: string;
  withdrawn_at?: string;
}

// =========================================================================
// Per-event commission preview
// =========================================================================
//
// The events list surfaces a small commission pill next to each
// finished event row so creators can see at a glance what they
// earned and whether it's approved yet. The Balance page is the
// authoritative ledger; this preview is just a deterministic
// derivation so the pill on a given event id reads the same on
// every render until real settlement infrastructure replaces it.
//
// Deterministic = a tiny string hash → split between
// pending_approval / payout, and an amount in the $20–$200 range.
// Calling it on the same event id always returns the same result
// (no random()), so the UI doesn't reshuffle on refresh.

export interface MockEventCommissionPreview {
  amount_cents: number;
  status: Extract<CommissionStatus, "pending_approval" | "payout">;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function mockEventCommission(
  eventId: string,
): MockEventCommissionPreview {
  const h = hashStr(eventId);
  // ~40% pending / ~60% approved feels right for a demo — most
  // finished events have already been approved, a small tail is
  // still in review.
  const status = h % 10 < 4 ? "pending_approval" : "payout";
  // Amount in [$20, $200]. `>>>` (unsigned right shift) keeps the
  // value as a uint32 — JavaScript's `>>` (signed) would reinterpret
  // hashStr's uint32 output as int32 and produce negative results
  // when the high bit is set, which then turned `20 + (negative %
  // 181)` into a negative commission. Use `>>>` and the math stays
  // non-negative for any input.
  const amount_cents = (20 + ((h >>> 8) % 181)) * 100;
  return { amount_cents, status };
}

export const MOCK_COMMISSIONS: MockCommission[] = [
  {
    id: "c1",
    event_id: "evt_demo_1",
    event_title: "Pop the Bottle Challenge",
    amount_cents: 4500,
    status: "pending_approval",
    created_at: "2026-05-27T18:42:00Z",
  },
  {
    id: "c2",
    event_id: "evt_demo_2",
    event_title: "Cup-stack speedrun",
    amount_cents: 12800,
    status: "pending_approval",
    created_at: "2026-05-26T15:10:00Z",
  },
  {
    id: "c3",
    event_id: "evt_demo_3",
    event_title: "Snorkel & Find — Round 4",
    amount_cents: 7300,
    status: "payout",
    created_at: "2026-05-24T20:05:00Z",
  },
  {
    id: "c4",
    event_id: "evt_demo_4",
    event_title: "Late-night taste test",
    amount_cents: 9650,
    status: "payout",
    created_at: "2026-05-22T22:30:00Z",
  },
  {
    id: "c5",
    event_id: "evt_demo_5",
    event_title: "Cube-solving sprint",
    amount_cents: 3300,
    status: "payout",
    created_at: "2026-05-20T16:15:00Z",
  },
  {
    id: "c6",
    event_id: "evt_demo_6",
    event_title: "Egg-drop precision",
    amount_cents: 5400,
    status: "withdrawn",
    created_at: "2026-05-15T11:00:00Z",
    withdrawn_at: "2026-05-18T09:30:00Z",
  },
  {
    id: "c7",
    event_id: "evt_demo_7",
    event_title: "Pancake stack-off",
    amount_cents: 8200,
    status: "withdrawn",
    created_at: "2026-05-12T08:45:00Z",
    withdrawn_at: "2026-05-14T17:20:00Z",
  },
  {
    id: "c8",
    event_id: "evt_demo_8",
    event_title: "Free-throw marathon",
    amount_cents: 4100,
    status: "withdrawn",
    created_at: "2026-05-08T19:00:00Z",
    withdrawn_at: "2026-05-10T12:00:00Z",
  },
];
