import { Link, useLocation, useNavigate } from "react-router-dom";
import { Compass, Heart, Home, Radio, UserCircle } from "lucide-react";

import logoUrl from "@/assets/live-rush-white-logo-2.png";
import { CoinIcon } from "@/components/ui/CoinAmount";
import { useAuth } from "@/contexts/AuthContext";
import { totalBalanceCents } from "@/lib/balance";
import { NavBrushBg } from "./NavBrushBg";
import { cn } from "@/lib/utils";

// `/trending` was retired together with the desktop layout overhaul.
// Four tabs left: For you / Live / Following / Discover.
const tabs = [
  { to: "/", label: "For you", icon: Home, exact: true },
  { to: "/live", label: "Live", icon: Radio },
  { to: "/following", label: "Following", icon: Heart },
  { to: "/discover", label: "Discover", icon: Compass },
];

export function MobileTopBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const balanceDollars = totalBalanceCents(profile?.balance_cents) / 100;

  return (
    <header
      className="lg:hidden z-30 flex-shrink-0 bg-gradient-to-r from-[#1973FF] to-[#5048FF] text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 items-center gap-2 pl-3 pr-2">
        <Link
          to="/"
          className="inline-flex flex-shrink-0 items-center"
          aria-label="LiveRush home"
        >
          <img src={logoUrl} alt="LiveRush" className="h-7 w-7" />
        </Link>

        <nav className="-mx-2 min-w-0 flex-1 overflow-x-auto scrollbar-hide">
          <ul className="flex items-center gap-1 px-2 [justify-content:safe_center]">
            {tabs.map((t) => {
              const isActive = pathname === t.to;
              const Icon = t.icon;
              return (
                <li key={t.to}>
                  <button
                    type="button"
                    onClick={() => navigate(t.to)}
                    aria-label={t.label}
                    className={cn(
                      "relative inline-flex h-10 items-center whitespace-nowrap rounded-2xl transition-colors",
                      isActive
                        ? "gap-1.5 px-3 text-[#5048FF]"
                        : "h-10 w-10 justify-center text-white/85 hover:text-white",
                    )}
                  >
                    {isActive && <NavBrushBg className="text-white" />}
                    <Icon
                      className={cn(
                        "relative h-5 w-5 flex-shrink-0",
                        isActive ? "text-[#5048FF]" : "text-white",
                      )}
                    />
                    {isActive && (
                      <span className="relative text-sm font-bold">
                        {t.label}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Right cluster: bare balance link (signed-in only) + avatar.
            Matches the desktop top nav — no pill, no + button, just
            the coin glyph + amount. The whole thing is a Link to
            /coins so a tap jumps to the top-up storefront. */}
        <div className="flex flex-shrink-0 items-center gap-3">
          {user && (
            <Link
              to="/coins"
              aria-label={`Balance ${balanceDollars.toFixed(2)} — get coins`}
              className="inline-flex items-center gap-1.5 font-heading text-base font-extrabold leading-none tabular-nums text-white outline-none transition-opacity hover:opacity-80"
            >
              <CoinIcon />
              {balanceDollars.toFixed(2)}
            </Link>
          )}
          <Link
            to={user ? "/profile" : "/auth/sign-in"}
            aria-label={user ? "Profile" : "Sign in"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/10"
          >
            {user && profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                // Solid 2px white ring — matches the desktop top nav
                // avatar. Was ring-white/40 (40% opacity) which read
                // as a soft halo on the blue header.
                className="h-8 w-8 rounded-full object-cover ring-2 ring-white"
              />
            ) : (
              <UserCircle className="h-6 w-6" />
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
