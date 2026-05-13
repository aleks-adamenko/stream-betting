import { Link } from "react-router-dom";
import { LogOut, Wallet, ListChecks } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";

export function SideNavUserCard() {
  const { profile, user, signOut } = useAuth();
  const balanceDollars = (profile?.balance_cents ?? 0) / 100;
  const initials = (profile?.display_name ?? user?.email ?? "?")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="mt-6 rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-white backdrop-blur-sm"
      style={{
        boxShadow:
          "0 12px 24px -16px rgba(0, 0, 0, 0.35), 0 4px 12px -12px rgba(0, 0, 0, 0.25)",
      }}
    >
      <div className="flex items-center gap-3">
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={profile.display_name ?? "Profile"}
            className="h-10 w-10 rounded-full object-cover ring-2 ring-white/30"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 font-heading text-sm font-bold">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-sm font-bold">
            {profile?.display_name ?? "Signed in"}
          </p>
          <p className="truncate text-[11px] text-white/70">{user?.email}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2">
        <Wallet className="h-4 w-4 text-[#FEE53A]" />
        <span className="text-xs text-white/75">Balance</span>
        <span className="ml-auto font-heading text-sm font-bold tabular-nums">
          ${balanceDollars.toFixed(2)}
        </span>
      </div>

      <div className="mt-3 space-y-1">
        <Link
          to="/my-bets"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ListChecks className="h-4 w-4" /> My bets
        </Link>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
