import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  CalendarClock,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Settings,
  X,
  Zap,
} from "lucide-react";

import { cn } from "@liverush/lib";
import { useAuth } from "@/contexts/AuthContext";
import { NavBrushBg } from "@/components/NavBrushBg";
import logoUrl from "@/assets/live-rush-white-logo.png";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  disabled?: boolean;
};

const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/events", label: "Events", icon: ListChecks },
  { to: "/schedule", label: "Schedule", icon: CalendarClock, disabled: true },
  { to: "/settings", label: "Settings", icon: Settings, disabled: true },
];

/**
 * Studio shell. Sidebar visuals mirror the user-app SideNav so the brand
 * feels continuous: same horizontal blue→purple gradient, dotted overlay,
 * decorative bolt watermark, brush-stroke selected-state pill, white-on-
 * purple icon flip when active. Only the wordmark gets an extra STUDIO
 * caption underneath to disambiguate the surface.
 */
export function StudioLayout() {
  const { creator, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth/sign-in", { replace: true });
  };

  const sidebarBody = (closeMobile?: () => void) => (
    <>
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
        className="pointer-events-none absolute right-[-60px] top-[18%] h-44 w-44 -rotate-12 translate-y-[30px] fill-white/[0.08] stroke-none"
      />

      {/* Logo — same vertical position as the user-app sidebar (top of
          logo image at y=18px, matching the h-16 + items-center layout).
          The STUDIO caption hangs below it inside the same block. */}
      <div className="relative px-5 pt-[18px] pb-3">
        <Link
          to="/"
          onClick={closeMobile}
          className="block"
          aria-label="LiveRush Studio home"
        >
          <img src={logoUrl} alt="LiveRush" className="h-7 w-auto" />
          <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.3em] text-white/80">
            Studio
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="relative flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-1.5">
          {nav.map((item) => (
            <li key={item.to}>
              {item.disabled ? (
                <span
                  className={cn(
                    "group relative flex items-center gap-3 rounded-2xl px-3 py-2 text-base font-semibold text-white/40",
                  )}
                >
                  <item.icon className="relative h-5 w-5 flex-shrink-0" />
                  <span className="relative flex-1 truncate">{item.label}</span>
                  <span className="relative ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/55">
                    Soon
                  </span>
                </span>
              ) : (
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={closeMobile}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex items-center gap-3 rounded-2xl px-3 py-2 text-base font-semibold transition-colors",
                      isActive ? "text-[#5048FF]" : "text-white/90",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <NavBrushBg
                        className={cn(
                          "transition-opacity duration-200",
                          isActive
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-10",
                        )}
                      />
                      <item.icon
                        className={cn(
                          "relative h-5 w-5 flex-shrink-0",
                          isActive ? "text-[#5048FF]" : "text-white",
                        )}
                      />
                      <span className="relative flex-1 truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              )}
            </li>
          ))}
        </ul>

        {/* Creator strip */}
        <div
          className="relative mt-6 overflow-visible rounded-2xl border border-white/15 bg-black/[0.06] px-3 pt-4 pb-3 text-white backdrop-blur-sm"
          style={{
            boxShadow:
              "0 12px 24px -16px rgba(0, 0, 0, 0.35), 0 4px 12px -12px rgba(0, 0, 0, 0.25)",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              {creator?.avatar_url ? (
                <img
                  src={creator.avatar_url}
                  alt={creator.display_name ?? ""}
                  className="h-11 w-11 rounded-full object-cover ring-2 ring-white/40"
                />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 font-heading text-base font-bold ring-2 ring-white/40">
                  {(creator?.display_name ?? "C").slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#3057FF] bg-success" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-sm font-bold leading-tight">
                {creator?.display_name ?? "Creator"}
              </p>
              {creator?.handle && (
                <p className="truncate text-[11px] text-white/70">@{creator.handle}</p>
              )}
            </div>
          </div>

          {creator?.status === "pending" && (
            <p className="mt-3 rounded-md bg-[#FEE53A]/20 px-2 py-1 text-[11px] font-semibold text-[#FEE53A]">
              Pending review
            </p>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>

        {/* Footer links */}
        <ul className="mt-[11px] space-y-0.5 px-3">
          <li>
            <a
              href="https://liverush.co"
              target="_blank"
              rel="noreferrer"
              className="block py-1 text-sm font-bold text-white/85 transition-colors hover:text-white"
            >
              Go to LiveRush
            </a>
          </li>
        </ul>
      </nav>

      {/* Footer */}
      <div className="relative px-5 py-4">
        <p className="text-[11px] leading-tight text-white/75">
          © {new Date().getFullYear()} LiveRush Studio
        </p>
      </div>
    </>
  );

  return (
    // Lock the shell to the viewport so the sidebar stays pinned and the
    // <main> region owns all scrolling. Using `h-[100dvh] overflow-hidden`
    // (not min-h) is what keeps the gradient sidebar from scrolling
    // off-screen on tall pages like the event editor.
    <div className="relative flex h-[100dvh] overflow-hidden bg-background">
      {/* Background pattern (subtle) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
      />

      {/* Sidebar — single full-width variant on every route, so editor
          pages match Dashboard / Events / etc. */}
      <aside className="relative hidden h-[100dvh] flex-shrink-0 flex-col overflow-hidden bg-gradient-to-r from-[#1973FF] to-[#5048FF] text-white lg:flex lg:w-60 xl:w-64">
        {sidebarBody()}
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
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col overflow-hidden bg-gradient-to-r from-[#1973FF] to-[#5048FF] text-white">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarBody(() => setMobileOpen(false))}
          </aside>
        </div>
      )}

      {/* Main content — mirrors the user-app PageContainer
          (mx-auto / max-w-7xl / lg:px-12 / lg:py-10 + lg:pt-[18px]) on
          every route. The pending banner sits at the top of the same
          rail so it appears identically across pages. */}
      <main className="relative flex min-w-0 flex-1 flex-col pt-14 lg:pt-0">
        <div className="flex-1 overflow-y-auto">
          {creator?.status === "pending" && (
            <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-12 lg:pt-[18px]">
              <PendingReviewBanner />
            </div>
          )}
          <div
            className={cn(
              "mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-12 lg:py-10 lg:pt-[18px]",
              // Tighter top padding when the banner is visible so the
              // page heading sits flush below it rather than doubling
              // the spacing.
              creator?.status === "pending" && "pt-3 lg:pt-3",
            )}
          >
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * "Account pending review" notice. Rendered once at the top of the
 * scrollable content on standard routes by StudioLayout, and re-used
 * by EventEditor on editor routes (so it sits above the right column
 * only, not over the steps rail).
 */
export function PendingReviewBanner() {
  return (
    <div className="rounded-2xl border border-[#FEE53A]/40 bg-[#FEE53A]/10 px-4 py-3 text-sm text-foreground">
      <span className="font-semibold">Account pending review.</span>{" "}
      Drafts save normally, but publishing unlocks once your creator
      profile is verified.
    </div>
  );
}
