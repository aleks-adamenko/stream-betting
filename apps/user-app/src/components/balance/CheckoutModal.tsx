import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2, Lock, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { CoinIcon } from "@/components/ui/CoinAmount";
import { useAuth } from "@/contexts/AuthContext";
import { notificationsKeys } from "@/hooks/useNotifications";
import { topUpBalance } from "@/services/balanceService";

/**
 * Mock Stripe-style checkout for the Get coins IAP flow.
 *
 * Visual only — no real Stripe wiring. The card-number / expiry /
 * CVC / name inputs are pre-filled with test-mode values so the
 * user can tap "Pay" without typing anything. On confirm we hit the
 * `top_up_balance` RPC with both the coin count + dollar cents
 * "paid" — the rebuilt RPC writes a `top_up` ledger row on the
 * user's account and a `top_up_received` row against `platform_cash`.
 *
 * Currency is shown as plain `$` — actual USD/AUD pick is deferred.
 */

interface CheckoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Coins to credit. The RPC multiplies by 100 to get balance_cents. */
  coins: number;
  /** Dollar price the mock card "pays". UI shows `$X.XX`; RPC stores
   *  the value (× 100, i.e. dollar cents) on the new `amount_cash_cents`
   *  column so the admin Wallet treasury reflects pretend revenue. */
  priceDollars: number;
}

const dollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const coinFormatter = new Intl.NumberFormat("en-US");

export function CheckoutModal({
  open,
  onOpenChange,
  coins,
  priceDollars,
}: CheckoutModalProps) {
  // Card form state. Pre-filled with Stripe-style test values so the
  // confirm flow is one tap — typing real-feeling card numbers into
  // a mock form is friction without any payoff.
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12 / 30");
  const [cvc, setCvc] = useState("123");
  const [name, setName] = useState("");
  const { user, profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();

  // Auto-fill the cardholder name from the signed-in profile so the
  // mock checkout looks like it remembered the user. Re-runs every
  // open in case the profile loaded after the modal mounted.
  useEffect(() => {
    if (!open) return;
    setName((prev) => prev || profile?.display_name || user?.email?.split("@")[0] || "");
  }, [open, profile?.display_name, user?.email]);

  const mutation = useMutation({
    mutationFn: () =>
      topUpBalance(coins, Math.round(priceDollars * 100)),
    onSuccess: async (data) => {
      await refreshProfile();
      void queryClient.invalidateQueries({ queryKey: notificationsKeys.mine() });
      const newBalance = (data.new_balance_cents / 100).toFixed(2);
      toast.success(
        `+${data.coins_added} coins added — new balance ${newBalance}`,
      );
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Payment failed");
    },
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle>Confirm purchase</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Mock checkout — no real card is charged.
            </p>
          </div>
          <DialogClose
            aria-label="Close"
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </DialogClose>
        </div>

        {/* Summary row — what the user is buying and what we'd
            charge if this were a real card flow. The coin count is
            the actual credit; the dollar price is metadata. */}
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-border/40 bg-muted/40 p-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-400/20">
            <CoinIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-base font-bold text-foreground">
              {coinFormatter.format(coins)} coins
            </p>
            <p className="text-xs text-muted-foreground">
              Credited to your balance after confirmation
            </p>
          </div>
          <p className="flex-shrink-0 font-heading text-base font-bold tabular-nums text-foreground">
            {dollarFormatter.format(priceDollars)}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-1 flex flex-col gap-3">
          {/* Card number — visual stripe-style row with the card
              icon on the right. Pre-filled test value. */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Card number
            </span>
            <div className="relative">
              <Input
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                inputMode="numeric"
                className="h-11 pr-10 font-mono tabular-nums tracking-wider"
              />
              <CreditCard className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </label>

          {/* Expiry + CVC sit on one row, same as Stripe Elements. */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Expiry
              </span>
              <Input
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                inputMode="numeric"
                placeholder="MM / YY"
                className="h-11 font-mono tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                CVC
              </span>
              <Input
                value={cvc}
                onChange={(e) => setCvc(e.target.value)}
                inputMode="numeric"
                placeholder="123"
                className="h-11 font-mono tabular-nums"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Name on card
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cardholder name"
              className="h-11"
            />
          </label>

          <Button
            type="submit"
            variant="accent"
            size="lg"
            className="mt-1 w-full"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              <>Pay {dollarFormatter.format(priceDollars)}</>
            )}
          </Button>

          <p className="inline-flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3 text-success" />
            Secured by Stripe (mock) · Virtual currency · no real money charged
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
