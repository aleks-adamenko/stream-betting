import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Banknote, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  Button,
  CoinAmount,
  CoinIcon,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@liverush/ui";
import {
  MIN_PAYOUT_COINS,
  coinsToDollarCents,
  formatDollarCents,
} from "@liverush/lib";

import { requestPayout } from "@/services/payoutsService";
import { streamerBalanceKeys } from "@/hooks/useStreamerBalance";
import { studioPayoutsKeys } from "@/hooks/useStudioPayouts";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Streamer-side cashout modal.
 *
 * Defaults the request to the streamer's full available balance, with
 * a numeric input the streamer can dial down to any multiple of 100
 * coins ≥ 1,000 (the platform's MIN_PAYOUT_COINS floor). Submitting
 * calls the `request_payout` RPC — see migration
 * `20260604_000001_ledger_rebuild.sql`. The RPC debits the user's
 * balance and writes a pending `payouts` row that the admin Wallet
 * page surfaces for approval.
 */

interface RequestPayoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cashable balance in `withdrawable_cents` (1 coin = 100 cents).
   *  This is the earned-rake pot only — see migration
   *  20260604_000002_streamer_balance.sql for why it's separate from
   *  the user-app's `balance_cents`. */
  balanceCents: number;
}

const dollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const coinFormatter = new Intl.NumberFormat("en-US");

export function RequestPayoutModal({
  open,
  onOpenChange,
  balanceCents,
}: RequestPayoutModalProps) {
  const queryClient = useQueryClient();
  const { user, creator } = useAuth();
  const availableCoins = Math.floor(balanceCents / 100);

  // Default to the full balance rounded down to the nearest 100 coins
  // so the displayed amount converts to a whole-dollar dollar figure.
  // Min input value clamps to MIN_PAYOUT_COINS once the user types.
  const defaultCoins = Math.max(
    MIN_PAYOUT_COINS,
    Math.floor(availableCoins / 100) * 100,
  );
  const [coinsInput, setCoinsInput] = useState<string>(
    availableCoins >= MIN_PAYOUT_COINS ? String(defaultCoins) : "",
  );

  const parsed = Number.parseInt(coinsInput, 10);
  const coins = Number.isFinite(parsed) ? parsed : 0;
  const isValid =
    coins >= MIN_PAYOUT_COINS
    && coins <= availableCoins
    && coins % 1 === 0;
  const cashCents = isValid ? coinsToDollarCents(coins) : 0;

  const mutation = useMutation({
    mutationFn: () => requestPayout(coins),
    onSuccess: (data) => {
      const cash = formatDollarCents(data.cash_cents);
      toast.success(`Payout requested — ${cash} (${data.coins} coins)`);
      void queryClient.invalidateQueries({
        queryKey: streamerBalanceKeys.mine(user?.id),
      });
      void queryClient.invalidateQueries({
        queryKey: studioPayoutsKeys.mine(creator?.id),
      });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Payout request failed");
    },
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isValid) return;
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle>Request payout</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Cash out collected coins. Min 1,000 coins ($100).
            </p>
          </div>
          <DialogClose
            aria-label="Close"
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </DialogClose>
        </div>

        {/* Balance summary — coin total + dollar equivalent so the
            streamer sees both numbers without leaving the dialog. */}
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-border/40 bg-muted/40 p-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-400/20">
            <CoinIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              Available
            </p>
            <p className="font-heading text-base font-bold text-foreground">
              {coinFormatter.format(availableCoins)} coins
            </p>
          </div>
          <p className="flex-shrink-0 font-heading text-base font-bold tabular-nums text-foreground">
            {dollarFormatter.format(availableCoins / 10)}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-1 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Cash out
            </span>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_PAYOUT_COINS}
                  max={availableCoins}
                  step={100}
                  value={coinsInput}
                  onChange={(e) => setCoinsInput(e.target.value)}
                  placeholder="1000"
                  className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-base font-mono tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <CoinIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                coins
              </span>
            </div>
          </label>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              You'll receive
            </span>
            <span className="font-heading text-lg font-bold tabular-nums text-foreground">
              {formatDollarCents(cashCents)}
            </span>
          </div>

          {coins > 0 && coins < MIN_PAYOUT_COINS ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Minimum payout is {coinFormatter.format(MIN_PAYOUT_COINS)} coins
              ({formatDollarCents(coinsToDollarCents(MIN_PAYOUT_COINS))}).
            </p>
          ) : null}
          {coins > availableCoins ? (
            <p className="text-xs text-destructive">
              Exceeds cashable balance.
            </p>
          ) : null}

          <Button
            type="submit"
            variant="default"
            size="lg"
            className="mt-1 w-full"
            disabled={!isValid || mutation.isPending}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Requesting…
              </>
            ) : (
              <>
                <Banknote className="h-4 w-4" />
                Request payout · <CoinAmount cents={coins * 100} fractionDigits={0} />
              </>
            )}
          </Button>

          <p className="text-[11px] text-muted-foreground">
            Pending admin approval. You'll get a notification when the
            payout is processed.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
