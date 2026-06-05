import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Compass,
  Gift,
  Heart,
  Home,
  ListChecks,
  LogIn,
  LogOut,
  MoreHorizontal,
  Radio,
  UserPlus,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CoinIcon } from "@/components/ui/CoinAmount";
import { useAuth } from "@/contexts/AuthContext";
import { useEvents } from "@/hooks/useEvents";
import { useMyBets } from "@/hooks/useMyBets";
import { useUnreadCount } from "@/hooks/useNotifications";
import { totalBalanceCents } from "@/lib/balance";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/live-rush-white-logo.png";
import { NavBrushBg } from "./NavBrushBg";

/**
 * Desktop top navigation — replaces the old left sidebar.
 *
 * Layout (left → right):
 *   logo · Home · Live now · Discover · Following · ⋯ more menu
 *   (right-aligned) bare balance link · bare avatar button | OR | Log in · Sign up
 *
 * The signed-in right side is intentionally undecorated — no pill
 * containers, no `+` button, no username next to the avatar. Tapping
 * the balance jumps to /coins; tapping the avatar opens the account
 * dropdown.
 *
 * Hidden under `lg` — `MobileTopBar` + `MobileFooter` handle mobile.
 *
 * Sticky at the top of the scrolling main column. The sidebar's
 * `NavBrushBg` active-state treatment is reused so the visual
 * vocabulary matches across desktop / mobile.
 */
export function DesktopTopNav() {
  const { user, profile, signOut } = useAuth();
  const { data: events } = useEvents();
  const liveCount = events?.filter((e) => e.status === "live").length ?? 0;

  return (
    <header
      // Soft drop shadow: 4px down, 12px blur, -2px spread so it
      // hugs the bar tightly and falls off smoothly underneath
      // instead of the harder shadow-md edge.
      className="sticky top-0 z-30 hidden h-12 flex-shrink-0 items-center gap-2 bg-gradient-to-r from-[#1973FF] to-[#5048FF] px-4 text-white shadow-[0_4px_12px_-2px_rgba(0,0,0,0.18)] lg:flex lg:px-6"
    >
      <Link
        to="/"
        className="mr-2 flex-shrink-0"
        aria-label="LiveRush home"
      >
        {/* 20% smaller than the previous h-7 (28px) — 28 × 0.8 ≈ 22px. */}
        <img src={logoUrl} alt="LiveRush" className="h-[22px] w-auto" />
      </Link>

      <nav className="flex items-center gap-1">
        <PrimaryNavLink to="/" icon={Home} label="Home" exact />
        <PrimaryNavLink
          to="/live"
          icon={Radio}
          label="Live now"
          badge={liveCount}
        />
        <PrimaryNavLink to="/discover" icon={Compass} label="Discover" />
        <PrimaryNavLink to="/following" icon={Heart} label="Following" />
        <MoreMenu />
      </nav>

      {/*
       * Pin the right-side cluster to the FULL header height so the
       * inner items vertical-align against a fixed-height row. When
       * we only had `items-center` on the header, the row's height
       * was inferred from its tallest child — which changes after
       * profile load (balance digits + avatar img both swap in
       * async), shifting the visual centre. h-full + items-center
       * here means the avatar centre is locked to half of h-12,
       * regardless of when content fills in.
       */}
      <div className="ml-auto flex h-full items-center gap-3">
        {user ? (
          <>
            <BalanceLink balanceCents={profile?.balance_cents ?? 0} />
            <AvatarMenu onSignOut={signOut} />
          </>
        ) : (
          <SignedOutCTAs />
        )}
      </div>
    </header>
  );
}

// =========================================================================
// Primary nav (Home / Live / Discover / Following)
// =========================================================================

function PrimaryNavLink({
  to,
  icon: Icon,
  label,
  exact,
  badge,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        cn(
          "group relative inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-sm font-bold transition-colors",
          isActive ? "text-[#5048FF]" : "text-white/90 hover:text-white",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/*
           * `scale-y-90` shrinks the brush SVG to 90% of its
           * default height (centered, so 5% trims off top + 5% off
           * bottom). The button's hit-box is unchanged — this is a
           * visual-only adjustment so the brush doesn't hug the
           * full pill edge.
           */}
          <NavBrushBg
            className={cn(
              "scale-y-90 transition-opacity duration-200",
              isActive ? "opacity-100" : "opacity-0 group-hover:opacity-10",
            )}
          />
          <Icon
            className={cn(
              "relative h-5 w-5 flex-shrink-0",
              isActive ? "text-[#5048FF]" : "text-white",
            )}
          />
          <span className="relative whitespace-nowrap">{label}</span>
          {badge != null && badge > 0 && (
            <span
              className={cn(
                "relative inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-[11px] font-black tabular-nums",
                isActive ? "bg-[#5048FF] text-white" : "bg-[#2A1FCF] text-white",
              )}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

// =========================================================================
// More menu (Creator Studio · Company · Terms · Privacy)
// =========================================================================

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useOnClickOutside(ref, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More"
        aria-expanded={open}
        className={cn(
          "inline-flex h-10 w-10 items-center justify-center rounded-2xl text-white/90 transition-colors hover:bg-white/10 hover:text-white",
          open && "bg-white/10 text-white",
        )}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-2xl border border-border/40 bg-card text-foreground shadow-2xl"
        >
          <a
            href="https://studio.liverush.co"
            target="_blank"
            rel="noreferrer noopener"
            className="block px-4 py-2.5 text-sm font-medium hover:bg-secondary/40"
            onClick={() => setOpen(false)}
          >
            Creator Studio
          </a>
          <Link
            to="/company"
            className="block px-4 py-2.5 text-sm font-medium hover:bg-secondary/40"
            onClick={() => setOpen(false)}
          >
            Company
          </Link>
          <div className="my-1 h-px bg-border/40" />
          <Link
            to="/terms"
            className="block px-4 py-2.5 text-sm font-medium hover:bg-secondary/40"
            onClick={() => setOpen(false)}
          >
            Terms of Service
          </Link>
          <Link
            to="/privacy"
            className="block px-4 py-2.5 text-sm font-medium hover:bg-secondary/40"
            onClick={() => setOpen(false)}
          >
            Privacy Policy
          </Link>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Balance — bare coin glyph + amount, no container, no `+` button.
// Clicking the whole thing goes to /coins (the top-up storefront).
// =========================================================================

function BalanceLink({ balanceCents }: { balanceCents: number }) {
  const dollars = totalBalanceCents(balanceCents) / 100;
  return (
    <Link
      to="/coins"
      aria-label={`Balance ${dollars.toFixed(2)} — get coins`}
      // text-xl scales both the digits AND the CoinIcon (which is
      // sized in `em`) together, so bumping the font-size is the
      // single lever for "make balance + icon bigger".
      className="inline-flex items-center gap-1.5 rounded-md font-heading text-xl font-extrabold leading-none tabular-nums text-white outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <CoinIcon />
      {dollars.toFixed(2)}
    </Link>
  );
}

// =========================================================================
// Signed-out CTAs — Log in (outline) + Sign up (yellow fill).
// Matches the sidebar's Sign up / Sign in pair styling.
// =========================================================================

function SignedOutCTAs() {
  return (
    <div className="flex items-center gap-2">
      <Button
        asChild
        variant="outline"
        size="sm"
        className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
      >
        <Link to="/auth/sign-in">
          <LogIn className="h-4 w-4" />
          Log in
        </Link>
      </Button>
      <Button
        asChild
        size="sm"
        className="text-[#1F2679] ring-0 hover:text-[#1F2679]"
        style={{ backgroundColor: "#FEE53A", backgroundImage: "none" }}
      >
        <Link to="/auth/sign-up">
          <UserPlus className="h-4 w-4" />
          Sign up
        </Link>
      </Button>
    </div>
  );
}

// =========================================================================
// Avatar menu — replaces UserPageTabs sub-nav on profile-cluster pages
// =========================================================================

const AVATAR_MENU_ITEMS: Array<{
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  badgeKind?: "bets" | "notifications";
}> = [
  { to: "/profile", label: "Profile", icon: UserRound },
  { to: "/my-bets", label: "My bets", icon: ListChecks, badgeKind: "bets" },
  {
    to: "/notifications",
    label: "Notifications",
    icon: Bell,
    badgeKind: "notifications",
  },
  { to: "/rewards", label: "Rewards", icon: Gift },
  { to: "/coins", label: "Get coins", icon: Wallet },
];

function AvatarMenu({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Reuse the same data sources the old SideNavUserCard fed off so the
  // badges keep their existing semantics (open bets + unread notifs).
  const { data: bets } = useMyBets();
  const openBetsCount = bets?.filter((b) => b.status === "open").length ?? 0;
  const unreadCount = useUnreadCount();

  useOnClickOutside(ref, () => setOpen(false));

  const handle =
    profile?.display_name ?? user?.email?.split("@")[0] ?? "you";
  const initials = handle.slice(0, 2).toUpperCase();

  const handleSignOut = async () => {
    setOpen(false);
    await onSignOut();
    navigate("/");
  };

  return (
    <div ref={ref} className="relative">
      {/*
       * `flex` (not `inline-flex`) on the button + `leading-none`
       * neutralises any text-baseline space the user-agent button
       * style would otherwise reserve. `block` on the img/span
       * removes the inline-replaced baseline gap below the glyph
       * that was nudging the avatar up by ~1-2px after the image
       * loaded. Result: the visual centre of the circle sits at
       * exactly h-12 / 2 = 24px from the top — no first-paint jump.
       */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full p-0 leading-none outline-none ring-2 ring-white transition-shadow focus-visible:ring-white",
          open && "ring-white",
        )}
      >
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            className="block h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 font-heading text-xs font-bold leading-none">
            {initials}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-border/40 bg-card text-foreground shadow-2xl"
        >
          <div className="px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Account
            </p>
            <p className="mt-1 truncate font-heading text-base font-bold text-foreground">
              {handle}
            </p>
          </div>
          <div className="h-px bg-border/40" />
          <ul className="py-1">
            {AVATAR_MENU_ITEMS.map((item) => {
              const isActive = pathname === item.to;
              const Icon = item.icon;
              const badge =
                item.badgeKind === "bets"
                  ? openBetsCount
                  : item.badgeKind === "notifications"
                    ? unreadCount
                    : 0;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-secondary/40",
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {badge > 0 && (
                      <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md bg-[#2A1FCF] px-1.5 text-[10px] font-black uppercase tabular-nums text-white">
                        {badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="h-px bg-border/40" />
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Shared outside-click helper
// =========================================================================

function useOnClickOutside(
  ref: React.RefObject<HTMLElement>,
  handler: () => void,
) {
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const node = ref.current;
      if (!node || node.contains(e.target as Node)) return;
      handler();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") handler();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [ref, handler]);
}
