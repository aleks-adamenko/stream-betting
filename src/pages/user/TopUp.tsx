import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Wallet, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/PageContainer";
import { useAuth } from "@/contexts/AuthContext";
import {
  topUpBalance,
  TOP_UP_MIN_CENTS,
  TOP_UP_MAX_CENTS,
} from "@/services/balanceService";
import { notificationsKeys } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

const QUICK_AMOUNTS_CENTS = [1000, 5000, 10000, 50000];

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function TopUp() {
  const { profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [amountCents, setAmountCents] = useState<number>(0);
  const [customText, setCustomText] = useState<string>("");

  const balance = profile?.balance_cents ?? 0;

  const mutation = useMutation({
    mutationFn: () => topUpBalance(amountCents),
    onSuccess: async (data) => {
      await refreshProfile();
      void queryClient.invalidateQueries({ queryKey: notificationsKeys.mine() });
      toast.success(
        `+${dollars(data.amount_cents)} added — new balance ${dollars(
          data.new_balance_cents,
        )}`,
      );
      setAmountCents(0);
      setCustomText("");
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Top-up failed";
      toast.error(message);
    },
  });

  const handleQuick = (cents: number) => {
    setAmountCents(cents);
    setCustomText("");
  };

  const handleCustom = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    setCustomText(cleaned);
    const dollars = parseFloat(cleaned);
    if (Number.isFinite(dollars) && dollars > 0) {
      setAmountCents(Math.round(dollars * 100));
    } else {
      setAmountCents(0);
    }
  };

  const tooLow = amountCents > 0 && amountCents < TOP_UP_MIN_CENTS;
  const tooHigh = amountCents > TOP_UP_MAX_CENTS;
  const canSubmit =
    amountCents >= TOP_UP_MIN_CENTS && !tooHigh && !mutation.isPending;

  return (
    <PageContainer className="lg:pt-[18px]">
      <div className="mx-auto w-full max-w-md">
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Top up balance</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Add virtual funds to bet on live challenges.
        </p>

        {/* Current balance card */}
        <div className="mt-6 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Wallet className="h-4 w-4" />
            <span className="text-sm font-medium">Your balance</span>
          </div>
          <p className="mt-2 font-heading text-4xl font-bold tabular-nums text-foreground">
            {dollars(balance)}
          </p>
        </div>

        {/* Quick amount chips */}
        <div className="mt-6">
          <p className="text-sm font-medium text-foreground">Quick amount</p>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {QUICK_AMOUNTS_CENTS.map((cents) => {
              const selected = amountCents === cents && customText === "";
              return (
                <button
                  key={cents}
                  type="button"
                  onClick={() => handleQuick(cents)}
                  className={cn(
                    "h-11 rounded-lg border text-sm font-bold tabular-nums transition-colors",
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground hover:bg-secondary/40",
                  )}
                >
                  ${cents / 100}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom amount input */}
        <div className="mt-5">
          <label htmlFor="custom-amount" className="text-sm font-medium text-foreground">
            Custom amount
          </label>
          <div className="relative mt-2">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base font-semibold text-muted-foreground">
              $
            </span>
            <Input
              id="custom-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={customText}
              onChange={(e) => handleCustom(e.target.value)}
              className="h-12 pl-7 text-base tabular-nums"
            />
          </div>
          {tooLow && (
            <p className="mt-1 text-xs text-destructive">Minimum $1.00</p>
          )}
          {tooHigh && (
            <p className="mt-1 text-xs text-destructive">
              Maximum {dollars(TOP_UP_MAX_CENTS)} per top-up
            </p>
          )}
        </div>

        {/* CTA */}
        <Button
          variant="accent"
          size="lg"
          className="mt-6 w-full"
          disabled={!canSubmit}
          onClick={() => mutation.mutate()}
        >
          <Sparkles className="h-4 w-4" />
          {mutation.isPending
            ? "Adding…"
            : amountCents > 0
              ? `Add ${dollars(amountCents)} to balance`
              : "Choose an amount"}
        </Button>

        {/* Disclaimer */}
        <p className="mt-4 rounded-xl border border-border/30 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          Virtual prototype balance — no real payment is taken. Funds are for
          testing bet flows only.
        </p>
      </div>
    </PageContainer>
  );
}
