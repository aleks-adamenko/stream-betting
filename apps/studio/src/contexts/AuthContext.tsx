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
import type { Database } from "@/integrations/supabase/types";

type CreatorProfile = Database["public"]["Tables"]["creator_profiles"]["Row"];

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** `null` means either not signed in OR signed in but onboarding not yet
   *  completed. Distinguish via `loading` + `user`. */
  creator: CreatorProfile | null;
  loading: boolean;
  refreshCreator: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // Track which user-id's creator row we've already loaded so we don't
  // refetch on every TOKEN_REFRESHED event (those fire on tab refocus
  // and on the auto-refresh interval — see the dedupe logic below).
  const loadedForUserIdRef = useRef<string | null>(null);

  const fetchCreator = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("creator_profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      // Row may simply not exist yet (pre-onboarding) — that's expected.
      // Other errors get logged.
      if (error.code !== "PGRST116") {
        console.warn("Failed to load creator profile", error);
      }
      setCreator(null);
      return;
    }
    setCreator(data ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user) {
        loadedForUserIdRef.current = data.session.user.id;
        void fetchCreator(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Supabase auth-js fires onAuthStateChange for several events that
      // don't change *who* is signed in — most notably TOKEN_REFRESHED
      // (every ~1 hour AND on every tab refocus while autoRefreshToken
      // is on). If we naively re-setSession + re-fetchCreator on every
      // one of those, every consumer of AuthContext re-renders and
      // pages flicker / look like they reload. Dedupe by user id.
      const nextUserId = nextSession?.user?.id ?? null;
      const prevUserId = loadedForUserIdRef.current;

      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        // Token-only / boot-time events: refresh the session reference
        // so any consumer that reads `session.access_token` stays
        // current, but DO NOT refetch the creator profile and DO NOT
        // flip `loading`.
        setSession(nextSession);
        return;
      }

      if (event === "SIGNED_OUT" || !nextSession?.user) {
        setSession(null);
        setCreator(null);
        loadedForUserIdRef.current = null;
        setLoading(false);
        return;
      }

      // SIGNED_IN / USER_UPDATED — only do real work if the user
      // actually changed. Supabase sometimes re-fires SIGNED_IN on
      // tab refocus too (depending on storage state); guard against it.
      setSession(nextSession);
      if (nextUserId && nextUserId !== prevUserId) {
        setLoading(true);
        loadedForUserIdRef.current = nextUserId;
        void fetchCreator(nextUserId).finally(() => {
          if (!cancelled) setLoading(false);
        });
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [fetchCreator]);

  const refreshCreator = useCallback(async () => {
    if (session?.user) await fetchCreator(session.user.id);
  }, [session, fetchCreator]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      creator,
      loading,
      refreshCreator,
      signOut,
    }),
    [session, creator, loading, refreshCreator, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
