import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import type { ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Two-stage gate:
 *   1. Unauthenticated → /auth/sign-in?next=<current>
 *   2. Authenticated but not super_admin → sign them out + toast, then
 *      bounce to /auth/sign-in. We sign them out because the admin app
 *      is operator-only; a logged-in non-admin session has nothing to
 *      do here and would only confuse them on the next visit.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();

  // Side effect runs only when we've confirmed the user is signed in
  // but isn't an admin — we drop the session before redirecting so the
  // sign-in page renders fresh instead of looping through the gate.
  useEffect(() => {
    if (!loading && user && !isAdmin) {
      toast.error("This account is not an admin.");
      void supabase.auth.signOut();
    }
  }, [loading, user, isAdmin]);

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

  if (!isAdmin) {
    // signOut() above will trigger an onAuthStateChange that drops user
    // back to null; until then, render a redirect so we don't show the
    // protected layout to a non-admin.
    return <Navigate to="/auth/sign-in" replace />;
  }

  return <>{children}</>;
}
