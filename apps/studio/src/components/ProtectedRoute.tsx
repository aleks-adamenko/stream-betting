import { Loader2 } from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: ReactNode;
  /** When true (default), redirects authenticated-but-no-creator users to
   *  /onboarding. Set false on /onboarding itself to break the loop. */
  requireOnboarding?: boolean;
}

/**
 * Two-stage gate:
 *  1. Unauthenticated → /auth/sign-in?next=<current>
 *  2. Authenticated but creator_profiles row missing → /onboarding
 *
 * Set `requireOnboarding={false}` for the /onboarding page so it can render
 * before the row exists.
 */
export function ProtectedRoute({
  children,
  requireOnboarding = true,
}: ProtectedRouteProps) {
  const { user, creator, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth/sign-in?next=${next}`} replace />;
  }

  if (requireOnboarding && !creator) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
