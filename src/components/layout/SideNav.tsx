import { Link, NavLink } from "react-router-dom";
import {
  Home,
  Radio,
  Compass,
  TrendingUp,
  Heart,
  LogIn,
  UserPlus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/live-rush-logo.png";

const mainNav = [
  { to: "/", label: "For you", icon: Home, exact: true },
  { to: "/live", label: "Live now", icon: Radio },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/trending", label: "Trending", icon: TrendingUp },
  { to: "/following", label: "Following", icon: Heart },
];

export function SideNav() {
  return (
    <aside className="hidden h-[100dvh] flex-shrink-0 flex-col bg-background/80 backdrop-blur-xl lg:flex lg:w-60 xl:w-64">
      <div className="flex h-16 items-center px-5">
        <Link to="/" className="inline-flex items-center" aria-label="LiveRush home">
          <img src={logoUrl} alt="LiveRush" className="h-7 w-auto" />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <ul className="space-y-0.5">
          {mainNav.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/80 hover:bg-secondary/60 hover:text-foreground",
                  )
                }
              >
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="mt-6 rounded-xl border border-border/40 bg-card p-4 shadow-sm">
          <p className="mb-2 font-heading text-base font-semibold">Sign in to bet</p>
          <p className="text-sm text-muted-foreground">
            Watch any stream without an account. Create one to place bets.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link to="/auth/sign-up">
                <UserPlus className="h-4 w-4" /> Sign up
              </Link>
            </Button>
            <Button asChild variant="secondary" className="w-full">
              <Link to="/auth/sign-in">
                <LogIn className="h-4 w-4" /> Sign in
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      <div className="px-5 py-4">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          © {new Date().getFullYear()} LiveRush · Human-only content
        </p>
      </div>
    </aside>
  );
}
