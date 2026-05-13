import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { supabase } from "@/integrations/supabase/client";

export default function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }
    toast.success("Welcome back");
    navigate(next, { replace: true });
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back to LiveRush."
      footer={
        <>
          Don't have an account?{" "}
          <Link
            to={`/auth/sign-up${params.get("next") ? `?next=${params.get("next")}` : ""}`}
            className="font-semibold text-white underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSignIn} className="space-y-4">
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
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Link
              to="/auth/forgot-password"
              className="text-xs text-white/75 underline-offset-4 hover:text-white hover:underline"
            >
              Forgot?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
            placeholder="Your password"
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
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
