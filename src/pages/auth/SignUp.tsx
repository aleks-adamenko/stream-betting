import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Mail, Lock, Eye, EyeOff, Zap, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthLayout, AuthTitle, AuthDivider } from "@/components/layout/AuthLayout";
import { supabase } from "@/integrations/supabase/client";

type Step = "form" | "check-email";

export default function SignUp() {
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";

  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accept, setAccept] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }
    toast.success("Check your inbox", {
      description: "Click the confirm link in the email we sent.",
    });
    setStep("check-email");
  }

  async function resendEmail() {
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resend({
      email,
      type: "signup",
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setSubmitting(false);
    if (error) {
      console.error("resend error", error);
      setError(error.message);
    } else {
      toast.success("Email re-sent. Check your inbox.");
    }
  }

  function handleGoogle() {
    toast("Google sign-up coming soon", {
      description: "We'll enable it once the Google OAuth provider is configured.",
    });
  }

  if (step === "check-email") {
    return (
      <AuthLayout>
        <AuthTitle>Check your email</AuthTitle>

        <div className="mt-6 flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FEE53A]/15 ring-2 ring-[#FEE53A]/30">
            <MailCheck className="h-8 w-8 text-[#FEE53A]" />
          </div>
          <p className="mt-4 text-sm text-white/85">
            We sent a confirmation link to
          </p>
          <p className="font-heading text-base font-bold text-white">{email}</p>
          <p className="mt-3 text-sm text-white/75">
            Open the email and click <span className="font-semibold">Confirm</span> to finish signing up.
          </p>
        </div>

        {error && (
          <p className="mt-6 rounded-lg bg-destructive/30 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={resendEmail}
          disabled={submitting}
          className="mt-6 w-full gap-2 border-white/30 bg-white/[0.04] text-base text-white hover:bg-white/10 hover:text-white"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Didn't get it? Resend email"
          )}
        </Button>

        <p className="mt-4 text-center text-sm text-white/75">
          <button
            type="button"
            onClick={() => setStep("form")}
            className="font-bold text-[#FEE53A] underline-offset-4 hover:underline"
          >
            Use a different email
          </button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthTitle>Create account</AuthTitle>

      <form onSubmit={handleSignUp} className="mt-6 space-y-4">
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
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-white/20 bg-white/10 pl-9 pr-10 text-white placeholder:text-white/40"
              placeholder="At least 6 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm" className="text-sm font-medium">
            Confirm password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <Input
              id="confirm"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="border-white/20 bg-white/10 pl-9 pr-10 text-white placeholder:text-white/40"
              placeholder="Repeat your password"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white"
              aria-label={showConfirm ? "Hide password" : "Show password"}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-white/40 bg-white/10 accent-[#FEE53A]"
          />
          <span>I am 18+ and accept the LiveRush Terms and Responsible Play policy.</span>
        </label>

        {error && (
          <p className="rounded-lg bg-destructive/30 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full gap-2 text-base text-[#1F2679] ring-0 hover:text-[#1F2679]"
          style={{ backgroundColor: "#FEE53A", backgroundImage: "none" }}
          disabled={submitting}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Create account <Zap className="h-4 w-4 fill-current" />
            </>
          )}
        </Button>
      </form>

      <div className="mt-6">
        <AuthDivider />
      </div>

      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={handleGoogle}
        className="mt-6 w-full gap-3 border-white/30 bg-white/[0.04] text-base text-white hover:bg-white/10 hover:text-white"
      >
        <GoogleIcon className="h-5 w-5" />
        Continue with Google
      </Button>

      <p className="mt-6 text-center text-sm text-white/75">
        Already have an account?{" "}
        <Link
          to="/auth/sign-in"
          className="font-bold text-[#FEE53A] underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20.4H24v7.2h11c-1.5 4.2-5.5 7.2-10.6 7.2-6.4 0-11.6-5.2-11.6-11.6S18 11.6 24 11.6c2.9 0 5.6 1.1 7.6 2.9l5.1-5.1C33.3 6.3 28.9 4.4 24 4.4 13.2 4.4 4.4 13.2 4.4 24S13.2 43.6 24 43.6c11 0 19.6-8 19.6-19.6 0-1.2-.1-2.3-.3-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l5.9 4.3C13.7 15.5 18.5 12.6 24 12.6c2.9 0 5.6 1.1 7.6 2.9l5.1-5.1C33.3 7.3 28.9 5.4 24 5.4 16.4 5.4 9.9 9.6 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 43.6c4.7 0 9-1.7 12.4-4.5l-5.7-4.7c-2 1.4-4.4 2.2-6.7 2.2-5 0-9.1-3-10.6-7.1l-5.9 4.5C9.6 39.6 16.2 43.6 24 43.6z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20.4H24v7.2h11c-.7 2-2 3.8-3.7 5l5.7 4.7c-.4.4 6-4.3 6-13.3 0-1.2-.1-2.3-.3-3.5z"
      />
    </svg>
  );
}
