import { type ComponentType, useState } from "react";
import {
  Banknote,
  Bitcoin,
  CreditCard,
  Lock,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { TopUpModal } from "@/components/balance/TopUpModal";
import { UserPageTabs } from "@/components/layout/UserPageTabs";
import { CoinAmount, CoinIcon } from "@/components/ui/CoinAmount";
import { cn } from "@/lib/utils";

/**
 * Top-up screen for the virtual rush-coin currency.
 *
 * Layout + navigation only — no real IAP wiring yet. Selecting a
 * pack and tapping "Top up" opens the shared `TopUpModal` (same one
 * the Balance page uses), so the USD-instant-mock and USDT-receive
 * flows are exercised from one component. When real IAP lands, the
 * modal swaps internally; this page doesn't need to change.
 */

interface CoinPack {
  /** Stable key for selection state + analytics later. */
  id: string;
  /** Coins added to the user's balance on purchase. */
  coins: number;
  /** AUD price shown next to the pack — placeholder until the real
   *  storefront prices are sourced from the IAP product catalogue. */
  priceAud: number;
}

const COIN_PACKS: CoinPack[] = [
  { id: "p30", coins: 30, priceAud: 0.49 },
  { id: "p350", coins: 350, priceAud: 5.65 },
  { id: "p700", coins: 700, priceAud: 11.25 },
  { id: "p1400", coins: 1400, priceAud: 22.49 },
  { id: "p3500", coins: 3500, priceAud: 56.25 },
  { id: "p7000", coins: 7000, priceAud: 112.45 },
];

const audFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

const coinFormatter = new Intl.NumberFormat("en-AU");

// Mock top-up history. Same shape as the Balance page's
// `MOCK_TRANSACTIONS`, but pre-filtered to top-up rows only — this
// page never shows withdrawals. When the real ledger / payments
// service lands the array becomes a query result; the row component
// stays the same.
type TopUpKind = "usd" | "usdt";

interface TopUpEntry {
  id: string;
  kind: TopUpKind;
  method: string;
  coins: number;
  amountAud: number;
  createdAt: string;
}

const MOCK_TOP_UPS: TopUpEntry[] = [
  {
    id: "t1",
    kind: "usd",
    method: "Visa •••• 4242",
    coins: 1400,
    amountAud: 22.49,
    createdAt: "2026-05-22T14:30:00Z",
  },
  {
    id: "t2",
    kind: "usdt",
    method: "USDT · TRC-20",
    coins: 7000,
    amountAud: 112.45,
    createdAt: "2026-05-19T17:42:00Z",
  },
  {
    id: "t3",
    kind: "usd",
    method: "Apple Pay",
    coins: 350,
    amountAud: 5.65,
    createdAt: "2026-05-15T20:11:00Z",
  },
  {
    id: "t4",
    kind: "usdt",
    method: "USDT · ERC-20",
    coins: 3500,
    amountAud: 56.25,
    createdAt: "2026-05-12T08:30:00Z",
  },
  {
    id: "t5",
    kind: "usd",
    method: "Mastercard •••• 1881",
    coins: 700,
    amountAud: 11.25,
    createdAt: "2026-05-08T13:50:00Z",
  },
];

const TOP_UP_META: Record<
  TopUpKind,
  {
    label: string;
    icon: ComponentType<{ className?: string }>;
    iconClassName: string;
  }
> = {
  usd: {
    label: "USD top up",
    icon: Banknote,
    iconClassName: "bg-success/15 text-success",
  },
  usdt: {
    label: "USDT top up",
    icon: Bitcoin,
    iconClassName: "bg-primary/10 text-primary",
  },
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
  // Default-select the 4th pack ("1,400 coins") — typical
  // "recommended" sweet spot.
  const [selectedId, setSelectedId] = useState<string>("p1400");
  const [topUpOpen, setTopUpOpen] = useState(false);
  const selected = COIN_PACKS.find((p) => p.id === selectedId) ?? COIN_PACKS[0];

  const totalLabel = audFormatter.format(selected.priceAud);

  // Top up button opens the shared `TopUpModal`. From there the USD
  // path mock-credits the user's balance via `topUpBalance`, and the
  // USDT path shows the "Send USDT" wallet-address QR — same flow
  // the Balance page exposes.
  const handleTopUp = () => {
    setTopUpOpen(true);
  };

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
            the Balance page's "Current balance" container style. */}
        <section className="mt-6 rounded-2xl border border-border/40 bg-card p-4 shadow-sm sm:p-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3">
            {COIN_PACKS.map((pack) => {
              const isSelected = pack.id === selectedId;
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
                    {audFormatter.format(pack.priceAud)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-border/40 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground">
                Total
              </span>
              <span className="font-heading text-base font-bold tabular-nums text-foreground">
                {totalLabel}
              </span>
            </div>
            {/* Top up button — no leading icon; the action verb
                carries the meaning on its own and matches the
                Balance page's Top up button styling. */}
            <Button
              type="button"
              variant="accent"
              size="lg"
              className="w-full sm:w-auto sm:min-w-[220px]"
              onClick={handleTopUp}
            >
              Top up
            </Button>
          </div>
        </section>

        {/* Safe & secure payments band — chips trimmed to just
            Visa / Mastercard and USDT per latest spec. Bitcoin +
            Apple/Google Pay removed. */}
        <section className="mt-4 rounded-2xl border border-border/40 bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-success" />
              <p className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
                Safe & secure payments
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 self-start rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-success sm:self-auto">
              <ShieldCheck className="h-3.5 w-3.5" />
              SSL secured
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PaymentChip icon={CreditCard} label="Visa / Mastercard" />
            <PaymentChip icon={Bitcoin} label="USDT" />
          </div>
        </section>

        {/* Top up history. No filter tabs because this page only
            ever shows top-ups — withdrawals live on /balance. The
            row layout mirrors the Balance page's transaction list
            so the visual rhythm stays consistent. */}
        <section className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold">
              Top up history
            </h2>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {MOCK_TOP_UPS.length}{" "}
              {MOCK_TOP_UPS.length === 1 ? "record" : "records"}
            </span>
          </div>

          {MOCK_TOP_UPS.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No top-ups yet.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {MOCK_TOP_UPS.map((tx) => {
                const meta = TOP_UP_META[tx.kind];
                const Icon = meta.icon;
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
                        {tx.method} · {txDate(tx.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-0.5 text-right">
                      <span className="inline-flex items-center gap-1 font-heading text-sm font-bold leading-none tabular-nums text-success sm:text-base">
                        +<CoinAmount value={tx.coins} fractionDigits={0} />
                      </span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {audFormatter.format(tx.amountAud)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* `presetAmountCents` is the COIN value the user is buying,
          not the USD price — the soft currency is coins, so paying
          $0.49 for a 30-coin pack credits 30 coins (3,000 in
          balance_cents, since 1 coin = 100 balance_cents). The
          dollar amount paid is metadata that lives only in the
          purchase record. */}
      <TopUpModal
        open={topUpOpen}
        onOpenChange={setTopUpOpen}
        presetAmountCents={selected.coins * 100}
      />
    </PageContainer>
  );
}

/** Small bordered pill used for a single payment method in the
 *  trust band under the pack grid. Icon + label, single row. */
function PaymentChip({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/40 px-2.5 py-1 text-xs font-semibold text-foreground">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      {label}
    </span>
  );
}
