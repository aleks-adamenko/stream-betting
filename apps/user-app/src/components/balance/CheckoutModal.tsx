import { useState } from "react";
import { Loader2, Lock, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { CoinIcon } from "@/components/ui/CoinAmount";
import {
  audChargeLabel,
  detectCurrency,
  localPriceLabel,
  type SupportedCurrency,
} from "@liverush/lib";
import { createCheckoutSession } from "@/services/checkoutService";

/**
 * Confirm step before handing off to Stripe Checkout.
 *
 * The pre-Stripe version of this file was a mock card form pre-filled
 * with 4242… that immediately called `top_up_balance` to credit the
 * balance. This version drops every form field and shows a one-button
 * confirm: pack summary on top + "Pay AUD $X.XX with Stripe" CTA.
 *
 * The button never carries the visitor's local currency — it shows
 * the AUD amount Stripe will charge so the handoff doesn't surprise
 * anyone. Localized price + AUD caveat live on the summary row.
 *
 * On click, `createCheckoutSession` redirects the browser to Stripe.
 * The Coins page handles the `?session_id=` / `?canceled=` query
 * params on return.
 */

interface CheckoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Selected pack id — handed to the edge function. The server
   *  re-resolves coins + price + Stripe product id from `coin_packs`
   *  so the client can't tamper with the amount. */
  coinPackId: string;
  /** Coin count, for the summary row. The actual credit amount comes
   *  from the DB on the webhook side, not from this prop. */
  coins: number;
  /** AUD cents, for the labels. Same caveat — display only. */
  cashCents: number;
}

const coinFormatter = new Intl.NumberFormat("en-US");

export function CheckoutModal({
  open,
  onOpenChange,
  coinPackId,
  coins,
  cashCents,
}: CheckoutModalProps) {
  const [submitting, setSubmitting] = useState(false);

  // Detect currency once per modal mount. We deliberately re-call
  // detectCurrency() rather than receiving it as a prop so a locale
  // change in the browser between page mount and modal open lands
  // correctly.
  const [currency] = useState<SupportedCurrency>(() => detectCurrency());

  const audLabel = audChargeLabel(cashCents);
  const showLocal = currency !== "AUD";
  // Single price label everywhere in the modal — visitor's local
  // currency when they're not in AUD, otherwise the disambiguated
  // "A$X.XX" AUD label. The Pay button uses the same value so the
  // summary and CTA never disagree.
  const priceLabel = showLocal ? localPriceLabel(cashCents, currency) : audLabel;

  const handlePay = async () => {
    setSubmitting(true);
    try {
      // Returns void — `createCheckoutSession` calls
      // `window.location.assign` so the next thing the user sees is
      // Stripe's hosted page.
      await createCheckoutSession(coinPackId);
    } catch (err) {
      setSubmitting(false);
      const message = err instanceof Error ? err.message : "Checkout failed";
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle>Confirm purchase</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              You&rsquo;ll be redirected to Stripe to complete the payment
              securely.
            </p>
          </div>
          <DialogClose
            aria-label="Close"
            disabled={submitting}
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </DialogClose>
        </div>

        {/* Summary row — coins on the left, price on the right. The
            localized price (e.g. "€6.00") goes top, the AUD caveat
            ("Charged in AUD $10.00") underneath. When the visitor is
            in AUD we drop the caveat — the row reads cleanly. */}
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-border/40 bg-muted/40 p-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-400/20">
            <CoinIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-base font-bold text-foreground">
              {coinFormatter.format(coins)} coins
            </p>
            <p className="text-xs text-muted-foreground">
              Credited to your balance after payment
            </p>
          </div>
          <p className="flex-shrink-0 font-heading text-base font-bold tabular-nums text-foreground">
            {priceLabel}
          </p>
        </div>

        <div className="mt-1 flex flex-col gap-3">
          <Button
            type="button"
            variant="accent"
            size="lg"
            className="w-full"
            disabled={submitting}
            onClick={handlePay}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Redirecting to Stripe…
              </>
            ) : (
              <>Pay {priceLabel} with Stripe</>
            )}
          </Button>

          <p className="inline-flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3 text-success" />
            Payment processed securely by Stripe
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
