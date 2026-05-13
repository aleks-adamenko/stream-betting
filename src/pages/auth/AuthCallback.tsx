import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";

/**
 * Handles the redirect after a user clicks the confirmation link
 * in their email. Supabase can use either:
 *  - PKCE flow: ?code=xxx in the query string  → exchange for session
 *  - Implicit flow: #access_token=...&type=signup in the URL hash → SDK auto-detects
 * In both cases, by the time we land here the session should resolve.
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

      // 1. PKCE flow — exchange the code for a session.
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          if (!cancelled) setError(error.message);
          return;
        }
      }

      // 2. After either flow, getSession() should return the active session.
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
