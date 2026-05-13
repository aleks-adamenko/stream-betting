import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Mail, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthLayout, AuthTitle } from "@/components/layout/AuthLayout";
import { supabase } from "@/integrations/supabase/client";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }
    toast.success("Check your email", {
      description: "We sent you a 6-digit code to reset your password.",
    });
    navigate(`/auth/reset-password?email=${encodeURIComponent(email)}`);
  }

  return (
    <AuthLayout>
      <AuthTitle subtitle="Enter your email and we'll send you a 6-digit code to reset it.">
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
              Send reset code <Zap className="h-4 w-4 fill-current" />
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
