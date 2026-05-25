import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  CalendarClock,
  ChevronDown,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";

import { cn } from "@liverush/lib";
import { useAuth } from "@/contexts/AuthContext";
import logoUrl from "@/assets/live-rush-white-logo.png";
import bgUrl from "@/assets/live-rush-bg.jpg";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/events", label: "Events", icon: ListChecks },
  { to: "/schedule", label: "Schedule", icon: CalendarClock, disabled: true },
  { to: "/settings", label: "Settings", icon: Settings, disabled: true },
];

/**
 * Shell for every authenticated studio page. Left sidebar on desktop with
 * brand + nav + creator strip; collapsible drawer on mobile. The shell is
 * intentionally minimal — KPI surface, stream control panels, etc. arrive
 * in later phases.
 */
export function StudioLayout() {
  const { creator, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth/sign-in", { replace: true });
  };

  return (
    <div className="relative flex min-h-[100dvh] bg-background">
      {/* Background pattern */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: `url(${bgUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* Sidebar — desktop */}
      <aside className="relative hidden w-60 flex-shrink-0 flex-col gap-6 bg-gradient-to-b from-[#1973FF] to-[#5048FF] p-5 text-white lg:flex">
        <Link to="/" aria-label="LiveRush Studio home" className="flex flex-col">
          <img src={logoUrl} alt="LiveRush" className="h-8 w-auto" />
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-white/80">
            Studio
          </span>
        </Link>

        <nav className="flex flex-col gap-1">
          {nav.map((item) => (
            <SidebarLink key={item.to} {...item} />
          ))}
        </nav>

        <div className="mt-auto rounded-2xl border border-white/15 bg-white/[0.06] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
            Signed in as
          </p>
          <p className="mt-1 truncate font-heading text-sm font-bold text-white">
            {creator?.display_name ?? "Creator"}
          </p>
          {creator?.handle && (
            <p className="truncate text-xs text-white/70">@{creator.handle}</p>
          )}
          {creator?.status === "pending" && (
            <p className="mt-2 rounded-md bg-[#FEE53A]/20 px-2 py-1 text-[11px] font-semibold text-[#FEE53A]">
              Pending review
            </p>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-3 inline-flex w-full items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="absolute inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border/40 bg-card/80 px-4 backdrop-blur lg:hidden">
        <Link to="/" aria-label="LiveRush Studio home" className="flex items-center gap-2">
          <span className="font-heading text-base font-bold">LiveRush</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Studio
          </span>
        </Link>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground hover:bg-secondary/40"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-6 bg-gradient-to-b from-[#1973FF] to-[#5048FF] p-5 text-white">
            <div className="flex items-center justify-between">
              <Link
                to="/"
                onClick={() => setMobileOpen(false)}
                className="flex flex-col"
              >
                <img src={logoUrl} alt="LiveRush" className="h-7 w-auto" />
                <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-white/80">
                  Studio
                </span>
              </Link>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-col gap-1">
              {nav.map((item) => (
                <SidebarLink
                  key={item.to}
                  {...item}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
            </nav>

            <button
              type="button"
              onClick={handleSignOut}
              className="mt-auto inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="relative flex min-w-0 flex-1 flex-col pt-14 lg:pt-0">
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  end,
  disabled,
  onClick,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  if (disabled) {
    return (
      <span
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-white/40",
        )}
      >
        <Icon className="h-4 w-4" />
        {label}
        <ChevronDown className="ml-auto h-3 w-3 opacity-60" />
      </span>
    );
  }
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-white/15 text-white"
            : "text-white/75 hover:bg-white/10 hover:text-white",
        )
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}
