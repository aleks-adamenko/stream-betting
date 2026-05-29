import { NavLink } from "react-router-dom";
import { UserRound, Wallet } from "lucide-react";

import { cn } from "@liverush/lib";

/**
 * Tab bar shown at the top of "personal" studio pages (Profile,
 * Balance). Visually mirrors the user-app's `UserPageTabs` so the
 * pattern is consistent across surfaces — same rounded container,
 * primary-tinted active state, icon + label, mobile-collapses-to-icon
 * below 480px.
 *
 * Pages reach here directly from the studio sidebar — the tab bar is
 * a secondary nav between sibling personal pages, NOT a replacement
 * for the sidebar.
 *
 * Adding a third tab later (e.g. Notifications) is a one-line append
 * to the `tabs` array.
 */
const tabs = [
  { to: "/profile", label: "Profile", icon: UserRound },
  { to: "/balance", label: "Balance", icon: Wallet },
];

export function StudioPageTabs() {
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
          {/* Labels collapse to icon-only under ~480px so the row
              doesn't crush on phones. Mirrors UserPageTabs exactly. */}
          <span className="hidden truncate min-[480px]:inline">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
