import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, Bitcoin, ChevronRight, Copy, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { notificationsKeys } from "@/hooks/useNotifications";
import {
  TOP_UP_MAX_CENTS,
  TOP_UP_MIN_CENTS,
  topUpBalance,
} from "@/services/balanceService";
import { cn } from "@/lib/utils";

type Currency = "usd" | "usdt";
type Step = "choose-currency" | "currency-flow";

const QUICK_AMOUNTS_CENTS = [1000, 5000, 10000, 50000];
const MOCK_USDT_ADDRESS = "0x7c8e9F4d2A1bE3CdA6f9B5c4e8D7a2F1B3E0c4A1";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface TopUpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional preset USD amount in cents. When provided, picking
   *  "USD" skips the amount-chooser screen entirely and credits the
   *  preset amount to the balance instantly. Used by the Get coins
   *  page, where the user has already chosen a coin pack (and thus
   *  the USD price) before opening this modal — re-asking them to
   *  pick an amount would be redundant. Omit for the Balance page,
   *  where USD top-up still goes through the amount picker. */
  presetAmountCents?: number;
}

export function TopUpModal({
  open,
  onOpenChange,
  presetAmountCents,
}: TopUpModalProps) {
  const [step, setStep] = useState<Step>("choose-currency");
  const [currency, setCurrency] = useState<Currency | null>(null);
  const { refreshProfile } = useAuth();
  const queryClient = useQueryClient();

  // Reset internal state whenever the modal closes so it always re-opens on
  // step 1.
  useEffect(() => {
    if (!open) {
      // Slight delay so the user doesn't see the step swap during the closing
      // animation.
      const t = window.setTimeout(() => {
        setStep("choose-currency");
        setCurrency(null);
      }, 200);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // USD instant-credit mutation — only fired when `presetAmountCents`
  // is set + the user picks USD on step 1. Lives at the modal level
  // (not inside UsdTopUpStep) because we never render UsdTopUpStep
  // in that flow; we close the modal on success and show a toast.
  //
  // Toast formatting is coin-flavoured, not dollar-flavoured: the
  // value the user just bought is X coins, not X dollars. The real
  // USD they paid is a separate concept and lives on the purchase
  // record / receipt, not in the in-app notification. balance_cents
  // is divided by 100 to get the user-visible coin count.
  const instantUsdMutation = useMutation({
    mutationFn: (cents: number) => topUpBalance(cents),
    onSuccess: async (data) => {
      await refreshProfile();
      void queryClient.invalidateQueries({ queryKey: notificationsKeys.mine() });
      const coinsAdded = (data.amount_cents / 100).toFixed(0);
      const newBalance = (data.new_balance_cents / 100).toFixed(2);
      toast.success(
        `+${coinsAdded} coins added — new balance ${newBalance}`,
      );
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Top-up failed");
    },
  });

  const handlePickCurrency = (c: Currency) => {
    // Get-coins flow: skip the USD picker entirely and credit the
    // preset amount immediately. The user already picked a pack +
    // saw the price on the previous screen, so a second amount
    // chooser would just be friction.
    if (c === "usd" && presetAmountCents != null) {
      instantUsdMutation.mutate(presetAmountCents);
      return;
    }
    setCurrency(c);
    setStep("currency-flow");
  };

  const handleBack = () => {
    setStep("choose-currency");
    setCurrency(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The X button is rendered inline in the headers so we hide the
        // built-in Radix close (none is included here anyway — explicit).
        className="overflow-hidden"
      >
        {step === "choose-currency" ? (
          <ChooseCurrencyStep onPick={handlePickCurrency} />
        ) : currency === "usd" ? (
          <UsdTopUpStep onBack={handleBack} onDone={() => onOpenChange(false)} />
        ) : (
          <UsdtReceiveStep onBack={handleBack} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- step 1 ---------- */

function ChooseCurrencyStep({ onPick }: { onPick: (c: Currency) => void }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <DialogTitle>Top up balance</DialogTitle>
          <DialogDescription className="mt-1">
            Pick the currency you want to add.
          </DialogDescription>
        </div>
        <DialogClose
          aria-label="Close"
          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </DialogClose>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <CurrencyRow
          icon={Banknote}
          iconClassName="bg-success/15 text-success"
          title="USD"
          subtitle="Add with card, Apple Pay, or bank transfer"
          onClick={() => onPick("usd")}
        />
        <CurrencyRow
          icon={Bitcoin}
          iconClassName="bg-primary/10 text-primary"
          title="USDT"
          subtitle="Deposit stablecoin to your wallet address"
          onClick={() => onPick("usdt")}
        />
      </div>
    </>
  );
}

function CurrencyRow({
  icon: Icon,
  iconClassName,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
    >
      <span
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full",
          iconClassName,
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-heading text-base font-semibold text-foreground">
          {title}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {subtitle}
        </p>
      </div>
      <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
    </button>
  );
}

/* ---------- step 2: USD ---------- */

function UsdTopUpStep({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: () => void;
}) {
  const { refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [amountCents, setAmountCents] = useState<number>(0);
  const [customText, setCustomText] = useState<string>("");

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
      onDone();
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
    const parsed = parseFloat(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) {
      setAmountCents(Math.round(parsed * 100));
    } else {
      setAmountCents(0);
    }
  };

  const tooLow = amountCents > 0 && amountCents < TOP_UP_MIN_CENTS;
  const tooHigh = amountCents > TOP_UP_MAX_CENTS;
  const canSubmit =
    amountCents >= TOP_UP_MIN_CENTS && !tooHigh && !mutation.isPending;

  return (
    <>
      <StepHeader title="Top up with USD" onBack={onBack} />

      {/* Quick amount chips */}
      <div className="mt-2">
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
      <div>
        <label
          htmlFor="modal-custom-amount"
          className="text-sm font-medium text-foreground"
        >
          Custom amount
        </label>
        <div className="relative mt-2">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base font-semibold text-muted-foreground">
            $
          </span>
          <Input
            id="modal-custom-amount"
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

      <Button
        variant="accent"
        size="lg"
        className="w-full"
        disabled={!canSubmit}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending
          ? "Adding…"
          : amountCents > 0
            ? `Add ${dollars(amountCents)} to balance`
            : "Choose an amount"}
      </Button>
    </>
  );
}

/* ---------- step 2: USDT ---------- */

function UsdtReceiveStep({ onBack }: { onBack: () => void }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(MOCK_USDT_ADDRESS);
      toast.success("Wallet address copied");
    } catch {
      toast.error("Couldn't copy — long-press to copy manually");
    }
  };

  return (
    <>
      <StepHeader title="Send USDT" onBack={onBack} />

      <p className="text-sm leading-relaxed text-muted-foreground">
        This is your non-custodial wallet address. Send any EVM token directly
        here.
      </p>

      <div className="flex justify-center py-2">
        <MockQR className="h-44 w-44 sm:h-48 sm:w-48" />
      </div>

      <div className="rounded-xl border border-border/40 bg-muted/40 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Wallet address
        </p>
        <p className="mt-1 break-all font-mono text-xs text-foreground sm:text-sm">
          {MOCK_USDT_ADDRESS}
        </p>
      </div>

      <Button variant="accent" size="lg" className="w-full" onClick={handleCopy}>
        <Copy className="h-4 w-4" />
        Copy address
      </Button>
    </>
  );
}

/* ---------- shared header for step-2 screens ---------- */

function StepHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="-mx-2 -mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="inline-flex h-9 items-center gap-1 rounded-full px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>
        <DialogClose
          aria-label="Close"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </DialogClose>
      </div>
      <DialogTitle className="mt-2 text-lg">{title}</DialogTitle>
    </div>
  );
}

/* ---------- mock QR component ---------- */

const QR_SIZE = 25;

function positionMarkerCell(x: number, y: number): boolean | null {
  let lx = -1;
  let ly = -1;
  if (x < 7 && y < 7) {
    lx = x;
    ly = y;
  } else if (x >= QR_SIZE - 7 && y < 7) {
    lx = x - (QR_SIZE - 7);
    ly = y;
  } else if (x < 7 && y >= QR_SIZE - 7) {
    lx = x;
    ly = y - (QR_SIZE - 7);
  } else {
    return null;
  }
  // Outer 7x7 border = black, 5x5 white ring inside, 3x3 black center
  if (lx === 0 || lx === 6 || ly === 0 || ly === 6) return true;
  if (lx === 1 || lx === 5 || ly === 1 || ly === 5) return false;
  return true;
}

function inMarkerRing(x: number, y: number): boolean {
  // 1-cell white ring around each position marker.
  return (
    (x < 8 && y < 8) ||
    (x >= QR_SIZE - 8 && y < 8) ||
    (x < 8 && y >= QR_SIZE - 8)
  );
}

function MockQR({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/40 bg-white p-3 shadow-sm",
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`}
        className="block h-full w-full"
        aria-label="Wallet address QR code"
        role="img"
      >
        {Array.from({ length: QR_SIZE }).map((_, y) =>
          Array.from({ length: QR_SIZE }).map((__, x) => {
            const marker = positionMarkerCell(x, y);
            let on: boolean;
            if (marker !== null) {
              on = marker;
            } else if (inMarkerRing(x, y)) {
              on = false;
            } else {
              // Deterministic noise pattern that looks QR-ish.
              const seed = (x * 7 + y * 31 + x * y * 3) >>> 0;
              on = seed % 3 === 0;
            }
            if (!on) return null;
            return (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width={1}
                height={1}
                fill="#0F172A"
              />
            );
          }),
        )}
      </svg>
    </div>
  );
}
