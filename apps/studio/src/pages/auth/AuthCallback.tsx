import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";

/**
 * Handles the redirect after a user clicks the magic link in their
 * confirmation / password-reset email. Same pattern as the user-app:
 *   - PKCE: ?code=xxx → exchangeCodeForSession
 *   - Implicit: #access_token=... → SDK auto-detects
 *
 * After resolution we navigate to ?next= (default "/"). The downstream
 * ProtectedRoute then routes the user to /onboarding if they don't yet
 * have a creator_profiles row.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const next = params.get("next") || "/";
      const code = params.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          if (!cancelled) setError(error.message);
          return;
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        if (!cancelled) setError(sessionError.message);
        return;
      }

      if (!cancelled) {
        navigate(data.session ? next : "/auth/sign-in", { replace: true });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [navigate, params]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-r from-[#1973FF] to-[#5048FF] text-white">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        {error ? (
          <>
            <p className="font-heading text-lg font-semibold">
              We couldn't confirm your email
            </p>
            <p className="text-sm text-white/80">{error}</p>
            <button
              type="button"
              onClick={() => navigate("/auth/sign-in", { replace: true })}
              className="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
            >
              Go to sign in
            </button>
          </>
        ) : (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <p className="text-sm text-white/80">Signing you in…</p>
          </>
        )}
      </div>
    </div>
  );
}
