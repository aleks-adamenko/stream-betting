import { type ComponentType, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Banknote, CheckCircle2, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { CheckoutModal } from "@/components/balance/CheckoutModal";
import { UserPageTabs } from "@/components/layout/UserPageTabs";
import { CoinAmount, CoinIcon } from "@/components/ui/CoinAmount";
import { useAuth } from "@/contexts/AuthContext";
import { useCoinPacks, type CoinPack } from "@/hooks/useCoinPacks";
import {
  useTopUpHistory,
  topUpHistoryKeys,
  type TopUpRow,
} from "@/hooks/useTopUpHistory";
import {
  audChargeLabel,
  detectCurrency,
  localPriceLabel,
  type SupportedCurrency,
} from "@liverush/lib";
import { cn } from "@/lib/utils";

/**
 * Top-up screen for the virtual rush-coin currency.
 *
 * Flow: pick a pack → CheckoutModal → redirect to Stripe → return to
 * `/coins?session_id=…` (success) or `/coins?canceled=1` (cancel).
 *
 * On return:
 *   • `?canceled=1` → toast "Payment canceled", clear the param.
 *   • `?session_id=…` → "Processing…" banner; poll `useTopUpHistory`
 *     for a row with `reference_id === session_id`. When it appears
 *     (webhook landed), clear the param + toast "+N coins added".
 *
 * Prices display in the visitor's local currency (FX'd off AUD); the
 * AUD amount Stripe actually charges sits underneath as a small
 * caveat. AUD visitors see only the AUD label — the localized line
 * becomes redundant noise there.
 */

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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user, refreshProfile } = useAuth();

  // Detect currency once at page mount. detectCurrency is SSR-safe but
  // depends on navigator, so calling at render is fine for our SPA.
  const [currency] = useState<SupportedCurrency>(() => detectCurrency());
  const showLocalCaveat = currency !== "AUD";

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

  const handleTopUp = () => {
    if (!selected) return;
    setCheckoutOpen(true);
  };

  // ---- post-Stripe redirect handling --------------------------------------

  const sessionId = searchParams.get("session_id");
  const canceled = searchParams.get("canceled");

  // Show a toast + clear ?canceled=1 once when the user lands here from
  // an abandoned checkout.
  useEffect(() => {
    if (!canceled) return;
    toast.message("Payment canceled");
    const next = new URLSearchParams(searchParams);
    next.delete("canceled");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canceled]);

  // After a successful redirect-return we don't know if the webhook
  // landed yet (might be a few seconds behind). Poll the top-up
  // history until we see a row whose reference_id matches the session
  // id, then clear the banner. Cap the poll at ~30s to avoid burning
  // forever if something went wrong server-side.
  const [pollingStartedAt, setPollingStartedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!sessionId) {
      setPollingStartedAt(null);
      return;
    }
    setPollingStartedAt(Date.now());
  }, [sessionId]);

  const matchingRow = useMemo(() => {
    if (!sessionId || !history) return null;
    return history.find((r) => r.referenceId === sessionId) ?? null;
  }, [sessionId, history]);

  useEffect(() => {
    if (!sessionId) return;
    if (matchingRow) {
      // Webhook landed. Refresh profile so the balance ticks up,
      // toast the success, clear the URL param.
      void refreshProfile();
      toast.success(
        `+${coinFormatter.format(matchingRow.coins)} coins added to your balance`,
      );
      const next = new URLSearchParams(searchParams);
      next.delete("session_id");
      setSearchParams(next, { replace: true });
      setPollingStartedAt(null);
      return;
    }
    // No row yet — poll the history query every 1.5s. Stop polling
    // after 30s with an apology toast (webhook delivery probably failed).
    const id = window.setInterval(() => {
      const elapsed = Date.now() - (pollingStartedAt ?? Date.now());
      if (elapsed > 30_000) {
        window.clearInterval(id);
        toast.error(
          "Payment succeeded but balance hasn't updated yet. Try refreshing in a minute.",
        );
        const next = new URLSearchParams(searchParams);
        next.delete("session_id");
        setSearchParams(next, { replace: true });
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: topUpHistoryKeys.mine(user?.id),
      });
    }, 1500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, matchingRow, pollingStartedAt]);

  const processing = !!sessionId && !matchingRow;

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

        {/* Processing banner — sits between the header and the pack
            grid while we wait for the webhook to land. Blocks
            interaction with the grid so the user can't start another
            checkout while one is still settling. */}
        {processing ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/[0.06] p-3 text-sm">
            <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />
            <p className="text-foreground">
              Processing your payment&hellip; this can take a few seconds.
              Your balance will update automatically.
            </p>
          </div>
        ) : null}

        {/* Pack grid + Total + CTA, all inside one card. */}
        <section className="mt-6 rounded-2xl border border-border/40 bg-card p-4 shadow-sm sm:p-6">
          {packsLoading || !packs ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-[100px] rounded-2xl border border-border/40 bg-muted/40 animate-pulse"
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
                return (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => setSelectedId(pack.id)}
                    disabled={processing}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1.5 rounded-2xl border p-4 text-center transition-all",
                      isSelected
                        ? "border-primary bg-primary/[0.06] ring-2 ring-primary/30"
                        : "border-border/40 bg-muted/40 hover:border-primary/40 hover:bg-primary/[0.04]",
                      processing && "pointer-events-none opacity-50",
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 font-heading text-2xl font-extrabold leading-none tabular-nums text-foreground">
                      <CoinIcon className="h-6 w-6" />
                      {coinFormatter.format(pack.coins)}
                    </span>
                    {/* Single price label — visitor's local currency
                        when they're not in AUD, otherwise the
                        disambiguated "A$X.XX" form. No estimate
                        caveat: Stripe will show the AUD amount on
                        its hosted page if there's any currency
                        mismatch. */}
                    <span className="text-xs font-medium text-muted-foreground">
                      {showLocalCaveat
                        ? localPriceLabel(pack.priceDollarCents, currency)
                        : audChargeLabel(pack.priceDollarCents)}
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
                {selected
                  ? showLocalCaveat
                    ? localPriceLabel(selected.priceDollarCents, currency)
                    : audChargeLabel(selected.priceDollarCents)
                  : "—"}
              </span>
            </div>
            <Button
              type="button"
              variant="accent"
              size="lg"
              className="w-full sm:w-auto sm:min-w-[220px]"
              onClick={handleTopUp}
              disabled={!selected || processing}
            >
              Top up
            </Button>
          </div>

          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3 text-success" />
            Payment processed securely by Stripe
          </p>
        </section>

        {/* Top up history — driven by `ledger_entries` rows of
            `type='top_up'`. Real Stripe top-ups land here via the
            webhook; the row's reference_id is the Stripe session id. */}
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
              <p className="text-sm text-muted-foreground">No top-ups yet.</p>
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
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        +<CoinAmount value={tx.coins} fractionDigits={0} />
                      </span>
                      {tx.cashCents != null ? (
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {/* Same single-currency display logic as
                              the pack tiles + modal: local currency
                              when the visitor isn't in AUD, A$X.XX
                              otherwise. The historical row was
                              charged in AUD — we estimate the local
                              amount using today's FX rates, which is
                              close enough for a history label. */}
                          {showLocalCaveat
                            ? localPriceLabel(tx.cashCents, currency)
                            : audChargeLabel(tx.cashCents)}
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

      {/* CheckoutModal redirects to Stripe — see
          `apps/user-app/src/services/checkoutService.ts`. */}
      {selected ? (
        <CheckoutModal
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          coinPackId={selected.id}
          coins={selected.coins}
          cashCents={selected.priceDollarCents}
        />
      ) : null}
    </PageContainer>
  );
}
