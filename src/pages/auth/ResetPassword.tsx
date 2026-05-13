import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { supabase } from "@/integrations/supabase/client";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (code.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);

    // 1. Verify the recovery OTP — this signs the user in with a recovery session.
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "recovery",
    });
    if (verifyError) {
      setError(verifyError.message);
      setSubmitting(false);
      return;
    }

    // 2. Now we can update the password.
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    toast.success("Password updated");
    navigate("/", { replace: true });
  }

  return (
    <AuthLayout
      title="Reset password"
      subtitle="Enter the code from your email and a new password."
      footer={
        <Link
          to="/auth/forgot-password"
          className="underline-offset-4 hover:underline"
        >
          Resend code
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
            placeholder="you@example.com"
          />
        </div>
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
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="border-white/20 bg-white/10 text-center text-2xl font-bold tracking-[0.5em] text-white placeholder:text-white/40"
            placeholder="000000"
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            New password
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
            Confirm new password
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
            placeholder="Repeat your new password"
          />
        </div>
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
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
