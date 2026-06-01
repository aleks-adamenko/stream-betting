import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Mail, Lock, Eye, EyeOff, Zap } from "lucide-react";

import { Button, Input } from "@liverush/ui";
import { AuthLayout, AuthTitle } from "@/components/AuthLayout";
import { supabase } from "@/integrations/supabase/client";

/**
 * Admin sign-in is the only auth entry point — there's no public
 * sign-up route. Operators get provisioned via SQL by running:
 *   update public.profiles set role='super_admin' where id=<auth-uid>
 * and then sign in with their existing Supabase Auth credentials.
 *
 * The role check happens after sign-in via the is_admin() RPC inside
 * AuthContext; a non-admin who knows the URL still gets signed out
 * immediately by ProtectedRoute.
 */
export default function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    toast.success("Welcome back, admin");
    navigate(next, { replace: true });
  }

  return (
    <AuthLayout>
      <AuthTitle subtitle="Operator console for LiveRush.">
        Admin sign in
      </AuthTitle>

      <form onSubmit={handleSignIn} className="mt-6 space-y-4">
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
              placeholder="you@liverush.co"
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
              className="text-xs text-white/70 underline-offset-4 hover:text-white hover:underline"
            >
              Forgot?
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-white/20 bg-white/10 pl-9 pr-10 text-white placeholder:text-white/40"
              placeholder="Your password"
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
              Sign in
              <Zap className="h-4 w-4 fill-current" />
            </>
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-white/60">
        Access is restricted to LiveRush operators.
      </p>
    </AuthLayout>
  );
}
