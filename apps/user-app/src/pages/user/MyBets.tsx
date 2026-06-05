import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Trophy, Wallet, Clock, X, CheckCircle2 } from "lucide-react";

import { CoinAmount, CoinIcon } from "@/components/ui/CoinAmount";
import { useAuth } from "@/contexts/AuthContext";
import { useMyBets } from "@/hooks/useMyBets";
import type { BetStatus } from "@/services/betsService";
import { totalBalanceCents } from "@/lib/balance";
import { cn } from "@/lib/utils";

// Status meta covers the legacy "open" alias for backwards compat plus
// the new lifecycle states from the Phase 1 betting MVP.
const STATUS_META: Record<
  BetStatus,
  { label: string; className: string; icon: typeof Clock }
> = {
  open: { label: "Open", className: "bg-primary/10 text-primary", icon: Clock },
  placed: { label: "Placed", className: "bg-primary/10 text-primary", icon: Clock },
  won_pending_payout: {
    label: "Won — awaiting payout",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    icon: CheckCircle2,
  },
  won: { label: "Won", className: "bg-success/15 text-success", icon: Trophy },
  lost: { label: "Lost", className: "bg-destructive/15 text-destructive", icon: X },
  refunded: { label: "Refunded", className: "bg-muted text-muted-foreground", icon: Wallet },
};


export default function MyBets() {
  const { profile } = useAuth();
  const { data: bets, isLoading } = useMyBets();

  const balance = totalBalanceCents(profile?.balance_cents);
  const openCount =
    bets?.filter(
      (b) => b.status === "open" || b.status === "placed",
    ).length ?? 0;
  const wonCount =
    bets?.filter(
      (b) => b.status === "won" || b.status === "won_pending_payout",
    ).length ?? 0;
  const totalStaked =
    bets?.reduce((sum, b) => sum + b.amount_cents, 0) ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="font-heading text-2xl font-bold sm:text-3xl">My bets</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Track your stakes, wins, and current balance.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <Stat label="Balance" value={<CoinAmount cents={balance} />} highlight />
          <Stat label="Total staked" value={<CoinAmount cents={totalStaked} />} />
          <Stat label="Open bets" value={String(openCount)} />
          <Stat label="Won" value={String(wonCount)} />
        </div>

        <h2 className="mt-10 mb-4 font-heading text-lg font-semibold">History</h2>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        )}

        {!isLoading && (!bets || bets.length === 0) && (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
            <p className="font-heading text-base font-semibold">No bets yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Place your first bet on a live challenge to see it here.
            </p>
          </div>
        )}

        {bets && bets.length > 0 && (
          <ul className="space-y-3">
            {bets.map((bet) => {
              const status = bet.status as BetStatus;
              const meta = STATUS_META[status] ?? STATUS_META.open;
              const Icon = meta.icon;
              // Two clear numbers per row: how much was staked, and
              // what the result was. The result line changes wording
              // by status so the user never has to read the badge to
              // know what happened.
              //   • placed/open: "Pending settlement" hint
              //   • won_pending_payout: "Won (pending payout)" w/ payout
              //   • won: "Won $X" (actual credit)
              //   • lost: "Lost"
              //   • refunded: "Refunded"
              const odds = Number(bet.odds_snapshot ?? bet.odds_decimal);
              const oddsText = Number.isFinite(odds) ? `${odds.toFixed(2)}×` : "—";
              let resultLabel: ReactNode = "";
              let resultClass = "text-muted-foreground";
              if (status === "won" && bet.payout_cents != null) {
                resultLabel = (
                  <>
                    Won <CoinAmount cents={bet.payout_cents} />
                  </>
                );
                resultClass = "text-success";
              } else if (status === "won_pending_payout") {
                resultLabel = bet.payout_cents ? (
                  <>
                    Won <CoinAmount cents={bet.payout_cents} /> (pending payout)
                  </>
                ) : (
                  "Won — pending payout"
                );
                resultClass = "text-amber-600 dark:text-amber-400";
              } else if (status === "lost") {
                resultLabel = (
                  <>
                    Lost <CoinAmount cents={bet.amount_cents} />
                  </>
                );
                resultClass = "text-destructive";
              } else if (status === "refunded") {
                resultLabel = (
                  <>
                    Refunded <CoinAmount cents={bet.amount_cents} />
                  </>
                );
                resultClass = "text-foreground";
              } else {
                // placed / open
                resultLabel = `Pending settlement (placed @ ${oddsText})`;
              }
              return (
                <li
                  key={bet.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:gap-4 sm:p-5"
                >
                  <Link
                    to={bet.event ? `/event/${bet.event.id}` : "#"}
                    className="flex flex-1 items-center gap-3 min-w-0"
                  >
                    {bet.event?.cover_url && (
                      <img
                        src={bet.event.cover_url}
                        alt=""
                        className="h-14 w-14 flex-shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {bet.event?.title ?? "Unknown event"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {bet.outcome?.label ?? "—"} ·{" "}
                        {new Date(bet.placed_at).toLocaleString()}
                      </p>
                    </div>
                  </Link>
                  <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
                    <div className="text-right">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Staked
                      </p>
                      <p className="font-heading text-base font-bold tabular-nums text-foreground">
                        <CoinAmount cents={bet.amount_cents} />
                      </p>
                      <p
                        className={cn(
                          // inline-flex + items-center + leading-none
                          // so the "Won / Lost / Refunded" word and
                          // the CoinAmount inline-flex line up dead-
                          // centred. The default <p> block layout
                          // would put the CoinAmount on the inline
                          // baseline next to the word, which doesn't
                          // match because CoinAmount's own baseline
                          // is derived from its children — that
                          // mismatch shows up as a vertical offset.
                          "mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium leading-none tabular-nums",
                          resultClass,
                        )}
                      >
                        {resultLabel}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        meta.className,
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-4",
        highlight ? "bg-primary/10 text-primary" : "bg-muted/50",
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide opacity-75">{label}</p>
      <p className="mt-1 font-heading text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
