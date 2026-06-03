import { useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { Banknote, Bitcoin, CheckCircle2, Clock, Trophy, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { UserPageTabs } from "@/components/layout/UserPageTabs";
import { TopUpModal } from "@/components/balance/TopUpModal";
import { WithdrawModal } from "@/components/balance/WithdrawModal";
import { CoinAmount } from "@/components/ui/CoinAmount";
import { useAuth } from "@/contexts/AuthContext";
import { usePayouts } from "@/hooks/usePayouts";
import { MOCK_USDT_CENTS } from "@/lib/balance";
import { cn } from "@/lib/utils";

/* ---------- transaction history (mock) ---------- */

type TxKind =
  | "top_up_usd"
  | "withdrawal_usd"
  | "top_up_crypto"
  | "withdrawal_crypto";

interface MockTransaction {
  id: string;
  kind: TxKind;
  method: string;
  amount_cents: number;
  created_at: string;
}

const TX_META: Record<
  TxKind,
  {
    label: string;
    icon: ComponentType<{ className?: string }>;
    iconClassName: string;
    direction: "in" | "out";
  }
> = {
  top_up_usd: {
    label: "Top up",
    icon: Banknote,
    iconClassName: "bg-success/15 text-success",
    direction: "in",
  },
  withdrawal_usd: {
    label: "Withdrawal",
    icon: Banknote,
    iconClassName: "bg-destructive/15 text-destructive",
    direction: "out",
  },
  top_up_crypto: {
    label: "Top up (crypto)",
    icon: Bitcoin,
    iconClassName: "bg-success/15 text-success",
    direction: "in",
  },
  withdrawal_crypto: {
    label: "Withdrawal (crypto)",
    icon: Bitcoin,
    iconClassName: "bg-destructive/15 text-destructive",
    direction: "out",
  },
};

const MOCK_TRANSACTIONS: MockTransaction[] = [
  {
    id: "t1",
    kind: "top_up_usd",
    method: "Visa •••• 4242",
    amount_cents: 5000,
    created_at: "2026-05-22T14:30:00Z",
  },
  {
    id: "t2",
    kind: "withdrawal_crypto",
    method: "BTC · bc1q…x9k2",
    amount_cents: 12000,
    created_at: "2026-05-21T09:15:00Z",
  },
  {
    id: "t3",
    kind: "top_up_crypto",
    method: "ETH · 0x7c…4A1f",
    amount_cents: 20000,
    created_at: "2026-05-19T17:42:00Z",
  },
  {
    id: "t4",
    kind: "withdrawal_usd",
    method: "Mastercard •••• 1881",
    amount_cents: 3500,
    created_at: "2026-05-18T11:08:00Z",
  },
  {
    id: "t5",
    kind: "top_up_usd",
    method: "Apple Pay",
    amount_cents: 1000,
    created_at: "2026-05-15T20:11:00Z",
  },
  {
    id: "t6",
    kind: "top_up_crypto",
    method: "USDT · TRC-20",
    amount_cents: 50000,
    created_at: "2026-05-12T08:30:00Z",
  },
  {
    id: "t7",
    kind: "withdrawal_usd",
    method: "Bank transfer",
    amount_cents: 25000,
    created_at: "2026-05-08T13:50:00Z",
  },
];

type TxFilter = "all" | "in" | "out";
const TX_TABS: { id: TxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in", label: "Deposits" },
  { id: "out", label: "Withdrawals" },
];

function txDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Balance() {
  const { profile } = useAuth();
  const [txFilter, setTxFilter] = useState<TxFilter>("all");
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const { data: payouts } = usePayouts();

  // Pending payouts feed the "In review" section above the
  // transaction history. Once approved (status='completed') they
  // disappear from the in-review list — the credit has already
  // landed on `profile.balance_cents` so the user can see it in the
  // header card.
  const inReviewPayouts = (payouts ?? []).filter(
    (p) => p.status === "pending" || p.status === "approved",
  );

  const filteredTx = MOCK_TRANSACTIONS.filter((tx) => {
    if (txFilter === "all") return true;
    const dir = TX_META[tx.kind].direction;
    return dir === txFilter;
  });

  const usdCents = profile?.balance_cents ?? 0;
  const usdtCents = MOCK_USDT_CENTS;
  const totalCents = usdCents + usdtCents;

  // Transfer flow still lives in a later phase — surface a placeholder
  // toast so the prototype communicates intent without claiming work done.
  const handleTransfer = () => toast.info("Transfer flow coming soon");

  return (
    <PageContainer className="lg:pt-[18px]">
      <div className="mx-auto w-full max-w-2xl">
        <UserPageTabs />
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Balance</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Add virtual funds to bet on live challenges.
        </p>

        {/* Current balance card. USD / USDT side-chips removed —
            the app surfaces a single virtual-coin balance now, so
            the per-currency breakdown was just noise next to the
            big number on the left. */}
        <div className="mt-6 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Wallet className="h-4 w-4" />
            <span className="text-sm font-medium">Your balance</span>
          </div>
          <p className="mt-2 font-heading text-3xl font-bold tabular-nums text-foreground sm:text-4xl">
            <CoinAmount cents={totalCents} />
          </p>
        </div>

        {/* Primary actions */}
        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
          <Button variant="accent" size="lg" onClick={() => setTopUpOpen(true)}>
            Top up
          </Button>
          <Button size="lg" onClick={() => setWithdrawOpen(true)}>
            Withdraw
          </Button>
          <Button variant="secondary" size="lg" onClick={handleTransfer}>
            Transfer
          </Button>
        </div>

        {/* Payouts in review — winners + refunds waiting for moderator
            approval. The list disappears when nothing is pending. */}
        {inReviewPayouts.length > 0 && (
          <section className="mt-10">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-heading text-lg font-semibold">
                Payouts in review
              </h2>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {inReviewPayouts.length}{" "}
                {inReviewPayouts.length === 1 ? "row" : "rows"}
              </span>
            </div>
            <ul className="space-y-2">
              {inReviewPayouts.map((p) => {
                const Icon = p.type === "refund" ? Wallet : Trophy;
                return (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-4 shadow-sm"
                  >
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-heading text-sm font-semibold text-foreground">
                        {p.type === "refund" ? "Refund pending" : "Win pending"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        <Link
                          to={`/event/${p.event_id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {p.event_title ?? p.event_id}
                        </Link>{" "}
                        · {txDate(p.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <p className="inline-flex items-center gap-1 font-heading text-sm font-bold leading-none tabular-nums text-amber-700 dark:text-amber-300">
                        +<CoinAmount cents={p.amount_cents} />
                      </p>
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        <Clock className="h-3 w-3" />
                        Pending moderation
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {/* Completed payouts roll into the user's balance, so the
                follow-on `payout_credit` ledger entry isn't surfaced
                here — the credit just appears in the Your balance card
                above. We render a separate "recently approved"
                hint chip when something flips. */}
            {payouts && payouts.some((p) => p.status === "completed") && (
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                Approved payouts are added to your balance above.
              </p>
            )}
          </section>
        )}

        {/* Transaction history */}
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold">
              Transaction history
            </h2>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {filteredTx.length}{" "}
              {filteredTx.length === 1 ? "record" : "records"}
            </span>
          </div>

          {/* Filter tabs */}
          <nav className="mb-3 flex gap-1 rounded-2xl border border-border/40 bg-card p-1 shadow-sm">
            {TX_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTxFilter(t.id)}
                className={cn(
                  "flex flex-1 items-center justify-center rounded-xl px-2 py-2 text-xs font-semibold transition-colors sm:text-sm",
                  txFilter === t.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary/40",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* List */}
          {filteredTx.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No transactions yet.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredTx.map((tx) => {
                const meta = TX_META[tx.kind];
                const Icon = meta.icon;
                const isIn = meta.direction === "in";
                return (
                  <li
                    key={tx.id}
                    className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card p-4 shadow-sm"
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
                        meta.iconClassName,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-heading text-sm font-semibold text-foreground">
                        {meta.label}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {tx.method} · {txDate(tx.created_at)}
                      </p>
                    </div>
                    <p
                      className={cn(
                        "inline-flex flex-shrink-0 items-center gap-1 font-heading text-sm font-bold leading-none tabular-nums sm:text-base",
                        isIn ? "text-success" : "text-destructive",
                      )}
                    >
                      {isIn ? "+" : "−"}
                      <CoinAmount cents={tx.amount_cents} />
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <TopUpModal open={topUpOpen} onOpenChange={setTopUpOpen} />
      <WithdrawModal
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        usdCents={usdCents}
        usdtCents={usdtCents}
      />
    </PageContainer>
  );
}

