import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button, CoinAmount, Input } from "@liverush/ui";
import { supabase } from "@/integrations/supabase/client";
import {
  AvatarCell,
  CopyIdCell,
  EmailCell,
  ErrorBanner,
  StatusBadge,
  TimezoneCell,
  dateFormatter,
  type UserRow,
} from "@/components/adminUserTable";

type RoleFilter = "all" | "admin";

/**
 * /viewers — everyone who is a viewer, i.e. has activated the viewer side
 * (viewer_activated_at stamped). A creator who also watches streams shows
 * up here AND on /creators. Pure creators who never opened the viewer app
 * live only on /creators. Columns:
 *   • Viewer: email-confirmation status (always activated here, so this is
 *     Verified / Email pending).
 *   • Timezone: profiles.timezone, or "-" when never set.
 *
 * Admin is a small inline pill next to the email — no dedicated column,
 * since super_admin is a provisioned state, not a workflow.
 */
export default function Viewers() {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_admin_users");
      if (error) throw error;
      return (data ?? []) as UserRow[];
    },
  });

  // Viewers = anyone who has activated the viewer side. Includes creators
  // who also watch streams (they additionally appear on /creators).
  const viewers = useMemo(
    () => (data ?? []).filter((u) => u.viewer_activated_at != null),
    [data],
  );

  const filtered = useMemo(() => {
    return viewers.filter((u) => {
      if (roleFilter === "admin" && !u.is_admin) return false;
      if (query) {
        const q = query.trim().toLowerCase();
        const haystack = [u.email, u.display_name ?? "", u.id]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [viewers, query, roleFilter]);

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Viewers</h1>
        {data && (
          <span className="text-sm text-muted-foreground">
            {viewers.length} loaded · {filtered.length} shown
          </span>
        )}
      </header>

      {/* Filter strip — search + role dropdown, same shape and
          max-width as the Ledger + Events pages. */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email, name, or id…"
          className="max-w-sm"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="all">All users</option>
          <option value="admin">Admins</option>
        </select>
        {(query || roleFilter !== "all") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQuery("");
              setRoleFilter("all");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {error && <ErrorBanner error={error as Error} />}

      <div className="overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm">
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {viewers.length === 0
              ? "No viewers yet."
              : "No viewers match these filters."}
          </div>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-semibold">When</th>
                  <th className="px-4 py-2 font-semibold w-12"></th>
                  <th className="px-4 py-2 font-semibold">ID</th>
                  <th className="px-4 py-2 font-semibold">Email</th>
                  <th className="px-4 py-2 text-right font-semibold">Balance</th>
                  <th className="px-4 py-2 font-semibold">Viewer</th>
                  <th className="px-4 py-2 font-semibold">Timezone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((user) => (
                  <UserRowItem key={user.id} user={user} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function UserRowItem({ user }: { user: UserRow }) {
  const emailVerified = user.email_confirmed_at != null;
  const viewerActivated = user.viewer_activated_at != null;

  return (
    <tr>
      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {dateFormatter.format(new Date(user.created_at))}
      </td>
      <td className="px-4 py-2">
        <AvatarCell url={user.avatar_url} />
      </td>
      <td className="px-4 py-2">
        <CopyIdCell id={user.id} />
      </td>
      <td className="px-4 py-2 text-xs">
        <EmailCell user={user} />
      </td>
      <td className="px-4 py-2 text-right font-heading text-sm font-bold tabular-nums whitespace-nowrap">
        <CoinAmount cents={user.balance_cents ?? 0} className="justify-end" />
      </td>

      {/* Viewer column — only filled in once the user has actually
          visited the user-app (viewer_activated_at stamped). Within an
          activated row, email_confirmed_at decides between Email pending
          and Verified. */}
      <td className="px-4 py-2">
        {!viewerActivated ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <StatusBadge
            tone={emailVerified ? "success" : "warning"}
            label={emailVerified ? "Verified" : "Email pending"}
          />
        )}
      </td>

      <td className="px-4 py-2">
        <TimezoneCell timezone={user.timezone} />
      </td>
    </tr>
  );
}
