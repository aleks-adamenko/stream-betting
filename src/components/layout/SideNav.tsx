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
    <aside className="relative hidden h-[100dvh] flex-shrink-0 flex-col overflow-hidden bg-gradient-to-r from-[#1973FF] to-[#5048FF] text-white lg:flex lg:w-60 xl:w-64">
      {/* Dotted radial pattern overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      />
      {/* Decorative bolt watermark behind nav items */}
      <Zap
        aria-hidden
        className="pointer-events-none absolute right-[-190px] top-[18%] h-80 w-80 -rotate-12 fill-white/[0.08] stroke-none"
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
                      ? "bg-white text-[#5048FF] shadow-lg"
                      : "text-white/90 hover:bg-white/10",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      className={cn(
                        "h-5 w-5 flex-shrink-0",
                        isActive ? "text-[#5048FF]" : "text-white",
                      )}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.withLiveCount && liveCount > 0 && (
                      <span
                        className={cn(
                          "inline-flex h-6 min-w-[2rem] items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums",
                          isActive
                            ? "bg-[#5048FF] text-white"
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

        <div
          className="mt-6 rounded-2xl border border-white/15 bg-white/[0.06] p-5 text-white backdrop-blur-sm"
          style={{
            boxShadow:
              "0 12px 24px -16px rgba(0, 0, 0, 0.35), 0 4px 12px -12px rgba(0, 0, 0, 0.25)",
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-heading text-xl font-bold leading-tight">Ready to bet?</h3>
            <Zap className="h-5 w-5 fill-accent text-accent" />
          </div>
          <p className="text-sm text-white/75">
            Watch any stream without an account. Create one to place bets.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              asChild
              className="w-full text-[#5048FF] ring-0 hover:text-[#5048FF]"
              style={{ background: "#ffffff" }}
            >
              <Link to="/auth/sign-up">
                <UserPlus className="h-4 w-4" /> Sign up
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="w-full border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <Link to="/auth/sign-in">
                <LogIn className="h-4 w-4" /> Sign in
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      <div className="relative px-5 py-4">
        <p className="text-[11px] leading-tight text-white/75">
          © {new Date().getFullYear()} LiveRush · Human-only content
        </p>
      </div>
    </aside>
  );
}
