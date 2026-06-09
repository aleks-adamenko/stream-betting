import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Bell,
  Gift,
  ListChecks,
  Plus,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CoinAmount } from "@/components/ui/CoinAmount";
import { PageContainer } from "@/components/layout/PageContainer";
import { useAuth } from "@/contexts/AuthContext";
import { useMyBets } from "@/hooks/useMyBets";
import { useUnreadCount } from "@/hooks/useNotifications";
import { totalBalanceCents } from "@/lib/balance";
import { cn } from "@/lib/utils";

/**
 * Shared layout for the profile-cluster pages (Profile / My bets /
 * Notifications / Rewards / Get coins).
 *
 *   Desktop (lg+): 2-column grid. Left column shows the user's
 *     avatar + display name, then a vertical menu listing each
 *     cluster route. Right column renders <Outlet /> — the chosen
 *     page. The left column is sticky below the DesktopTopNav so
 *     it stays visible as the right column scrolls.
 *
 *   Mobile (< lg): a single column. A horizontal scrollable tab
 *     strip replaces the vertical sidebar (avatar header is hidden
 *     since MobileTopBar already shows the avatar). The chosen
 *     page renders directly below the strip.
 *
 * Each route's page component is responsible for its own inner
 * `max-w-2xl mx-auto` reading-width cap; ProfileLayout only
 * provides the outer container + nav.
 */

interface MenuItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badgeKind?: "bets" | "notifications";
}

const MENU_ITEMS: MenuItem[] = [
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

export function ProfileLayout() {
  const { user, profile } = useAuth();
  const { pathname } = useLocation();

  // Same data feeds the DesktopTopNav avatar dropdown — kept in sync
  // here so the cluster sidebar shows the same counts.
  const { data: bets } = useMyBets();
  const openBetsCount = bets?.filter((b) => b.status === "open").length ?? 0;
  const unreadCount = useUnreadCount();

  const handle =
    profile?.display_name ?? user?.email?.split("@")[0] ?? "you";
  const initials = handle.slice(0, 2).toUpperCase();
  const balance = totalBalanceCents(profile?.balance_cents);

  const badgeFor = (kind?: MenuItem["badgeKind"]) => {
    if (kind === "bets") return openBetsCount;
    if (kind === "notifications") return unreadCount;
    return 0;
  };

  return (
    <PageContainer className="lg:pt-[18px]">
      {/*
       * Centered, tight 2-column group on desktop. Width caps at
       * 960px (260 sidebar + 16 gap + 684 content — content itself
       * is `max-w-2xl` = 672px, with a tiny breathing buffer) and
       * `mx-auto` centers the whole block in the page. Gap is
       * `lg:gap-4` so the columns sit close together instead of
       * floating apart with the old gap-8.
       */}
      <div className="mx-auto grid gap-4 lg:max-w-[960px] lg:grid-cols-[260px_1fr] lg:gap-4">
        {/* ----- Left column (desktop sidebar / mobile tab strip) -----
            On desktop the column is sticky and pinned IMMEDIATELY at
            its natural starting position (48px topnav + 18px
            PageContainer top-pad = 66px from viewport top). Pinning
            at top-12 (48px) the way we used to meant the aside
            visibly drifted up 18px during the first bit of scroll
            before sticky engaged — the operator wanted it to never
            move at all. The height calc uses the same 66px offset
            so the sidebar fills exactly the visible viewport from
            its sticky position to the bottom edge. */}
        <aside className="lg:sticky lg:top-[66px] lg:flex lg:h-[calc(100dvh-66px)] lg:flex-col">
          {/* Avatar + display name (centered, stacked) + balance card.
              Desktop only — mobile already shows the avatar in
              MobileTopBar. No surrounding card around the avatar /
              name block; the avatar circle is the visual anchor. */}
          <div className="hidden lg:block">
            <div className="flex flex-col items-center">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={handle}
                  // Another 30% larger than the previous h-16 (64px) —
                  // 64 × 1.3 ≈ 83, rounded to h-20 (80px).
                  className="h-20 w-20 rounded-full object-cover ring-2 ring-border/40"
                />
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-muted font-heading text-xl font-bold text-foreground ring-2 ring-border/40">
                  {initials}
                </span>
              )}
              <p className="mt-3 truncate text-center font-heading text-base font-bold text-foreground">
                {handle}
              </p>
            </div>

            {/* Balance card — wallet icon + caption above the big
                tabular-nums coin amount, then a full-width Top up
                button stacked below. Button matches the event-page
                "Place bet" CTA (variant="accent" size="lg" w-full)
                so the visual weight reads the same. Clicking it
                jumps to /coins. */}
            <div className="mt-4 rounded-2xl bg-muted/50 p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Wallet className="h-4 w-4" />
                <span className="text-sm font-medium">Your balance</span>
              </div>
              <p className="mt-2 font-heading text-2xl font-bold tabular-nums text-foreground">
                <CoinAmount cents={balance} />
              </p>
              <Button asChild size="lg" variant="accent" className="mt-3 w-full">
                <Link to="/coins">
                  <Plus className="h-4 w-4" strokeWidth={3} /> Top up
                </Link>
              </Button>
            </div>
          </div>

          {/*
           * Nav has two visual modes:
           *   - Mobile: a card-wrapped tab bar that fits the full
           *     width (no horizontal scroll). The ACTIVE tab gets a
           *     `flex-1` slot showing icon + label; the rest collapse
           *     to icon-only fixed-width buttons. Badges on inactive
           *     items downgrade to a small pip indicator so they
           *     don't eat horizontal room.
           *   - Desktop (lg+): vertical sidebar, every row shows
           *     icon + label + numeric badge — the card chrome and
           *     pip indicator are stripped via lg: utilities.
           */}
          <nav className="mt-0 rounded-2xl border border-border/40 bg-card p-1 shadow-sm lg:mt-4 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
            <ul className="flex gap-1 lg:flex-col lg:gap-1">
              {MENU_ITEMS.map((item) => {
                const Icon = item.icon;
                const badge = badgeFor(item.badgeKind);
                const isActive = pathname === item.to;
                return (
                  <li
                    key={item.to}
                    className={cn(
                      isActive ? "flex-1" : "flex-shrink-0",
                      "lg:flex-none",
                    )}
                  >
                    <NavLink
                      to={item.to}
                      end
                      aria-label={item.label}
                      className={({ isActive }) =>
                        cn(
                          "relative flex w-full items-center gap-2 whitespace-nowrap rounded-xl py-2.5 text-sm font-semibold transition-colors",
                          // Mobile centres icon-only inactive items;
                          // active stretches with its label.
                          isActive
                            ? "justify-center bg-primary/10 px-3 text-primary"
                            : "justify-center px-2.5 text-foreground hover:bg-secondary/40",
                          // Desktop: same row shape regardless of
                          // active — full label visible, left-
                          // aligned, larger horizontal padding.
                          "lg:justify-start lg:gap-3 lg:rounded-2xl lg:px-4",
                        )
                      }
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      {/* Label: always shown on desktop; on mobile
                          only when this row is the active one. */}
                      <span
                        className={cn(
                          "truncate",
                          isActive ? "inline" : "hidden",
                          "lg:inline lg:flex-1",
                        )}
                      >
                        {item.label}
                      </span>
                      {/* Numeric badge — visible on desktop always,
                          and on mobile only for the active tab so
                          the inactive icon-only buttons stay
                          compact. */}
                      {badge > 0 && (
                        <span
                          className={cn(
                            "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md bg-[#2A1FCF] px-1.5 text-[10px] font-black uppercase tabular-nums text-white",
                            isActive ? "inline-flex" : "hidden lg:inline-flex",
                          )}
                        >
                          {badge}
                        </span>
                      )}
                      {/* Inactive mobile pip — a tiny coloured dot
                          on the icon corner so the user can still
                          see "you have unread / open bets" without
                          the wide numeric pill. */}
                      {badge > 0 && !isActive && (
                        <span
                          aria-hidden
                          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#2A1FCF] lg:hidden"
                        />
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        {/* ----- Right column (selected profile page) ----- */}
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </PageContainer>
  );
}
