import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Bitcoin,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Loader2,
  QrCode,
  X,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

type Currency = "usd" | "usdt";
type Step = "choose-currency" | "currency-flow";
type EmailState = "idle" | "sending" | "ready" | "verifying" | "verified";
type AuthState = "idle" | "verifying" | "verified";

const OTP_LENGTH = 6;
const MOCK_USD_CARD = {
  brand: "Visa",
  last4: "4242",
  expiry: "09/27",
  holder: "Sarah Johnson",
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface WithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usdCents: number;
  usdtCents: number;
}

export function WithdrawModal({
  open,
  onOpenChange,
  usdCents,
  usdtCents,
}: WithdrawModalProps) {
  const [step, setStep] = useState<Step>("choose-currency");
  const [currency, setCurrency] = useState<Currency | null>(null);

  // Reset to step 1 whenever the modal closes (after the close animation).
  useEffect(() => {
    if (!open) {
      const t = window.setTimeout(() => {
        setStep("choose-currency");
        setCurrency(null);
      }, 200);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const handlePick = (c: Currency) => {
    setCurrency(c);
    setStep("currency-flow");
  };

  const handleBack = () => {
    setStep("choose-currency");
    setCurrency(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {step === "choose-currency" ? (
          <ChooseCurrencyStep
            usdCents={usdCents}
            usdtCents={usdtCents}
            onPick={handlePick}
          />
        ) : (
          <WithdrawFlowStep
            currency={currency!}
            balanceCents={currency === "usd" ? usdCents : usdtCents}
            onBack={handleBack}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- step 1 ---------- */

function ChooseCurrencyStep({
  usdCents,
  usdtCents,
  onPick,
}: {
  usdCents: number;
  usdtCents: number;
  onPick: (c: Currency) => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <DialogTitle>Withdraw</DialogTitle>
          <DialogDescription className="mt-1">
            Pick the currency you want to withdraw.
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
          subtitle="Withdraw to your card"
          balance={dollars(usdCents)}
          onClick={() => onPick("usd")}
        />
        <CurrencyRow
          icon={Bitcoin}
          iconClassName="bg-primary/10 text-primary"
          title="USDT"
          subtitle="Send to an EVM wallet"
          balance={dollars(usdtCents)}
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
  balance,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  title: string;
  subtitle: string;
  balance: string;
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
      <div className="flex flex-shrink-0 items-center gap-1">
        <span className="font-heading text-sm font-bold tabular-nums text-foreground">
          {balance}
        </span>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </div>
    </button>
  );
}

/* ---------- step 2 ---------- */

function WithdrawFlowStep({
  currency,
  balanceCents,
  onBack,
  onDone,
}: {
  currency: Currency;
  balanceCents: number;
  onBack: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailState, setEmailState] = useState<EmailState>("idle");
  const [authCode, setAuthCode] = useState("");
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [destAddress, setDestAddress] = useState("");
  const [amountText, setAmountText] = useState("");

  // Parse the amount input into cents for validation + display.
  const amountCents = (() => {
    const parsed = parseFloat(amountText.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) && parsed > 0
      ? Math.round(parsed * 100)
      : 0;
  })();

  const emailFilled = email.trim().length > 0;
  const codeFilled = emailCode.trim().length > 0;
  const authCodeFilled = authCode.length === OTP_LENGTH;
  const destFilled = destAddress.trim().length > 0;
  const amountValid = amountCents > 0 && amountCents <= balanceCents;

  // Send-code is only available in the idle state once the email is filled.
  const canSendCode = emailFilled && emailState === "idle";
  // Verify-email becomes available once the code has been received and typed.
  const canVerifyEmail = codeFilled && emailState === "ready";
  // Verify-auth-code is available once the 6-digit code is filled.
  const canVerifyAuth = authCodeFilled && authState === "idle";

  const canWithdraw =
    emailState === "verified" &&
    authState === "verified" &&
    amountValid &&
    (currency === "usd" || destFilled);

  const handleMax = () => {
    setAmountText((balanceCents / 100).toFixed(2));
  };

  // Mock "send code" — show a brief loader, then reveal the code input.
  const handleSendCode = async () => {
    setEmailState("sending");
    await new Promise((r) => window.setTimeout(r, 800));
    setEmailState("ready");
    toast.success("Verification code sent");
  };
  const handleVerifyEmail = async () => {
    setEmailState("verifying");
    await new Promise((r) => window.setTimeout(r, 600));
    setEmailState("verified");
    toast.success("Email verified");
  };
  const handleVerifyAuthCode = async () => {
    setAuthState("verifying");
    await new Promise((r) => window.setTimeout(r, 600));
    setAuthState("verified");
    toast.success("Authenticator code verified");
  };
  const handleScanQr = () => {
    toast.info("QR scanner coming soon");
  };

  const handleWithdraw = () => {
    if (!canWithdraw) return;
    toast.success(
      `Withdrawal of ${dollars(amountCents)} ${currency.toUpperCase()} initiated`,
      {
        description:
          currency === "usd"
            ? `To ${MOCK_USD_CARD.brand} •••• ${MOCK_USD_CARD.last4}`
            : `To ${destAddress.slice(0, 6)}…${destAddress.slice(-4)}`,
      },
    );
    onDone();
  };

  // The email input is only editable in the idle state — once "Send code" is
  // pressed we lock it so the verification matches what was sent.
  const emailInputLocked = emailState !== "idle";
  const codeInputVisible =
    emailState === "ready" ||
    emailState === "verifying" ||
    emailState === "verified";

  return (
    <>
      <StepHeader
        title={currency === "usd" ? "Withdraw USD" : "Withdraw USDT"}
        onBack={onBack}
      />

      {/* Verify email */}
      <section className="space-y-3">
        <h3 className="font-heading text-sm font-semibold text-foreground">
          Verify email
        </h3>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={emailInputLocked}
          className="h-11"
        />

        {codeInputVisible && (
          <Input
            inputMode="numeric"
            maxLength={8}
            placeholder="Verification code"
            value={emailCode}
            onChange={(e) =>
              setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 8))
            }
            disabled={emailState === "verified"}
            className="h-11 tabular-nums"
          />
        )}

        {emailState === "verified" ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            Email verified
          </p>
        ) : codeInputVisible ? (
          <Button
            size="default"
            className="w-full"
            disabled={!canVerifyEmail || emailState === "verifying"}
            onClick={handleVerifyEmail}
          >
            {emailState === "verifying" ? (
              <>
                <Loader2 className="animate-spin" />
                Verifying…
              </>
            ) : (
              "Verify Email"
            )}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="default"
            className="w-full"
            disabled={!canSendCode || emailState === "sending"}
            onClick={handleSendCode}
          >
            {emailState === "sending" ? (
              <>
                <Loader2 className="animate-spin" />
                Sending…
              </>
            ) : (
              "Send code"
            )}
          </Button>
        )}
      </section>

      {/* Authenticator */}
      <section className="space-y-3">
        <h3 className="font-heading text-sm font-semibold text-foreground">
          Authenticator
        </h3>
        <p className="text-xs text-muted-foreground">
          Enter the 6-digit code from your authenticator app.
        </p>

        {/* Single input — placeholder shows six transparent 0s; tracking
            spreads typed digits so they read as distinct slots. */}
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          placeholder="000000"
          value={authCode}
          onChange={(e) =>
            setAuthCode(
              e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH),
            )
          }
          disabled={authState === "verified"}
          aria-label="Authenticator code"
          className="block h-14 w-full rounded-lg border-2 border-border bg-card text-center font-heading text-3xl font-bold tabular-nums tracking-[0.5em] transition-colors placeholder:font-heading placeholder:font-bold placeholder:text-muted-foreground/25 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60 sm:h-16 sm:text-4xl"
        />

        {authState === "verified" ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            Authenticator verified
          </p>
        ) : (
          <Button
            size="default"
            className="w-full"
            disabled={!canVerifyAuth || authState === "verifying"}
            onClick={handleVerifyAuthCode}
          >
            {authState === "verifying" ? (
              <>
                <Loader2 className="animate-spin" />
                Verifying…
              </>
            ) : (
              "Verify Authenticator Code"
            )}
          </Button>
        )}
      </section>

      {/* Destination Address — USDT only */}
      {currency === "usdt" && (
        <section className="space-y-3">
          <h3 className="font-heading text-sm font-semibold text-foreground">
            Destination address
          </h3>
          <div className="relative">
            <Input
              placeholder="Paste or scan EVM wallet"
              value={destAddress}
              onChange={(e) => setDestAddress(e.target.value)}
              className="h-11 pr-11 font-mono text-xs sm:text-sm"
            />
            <button
              type="button"
              onClick={handleScanQr}
              aria-label="Scan QR code"
              className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            >
              <QrCode className="h-5 w-5" />
            </button>
          </div>
        </section>
      )}

      {/* Amount */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm font-semibold text-foreground">
            Amount
          </h3>
          <span className="text-xs text-muted-foreground">
            Available{" "}
            <span className="font-bold tabular-nums text-foreground">
              {dollars(balanceCents)}
            </span>
          </span>
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base font-semibold text-muted-foreground">
            $
          </span>
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={amountText}
            onChange={(e) =>
              setAmountText(e.target.value.replace(/[^0-9.]/g, ""))
            }
            className="h-12 pl-7 pr-16 text-base tabular-nums"
          />
          <button
            type="button"
            onClick={handleMax}
            className="absolute right-1 top-1/2 inline-flex h-9 -translate-y-1/2 items-center justify-center rounded-md bg-primary/10 px-2.5 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/15"
          >
            MAX
          </button>
        </div>
        {amountCents > balanceCents && (
          <p className="text-xs text-destructive">
            Exceeds available balance.
          </p>
        )}
      </section>

      {/* Details card */}
      {currency === "usdt" ? (
        <div className="rounded-xl border border-border/40 bg-muted/40 p-4">
          <DetailRow
            label="Destination wallet address"
            value={
              destAddress
                ? `${destAddress.slice(0, 8)}…${destAddress.slice(-6)}`
                : "—"
            }
            mono
          />
          <DetailRow label="Network" value="Ethereum (EVM)" />
          <DetailRow label="Token" value="USDT (ERC-20)" />
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/40 p-4">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CreditCard className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-semibold text-foreground">
              {MOCK_USD_CARD.brand} •••• {MOCK_USD_CARD.last4}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {MOCK_USD_CARD.holder} · Expires {MOCK_USD_CARD.expiry}
            </p>
          </div>
        </div>
      )}

      <Button
        variant="accent"
        size="lg"
        className="w-full"
        disabled={!canWithdraw}
        onClick={handleWithdraw}
      >
        Withdraw {amountCents > 0 ? dollars(amountCents) : ""}
      </Button>
    </>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/30 py-2 last:border-0 last:pb-0 first:pt-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 text-right text-xs font-medium text-foreground",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ---------- shared header for step-2 ---------- */

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
