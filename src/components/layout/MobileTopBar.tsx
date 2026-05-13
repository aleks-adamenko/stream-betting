import { Link, useLocation, useNavigate } from "react-router-dom";
import { Search, UserCircle } from "lucide-react";

import logoUrl from "@/assets/live-rush-logo-2.png";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/", label: "For you", exact: true },
  { to: "/live", label: "Live" },
  { to: "/trending", label: "Trending" },
  { to: "/following", label: "Following" },
  { to: "/discover", label: "Discover" },
];

export function MobileTopBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <header
      className="lg:hidden z-30 flex-shrink-0 border-b border-border/40 bg-background/85 backdrop-blur-xl"
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
          <ul className="flex gap-0.5 px-2 [justify-content:safe_center]">
            {tabs.map((t) => {
              const isActive = t.exact ? pathname === t.to : pathname === t.to;
              return (
                <li key={t.to}>
                  <button
                    type="button"
                    onClick={() => navigate(t.to)}
                    className={cn(
                      "relative inline-flex h-10 items-center whitespace-nowrap rounded-md px-2.5 text-sm font-semibold transition-colors",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                    {isActive && (
                      <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-primary" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Search"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-secondary/60"
          >
            <Search className="h-5 w-5" />
          </button>
          <Link
            to="/auth/sign-in"
            aria-label="Profile"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-secondary/60"
          >
            <UserCircle className="h-6 w-6" />
          </Link>
        </div>
      </div>
    </header>
  );
}
