import { NavLink } from "react-router-dom";
import { Bell, Coins, Gift, ListChecks, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";

const tabs = [
  { to: "/profile", label: "Profile", icon: UserRound },
  { to: "/my-bets", label: "My bets", icon: ListChecks },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/rewards", label: "Rewards", icon: Gift },
  // Get Coins is the single money-related tab now — the old
  // Balance ledger/withdraw page is gone, all top-ups go through
  // the IAP packs on /coins.
  { to: "/coins", label: "Get coins", icon: Coins },
];

export function UserPageTabs() {
  return (
    <nav className="mb-5 flex gap-1 rounded-2xl border border-border/40 bg-card p-1 shadow-sm">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition-colors sm:text-sm",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary/40",
            )
          }
        >
          <t.icon className="h-4 w-4 flex-shrink-0" />
          {/* On the smallest phones the 5 labels would truncate to noise —
              hide them below the ~480px arbitrary breakpoint so the icons
              identify each tab; the labels return as soon as there is room. */}
          <span className="hidden truncate min-[480px]:inline">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
