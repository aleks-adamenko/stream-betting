import { NavLink } from "react-router-dom";
import { UserRound, ListChecks, Bell } from "lucide-react";

import { cn } from "@/lib/utils";

const tabs = [
  { to: "/profile", label: "Profile", icon: UserRound },
  { to: "/my-bets", label: "My bets", icon: ListChecks },
  { to: "/notifications", label: "Notifications", icon: Bell },
];

export function UserPageTabs() {
  return (
    <nav className="mb-5 flex gap-1 rounded-2xl border border-border/40 bg-card p-1 shadow-sm lg:hidden">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary/40",
            )
          }
        >
          <t.icon className="h-4 w-4" />
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
