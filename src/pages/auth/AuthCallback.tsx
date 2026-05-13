import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";

/**
 * Catches Supabase redirect after email confirmation / OAuth.
 * Supabase JS auto-processes the hash fragment via getSession();
 * we just wait for auth state to settle, then bounce to the app.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const { loading, user } = useAuth();

  useEffect(() => {
    if (!loading) {
      navigate(user ? "/" : "/auth/sign-in", { replace: true });
    }
  }, [loading, user, navigate]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-[#1973FF] to-[#5048FF] text-white">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <p className="text-sm text-white/80">Signing you in…</p>
      </div>
    </div>
  );
}
