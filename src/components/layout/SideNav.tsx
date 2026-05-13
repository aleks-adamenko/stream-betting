import { Link, NavLink } from "react-router-dom";
import {
  Home,
  Radio,
  Compass,
  TrendingUp,
  Heart,
  LogIn,
  UserPlus,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useEvents } from "@/hooks/useEvents";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/live-rush-white-logo.png";

const mainNav = [
  { to: "/", label: "For you", icon: Home, exact: true },
  { to: "/live", label: "Live now", icon: Radio, withLiveCount: true },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/trending", label: "Trending", icon: TrendingUp },
  { to: "/following", label: "Following", icon: Heart },
];

export function SideNav() {
  const { data: events } = useEvents();
  const liveCount = events?.filter((e) => e.status === "live").length ?? 0;

  return (
    <aside className="relative hidden h-[100dvh] flex-shrink-0 flex-col overflow-hidden bg-gradient-to-b from-[#498AFF] to-[#493BFF] text-white lg:flex lg:w-64 xl:w-72">
      {/* Decorative bolt watermark */}
      <Zap
        aria-hidden
        className="pointer-events-none absolute -right-12 top-1/3 h-72 w-72 -rotate-12 fill-white/5 stroke-none"
      />

      <div className="relative flex h-16 items-center px-5">
        <Link
          to="/"
          className="inline-flex items-center"
          aria-label="LiveRush home"
        >
          <img src={logoUrl} alt="LiveRush" className="h-7 w-auto" />
        </Link>
      </div>

      <nav className="relative flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-1.5">
          {mainNav.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-2xl px-4 py-3 text-base font-semibold transition-colors",
                    isActive
                      ? "bg-white text-foreground shadow-lg"
                      : "text-white/90 hover:bg-white/10",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      className={cn(
                        "h-5 w-5 flex-shrink-0",
                        isActive ? "text-primary" : "text-white",
                      )}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.withLiveCount && liveCount > 0 && (
                      <span
                        className={cn(
                          "inline-flex h-6 min-w-[2rem] items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "bg-[#2A1FCF] text-white",
                        )}
                      >
                        {liveCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="mt-6 rounded-2xl bg-white/95 p-5 text-foreground shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-heading text-base font-bold">Ready to bet?</h3>
            <Zap className="h-4 w-4 fill-accent text-accent" />
          </div>
          <p className="text-sm text-muted-foreground">
            Watch any stream without an account. Create one to place bets.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link to="/auth/sign-up">
                <UserPlus className="h-4 w-4" /> Sign up
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/auth/sign-in">
                <LogIn className="h-4 w-4" /> Sign in
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      <div className="relative flex items-center gap-2 px-5 py-4">
        <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur">
          <Zap className="h-3.5 w-3.5 fill-accent text-accent" />
        </span>
        <p className="text-[11px] leading-tight text-white/75">
          © {new Date().getFullYear()} LiveRush · Human-only content
        </p>
      </div>
    </aside>
  );
}
