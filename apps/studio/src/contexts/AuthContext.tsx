import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
        void fetchCreator(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        void fetchCreator(nextSession.user.id);
      } else {
        setCreator(null);
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
