import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, CheckCircle2, Clock, Wallet } from "lucide-react";

import { CoinAmount } from "@liverush/ui";
import {
  balanceCentsToCoins,
  coinsToDollarCents,
  cn,
  formatDollarCents,
} from "@liverush/lib";

import { StudioPageTabs } from "@/components/StudioPageTabs";
import {
  type CommissionStatus,
  type MockCommission,
} from "@/lib/balance";
import { useStudioPayouts, type StudioPayout } from "@/hooks/useStudioPayouts";

/**
 * Creator Balance page — header card with available + pending totals,
 * Withdraw CTA, and a filterable list of commissions across three
 * states (pending approval / available / withdrawn).
 *
 * Data is currently driven by a local clone of the MOCK_COMMISSIONS
 * array (see `apps/studio/src/lib/balance.ts`). When real commission
 * settlement lands, replace the initial state + the
 * `markRowsWithdrawn` mutation with a React Query + RPC pair; the
 * rest of the page stays.
 */

type Filter = "all" | "pending_approval" | "payout" | "withdrawn";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending_approval", label: "Pending approval" },
  { id: "payout", label: "Available" },
  { id: "withdrawn", label: "Withdrawn" },
];

const STATUS_META: Record<
  CommissionStatus,
  { label: string; className: string }
> = {
  pending_approval: {
    label: "Pending approval",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  payout: {
    label: "Available",
    className: "bg-success/15 text-success",
  },
  withdrawn: {
    label: "Withdrawn",
    className: "bg-muted text-muted-foreground",
  },
};

function rowDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Translate the new `payouts.status` enum onto the legacy
// CommissionStatus enum the UI already styles. 'pending' / 'approved'
// → "pending_approval", 'completed' → "payout". Rejected payouts
// are surfaced as withdrawn only when the local mark-withdrawn flag
// has been flipped (the mock-withdraw UX still lives on top of this).
function statusOfPayout(
  p: StudioPayout,
  withdrawnIds: Set<string>,
): CommissionStatus {
  if (withdrawnIds.has(p.id)) return "withdrawn";
  if (p.status === "completed") return "payout";
  if (p.status === "rejected" || p.status === "failed") return "withdrawn";
  return "pending_approval";
}

export default function Balance() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data: payouts } = useStudioPayouts();
  // Locally-tracked "withdrawn" payout ids — empty set in v2 because
  // cashout requests now flip status on the actual `payouts` row via
  // `request_payout`. Kept here as a no-op placeholder so the
  // statusOfPayout helper stays a one-line callsite.
  const withdrawnIds = useMemo<Set<string>>(() => new Set(), []);

  // Build the commission rows the UI renders. Backed by real
  // `payouts` data but shaped like the legacy MockCommission type so
  // the existing CommissionRow + STATUS_META tables keep working.
  const commissions = useMemo<MockCommission[]>(() => {
    return (payouts ?? [])
      .map((p) => {
        const status = statusOfPayout(p, withdrawnIds);
        if (status === "withdrawn" && p.status !== "completed") {
          // Don't surface rejected/failed rows yet — Phase 1 has no
          // moderator escalation surface.
          return null;
        }
        const row: MockCommission = {
          id: p.id,
          event_id: p.event_id,
          event_title: p.event_title ?? p.event_id,
          amount_cents: p.amount_cents,
          status,
          created_at: p.created_at,
        };
        if (status === "withdrawn") {
          row.withdrawn_at = p.completed_at ?? new Date().toISOString();
        }
        return row;
      })
      .filter((r): r is MockCommission => r !== null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [payouts, withdrawnIds]);

  const totals = useMemo(() => {
    let available = 0;
    let pending = 0;
    for (const c of commissions) {
      if (c.status === "payout") available += c.amount_cents;
      else if (c.status === "pending_approval") pending += c.amount_cents;
    }
    return { available, pending };
  }, [commissions]);

  const filtered = useMemo(() => {
    if (filter === "all") return commissions;
    return commissions.filter((c) => c.status === filter);
  }, [commissions, filter]);

  // Dollar equivalents — 1 coin = $0.10. `balance_cents` here is
  // already "coins × 100", so coins = cents / 100 and dollars =
  // coins × 0.10 = cents / 1000. Use the shared helpers to keep all
  // currency math in one place.
  const availableCoins = balanceCentsToCoins(totals.available);
  const pendingCoins = balanceCentsToCoins(totals.pending);
  const availableDollarCents = coinsToDollarCents(availableCoins);
  const pendingDollarCents = coinsToDollarCents(pendingCoins);

  return (
    // Same reading-column width as the user-app's Balance — matches
    // Profile so the tab swap doesn't jump column widths.
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Balance</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Track your commissions and cash out when you're ready.
        </p>
      </div>

      <StudioPageTabs />

      {/* Available + pending header card. Withdraw button moved to
          Profile.tsx (`Request payout`) — this card now just surfaces
          the running totals + dollar equivalent so the streamer can
          see how far they are from the 1,000-coin payout floor. */}
      <section className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wallet className="h-4 w-4" />
              <span className="text-sm font-medium">Lifetime commissions</span>
            </div>
            <p className="mt-2 font-heading text-3xl font-bold tabular-nums text-foreground sm:text-4xl">
              <CoinAmount cents={totals.available} fractionDigits={0} />
            </p>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              {formatDollarCents(availableDollarCents)} equivalent
            </p>
            {totals.pending > 0 && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium leading-none text-amber-600 dark:text-amber-400">
                <Clock className="h-3 w-3" />
                <CoinAmount cents={totals.pending} fractionDigits={0} /> pending approval ·{" "}
                {formatDollarCents(pendingDollarCents)}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Commission ledger */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">Commissions</h2>
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {filtered.length}{" "}
            {filtered.length === 1 ? "record" : "records"}
          </span>
        </div>

        {/* Filter pills — same visual language as the user-app
            transaction filter tabs. */}
        <nav className="mb-3 flex gap-1 overflow-x-auto rounded-2xl border border-border/40 bg-card p-1 shadow-sm">
          {FILTERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={cn(
                "flex flex-1 items-center justify-center whitespace-nowrap rounded-xl px-2 py-2 text-xs font-semibold transition-colors sm:text-sm",
                filter === t.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary/40",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing here yet.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((c) => (
              <CommissionRow key={c.id} commission={c} />
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}

function CommissionRow({ commission }: { commission: MockCommission }) {
  const meta = STATUS_META[commission.status];
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
      <span
        className={cn(
          "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
          commission.status === "withdrawn"
            ? "bg-muted text-muted-foreground"
            : "bg-success/15 text-success",
        )}
      >
        {commission.status === "withdrawn" ? (
          <Banknote className="h-4 w-4" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <Link
          to={`/events/${commission.event_id}`}
          className="block truncate font-heading text-sm font-semibold text-foreground hover:text-primary hover:underline"
        >
          {commission.event_title}
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {rowDate(commission.created_at)}
          {commission.withdrawn_at && (
            <> · Withdrawn {rowDate(commission.withdrawn_at)}</>
          )}
        </p>
      </div>

      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        <p className="font-heading text-sm font-bold leading-none tabular-nums sm:text-base">
          <CoinAmount cents={commission.amount_cents} />
        </p>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            meta.className,
          )}
        >
          {meta.label}
        </span>
      </div>
    </li>
  );
}
