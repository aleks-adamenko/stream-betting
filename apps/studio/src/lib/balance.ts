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
