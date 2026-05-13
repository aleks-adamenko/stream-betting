import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { supabase } from "@/integrations/supabase/client";

type Step = "form" | "verify";

export default function SignUp() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";

  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accept, setAccept] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (!accept) {
      setError("You must accept the terms to continue.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }
    toast.success("Check your inbox", {
      description: "We sent you a 6-digit code to confirm your email.",
    });
    setStep("verify");
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }
    toast.success("Welcome to LiveRush ⚡");
    navigate(next, { replace: true });
  }

  async function resendCode() {
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resend({ email, type: "signup" });
    setSubmitting(false);
    if (error) setError(error.message);
    else toast.success("Code re-sent. Check your email.");
  }

  if (step === "verify") {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={`We sent a 6-digit code to ${email}. Paste it below to finish signing up.`}
        footer={
          <button
            type="button"
            onClick={() => setStep("form")}
            className="underline-offset-4 hover:underline"
          >
            Use a different email
          </button>
        }
      >
        <form onSubmit={handleVerify} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="code" className="text-sm font-medium">
              6-digit code
            </label>
            <Input
              id="code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="border-white/20 bg-white/10 text-center text-2xl font-bold tracking-[0.5em] text-white placeholder:text-white/40"
              placeholder="000000"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive-foreground bg-destructive/30 rounded-lg px-3 py-2">{error}</p>}
          <Button
            type="submit"
            size="lg"
            className="w-full text-base text-[#1F2679] ring-0 hover:text-[#1F2679]"
            style={{ backgroundColor: "#FEE53A", backgroundImage: "none" }}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm email"}
          </Button>
          <button
            type="button"
            onClick={resendCode}
            disabled={submitting}
            className="block w-full text-center text-sm text-white/75 hover:text-white"
          >
            Didn't get it? Resend code
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start with $1,000 virtual balance. Bet on real-life challenges."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/auth/sign-in" className="font-semibold text-white underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSignUp} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-white/20 bg-white/10 pl-9 text-white placeholder:text-white/40"
              placeholder="you@example.com"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
            placeholder="At least 6 characters"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="confirm" className="text-sm font-medium">
            Confirm password
          </label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
            placeholder="Repeat your password"
          />
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-white/40 bg-white/10 accent-[#FEE53A]"
          />
          <span>
            I am 18+ and accept the LiveRush Terms and Responsible Play policy.
          </span>
        </label>
        {error && (
          <p className="rounded-lg bg-destructive/30 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="w-full text-base text-[#1F2679] ring-0 hover:text-[#1F2679]"
          style={{ backgroundColor: "#FEE53A", backgroundImage: "none" }}
          disabled={submitting}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
