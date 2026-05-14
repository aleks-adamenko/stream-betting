import { Link } from "react-router-dom";
import { Trophy, Wallet, Clock, X } from "lucide-react";

import { PageContainer } from "@/components/layout/PageContainer";
import { UserPageTabs } from "@/components/layout/UserPageTabs";
import { useAuth } from "@/contexts/AuthContext";
import { useMyBets } from "@/hooks/useMyBets";
import { cn } from "@/lib/utils";

const STATUS_META = {
  open: { label: "Open", className: "bg-primary/10 text-primary", icon: Clock },
  won: { label: "Won", className: "bg-success/15 text-success", icon: Trophy },
  lost: { label: "Lost", className: "bg-destructive/15 text-destructive", icon: X },
  refunded: { label: "Refunded", className: "bg-muted text-muted-foreground", icon: Wallet },
} as const;

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function MyBets() {
  const { profile } = useAuth();
  const { data: bets, isLoading } = useMyBets();

  const balance = profile?.balance_cents ?? 0;
  const openCount = bets?.filter((b) => b.status === "open").length ?? 0;
  const wonCount = bets?.filter((b) => b.status === "won").length ?? 0;
  const totalStaked =
    bets?.reduce((sum, b) => sum + b.amount_cents, 0) ?? 0;

  return (
    <PageContainer className="lg:pt-[18px]">
      <UserPageTabs />
      <h1 className="font-heading text-2xl font-bold sm:text-3xl">My bets</h1>
      <p className="mt-1 text-sm text-muted-foreground sm:text-base">
        Track your stakes, wins, and current balance.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Stat label="Balance" value={dollars(balance)} highlight />
        <Stat label="Total staked" value={dollars(totalStaked)} />
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
            const meta = STATUS_META[bet.status];
            const Icon = meta.icon;
            const potential = bet.amount_cents * Number(bet.odds_decimal);
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
                    <p className="font-heading text-base font-bold tabular-nums">
                      {dollars(bet.amount_cents)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      @ {Number(bet.odds_decimal).toFixed(2)}× ={" "}
                      {dollars(Math.round(potential))}
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
    </PageContainer>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
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
