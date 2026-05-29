import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, CheckCircle2, Clock, Wallet } from "lucide-react";

import { Button } from "@liverush/ui";
import { cn } from "@liverush/lib";

import { StudioPageTabs } from "@/components/StudioPageTabs";
import { WithdrawModal } from "@/components/balance/WithdrawModal";
import {
  MOCK_USDT_CENTS,
  dollars,
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
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const { data: payouts } = useStudioPayouts();
  // Locally-tracked "withdrawn" payout ids — the WithdrawModal still
  // mocks the cash-out flow, so we mark approved rows as withdrawn in
  // this Set to keep the UI feeling responsive without a DB write.
  // Resets on page reload.
  const [withdrawnIds, setWithdrawnIds] = useState<Set<string>>(new Set());

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

  const canWithdraw = totals.available > 0;

  // Mark the oldest "payout" rows as withdrawn until the requested
  // amount is covered. Mocked (no DB write) until real withdrawals
  // ship — real settlement would attach a withdrawal_id to each
  // payout row instead.
  const markRowsWithdrawn = (amountCents: number) => {
    let remaining = amountCents;
    const ordered = [...commissions]
      .filter((c) => c.status === "payout")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ids = new Set(withdrawnIds);
    for (const c of ordered) {
      if (remaining <= 0) break;
      if (c.amount_cents <= remaining) {
        remaining -= c.amount_cents;
        ids.add(c.id);
      } else {
        remaining = 0;
      }
    }
    setWithdrawnIds(ids);
  };

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

      {/* Available + pending header card. Matches the visual weight
          of the user-app Balance card so the two surfaces feel like
          the same product. */}
      <section className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wallet className="h-4 w-4" />
              <span className="text-sm font-medium">Available to withdraw</span>
            </div>
            <p className="mt-2 font-heading text-3xl font-bold tabular-nums text-foreground sm:text-4xl">
              {dollars(totals.available)}
            </p>
            {totals.pending > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <Clock className="h-3 w-3" />
                {dollars(totals.pending)} pending approval
              </p>
            )}
          </div>
          <Button
            size="lg"
            disabled={!canWithdraw}
            onClick={() => setWithdrawOpen(true)}
            title={
              canWithdraw
                ? undefined
                : "No available balance to withdraw yet."
            }
          >
            <Banknote className="h-4 w-4" />
            Withdraw
          </Button>
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

      <WithdrawModal
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        usdCents={totals.available}
        usdtCents={MOCK_USDT_CENTS}
        onWithdraw={(amountCents, currency) => {
          // Only USD draws from the real commission ledger right
          // now; USDT is still the pseudo-balance from the mock
          // constant, so flipping rows on a USDT withdrawal would
          // be misleading. Skip ledger updates when currency=usdt.
          if (currency === "usd") markRowsWithdrawn(amountCents);
        }}
      />
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
        <p className="font-heading text-sm font-bold tabular-nums sm:text-base">
          {dollars(commission.amount_cents)}
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
