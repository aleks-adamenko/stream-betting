import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/**
 * Admin auth context — sibling of the studio AuthContext, but instead
 * of fetching a creator_profiles row to gate access we just call the
 * `is_admin()` RPC. Returns false when the caller's profile.role is
 * anything other than 'super_admin' (or no profile row exists).
 *
 * The TOKEN_REFRESHED / INITIAL_SESSION dedupe pattern is lifted
 * verbatim from studio — same reason: refocusing a tab fires a fake
 * SIGNED_IN-shaped event that would otherwise re-run the is_admin
 * check and flash the protected pages back to "loading".
 */

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** `false` means either not signed in OR signed in but not a super_admin. */
  isAdmin: boolean;
  loading: boolean;
  refreshAdmin: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadedForUserIdRef = useRef<string | null>(null);

  const fetchAdminFlag = useCallback(async () => {
    const { data, error } = await supabase.rpc("is_admin");
    if (error) {
      console.warn("is_admin RPC failed", error);
      setIsAdmin(false);
      return;
    }
    setIsAdmin(Boolean(data));
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user) {
        loadedForUserIdRef.current = data.session.user.id;
        void fetchAdminFlag().finally(() => {
          if (!cancelled) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        const nextUserId = nextSession?.user?.id ?? null;
        const prevUserId = loadedForUserIdRef.current;

        if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
          // Token refresh / boot: keep session reference current but
          // don't re-run the RPC or flip loading.
          setSession(nextSession);
          return;
        }

        if (event === "SIGNED_OUT" || !nextSession?.user) {
          setSession(null);
          setIsAdmin(false);
          loadedForUserIdRef.current = null;
          setLoading(false);
          return;
        }

        setSession(nextSession);
        if (nextUserId && nextUserId !== prevUserId) {
          setLoading(true);
          loadedForUserIdRef.current = nextUserId;
          void fetchAdminFlag().finally(() => {
            if (!cancelled) setLoading(false);
          });
        }
      },
    );

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [fetchAdminFlag]);

  const refreshAdmin = useCallback(async () => {
    if (session?.user) await fetchAdminFlag();
  }, [session, fetchAdminFlag]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isAdmin,
      loading,
      refreshAdmin,
      signOut,
    }),
    [session, isAdmin, loading, refreshAdmin, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
