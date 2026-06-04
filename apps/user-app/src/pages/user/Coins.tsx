import { type ComponentType, useEffect, useState } from "react";
import { Banknote, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { CheckoutModal } from "@/components/balance/CheckoutModal";
import { UserPageTabs } from "@/components/layout/UserPageTabs";
import { CoinAmount, CoinIcon } from "@/components/ui/CoinAmount";
import { useCoinPacks, type CoinPack } from "@/hooks/useCoinPacks";
import { useTopUpHistory, type TopUpRow } from "@/hooks/useTopUpHistory";
import { cn } from "@/lib/utils";

/**
 * Top-up screen for the virtual rush-coin currency.
 *
 * Pack catalogue + top-up history are both DB-backed now (admins edit
 * the catalogue from `apps/admin-app/src/pages/Settings.tsx`; rows
 * land in `ledger_entries` via the rebuilt `top_up_balance` RPC).
 * Click a pack → mock Stripe-style CheckoutModal → balance updates
 * and a new history row appears via Realtime.
 */

const dollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const coinFormatter = new Intl.NumberFormat("en-US");

const TOP_UP_META: {
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
} = {
  icon: Banknote,
  iconClassName: "bg-success/15 text-success",
};

function txDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Coins() {
  const { data: packs, isLoading: packsLoading } = useCoinPacks();
  const { data: history, isLoading: historyLoading } = useTopUpHistory();

  // Pack selection — default to the third pack (typical "recommended"
  // sweet spot), fall back to the first when the list is shorter.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  useEffect(() => {
    if (!packs || packs.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) => {
      if (current && packs.some((p) => p.id === current)) return current;
      const defaultIdx = Math.min(2, packs.length - 1);
      return packs[defaultIdx]!.id;
    });
  }, [packs]);

  const selected: CoinPack | null =
    packs?.find((p) => p.id === selectedId) ?? packs?.[0] ?? null;

  const selectedDollars = selected ? selected.priceDollarCents / 100 : 0;
  const totalLabel = dollarFormatter.format(selectedDollars);

  const handleTopUp = () => {
    if (!selected) return;
    setCheckoutOpen(true);
  };

  const rows: TopUpRow[] = history ?? [];

  return (
    <PageContainer className="lg:pt-[18px]">
      <div className="mx-auto w-full max-w-2xl">
        <UserPageTabs />

        <h1 className="font-heading text-2xl font-bold sm:text-3xl">
          Get coins
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Top up your virtual rush-coin balance.
        </p>

        {/* Pack grid + Total + CTA, all inside one card. Matches
            the balance-style container shape used elsewhere. */}
        <section className="mt-6 rounded-2xl border border-border/40 bg-card p-4 shadow-sm sm:p-6">
          {packsLoading || !packs ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-[88px] rounded-2xl border border-border/40 bg-muted/40 animate-pulse"
                />
              ))}
            </div>
          ) : packs.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              No top-up options available right now.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3">
              {packs.map((pack) => {
                const isSelected = pack.id === selectedId;
                const priceDollars = pack.priceDollarCents / 100;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => setSelectedId(pack.id)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1.5 rounded-2xl border p-4 text-center transition-all",
                      isSelected
                        ? "border-primary bg-primary/[0.06] ring-2 ring-primary/30"
                        : "border-border/40 bg-muted/40 hover:border-primary/40 hover:bg-primary/[0.04]",
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 font-heading text-2xl font-extrabold leading-none tabular-nums text-foreground">
                      <CoinIcon className="h-6 w-6" />
                      {coinFormatter.format(pack.coins)}
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">
                      {dollarFormatter.format(priceDollars)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 border-t border-border/40 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground">
                Total
              </span>
              <span className="font-heading text-base font-bold tabular-nums text-foreground">
                {totalLabel}
              </span>
            </div>
            <Button
              type="button"
              variant="accent"
              size="lg"
              className="w-full sm:w-auto sm:min-w-[220px]"
              onClick={handleTopUp}
              disabled={!selected}
            >
              Top up
            </Button>
          </div>

          {/* Short payment-trust footnote — replaces the dropped
              "Safe & secure payments" panel. Single line, sits
              just under the Top up button so it reads as the
              caption to the action. */}
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3 text-success" />
            Secure mock checkout · Virtual currency only · no real money charged
          </p>
        </section>

        {/* Top up history. Real `ledger_entries` rows (type='top_up')
            now, not the old MOCK_TOP_UPS array. */}
        <section className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold">
              Top up history
            </h2>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {historyLoading
                ? "—"
                : `${rows.length} ${rows.length === 1 ? "record" : "records"}`}
            </span>
          </div>

          {historyLoading ? (
            <ul className="space-y-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <li
                  key={idx}
                  className="h-[68px] rounded-2xl border border-border/40 bg-card shadow-sm animate-pulse"
                />
              ))}
            </ul>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No top-ups yet.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((tx) => {
                const Icon = TOP_UP_META.icon;
                return (
                  <li
                    key={tx.id}
                    className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card p-4 shadow-sm"
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
                        TOP_UP_META.iconClassName,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-heading text-sm font-semibold text-foreground">
                        Top up
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {txDate(tx.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-0.5 text-right">
                      <span className="inline-flex items-center gap-1 font-heading text-sm font-bold leading-none tabular-nums text-success sm:text-base">
                        +<CoinAmount value={tx.coins} fractionDigits={0} />
                      </span>
                      {tx.cashCents != null ? (
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {dollarFormatter.format(tx.cashCents / 100)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* CheckoutModal credits `coins` on the user side and records
          `priceDollars * 100` on the platform_cash side via the
          rebuilt `top_up_balance(p_coins, p_cash_cents)` RPC. */}
      {selected ? (
        <CheckoutModal
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          coins={selected.coins}
          priceDollars={selectedDollars}
        />
      ) : null}
    </PageContainer>
  );
}
