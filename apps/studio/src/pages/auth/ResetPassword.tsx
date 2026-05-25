import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, Lock, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button, Input } from "@liverush/ui";
import { AuthLayout, AuthTitle } from "@/components/AuthLayout";
import { supabase } from "@/integrations/supabase/client";

export default function ResetPassword() {
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.session) {
        setLinkInvalid(true);
      }
      setCheckingSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
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

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    toast.success("Password updated");
    navigate("/", { replace: true });
  }

  if (checkingSession) {
    return (
      <AuthLayout>
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-white/70" />
        </div>
      </AuthLayout>
    );
  }

  if (linkInvalid) {
    return (
      <AuthLayout>
        <AuthTitle subtitle="This reset link is invalid or has expired. Request a fresh one to continue.">
          Reset link expired
        </AuthTitle>

        <Button
          asChild
          size="lg"
          className="mt-6 w-full gap-2 text-base text-[#1F2679] ring-0 hover:text-[#1F2679]"
          style={{ backgroundColor: "#FEE53A", backgroundImage: "none" }}
        >
          <Link to="/auth/forgot-password">
            Request a new link <Zap className="h-4 w-4 fill-current" />
          </Link>
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
      <AuthTitle subtitle="Choose a new password for your account.">
        Reset password
      </AuthTitle>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            New password
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
            Confirm new password
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
              placeholder="Repeat your new password"
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
              Update password <Zap className="h-4 w-4 fill-current" />
            </>
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-white/75">
        <Link
          to="/auth/forgot-password"
          className="font-bold text-[#FEE53A] underline-offset-4 hover:underline"
        >
          Request a new link
        </Link>
      </p>
    </AuthLayout>
  );
}
