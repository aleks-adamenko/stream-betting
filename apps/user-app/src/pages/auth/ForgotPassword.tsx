import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Mail, MailCheck, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthLayout, AuthTitle } from "@/components/layout/AuthLayout";
import { supabase } from "@/integrations/supabase/client";

/**
 * Step 1 of password recovery.
 *
 * Mirrors the sign-up flow: we ask for an email, Supabase sends a magic
 * link that redirects to `/auth/callback?next=/auth/reset-password`,
 * `AuthCallback` exchanges the token for a session, and `ResetPassword`
 * then shows a new-password form because the session exists. Same
 * verification primitive as sign-up — one code path, one place to debug.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
    "/auth/reset-password",
  )}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  async function handleResend() {
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
    } else {
      toast.success("Email re-sent. Check your inbox.");
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <AuthTitle>Check your email</AuthTitle>

        <div className="mt-6 flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FEE53A]/15 ring-2 ring-[#FEE53A]/30">
            <MailCheck className="h-8 w-8 text-[#FEE53A]" />
          </div>
          <p className="mt-4 text-sm text-white/85">
            We sent a password-reset link to
          </p>
          <p className="font-heading text-base font-bold text-white">{email}</p>
          <p className="mt-3 text-sm text-white/75">
            Click the link in the email to choose a new password.
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
          onClick={handleResend}
          disabled={submitting}
          className="mt-6 w-full gap-2 border-white/30 bg-white/[0.04] text-base text-white hover:bg-white/10 hover:text-white"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Didn't get it? Resend email"
          )}
        </Button>

        <p className="mt-6 text-center text-sm text-white/75">
          <Link
            to="/auth/sign-in"
            className="font-bold text-[#FEE53A] underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthTitle subtitle="Enter your email and we'll send you a link to reset your password.">
        Forgot password
      </AuthTitle>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              Send reset link <Zap className="h-4 w-4 fill-current" />
            </>
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-white/75">
        Remembered it?{" "}
        <Link to="/auth/sign-in" className="font-bold text-[#FEE53A] underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
