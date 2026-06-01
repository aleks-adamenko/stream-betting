import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Copy,
  Loader2,
  Search,
  ShieldX,
  UserCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button, Input } from "@liverush/ui";
import { cn, formatCents } from "@liverush/lib";
import { supabase } from "@/integrations/supabase/client";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const ROLE_BADGE_CLASSES: Record<string, string> = {
  admin: "bg-primary/15 text-primary",
  creator: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  viewer: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

const ROLE_LABEL_TEXT: Record<string, string> = {
  admin: "Admin",
  creator: "Creator",
  viewer: "Viewer",
};

type RoleFilter = "all" | "viewer" | "creator" | "admin";

type Tab = "viewers" | "creators";

/**
 * /users — Viewers + Creators tabs.
 *   Viewers: read-only list of every registered profile. Search by email.
 *   Creators: grouped Pending / Verified / Rejected. Approve + Reject
 *   action buttons on pending rows.
 *
 * Data comes from the list_admin_users / list_admin_creators RPCs
 * (defined in 20260531_000001_admin_app.sql). Both are gated on
 * is_admin() inside their function bodies so a non-admin who somehow
 * gets here just sees an empty error toast.
 */
export default function Users() {
  const [tab, setTab] = useState<Tab>("viewers");

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Users</h1>
      </header>

      {/* Tab strip — Viewers first + default. Viewers is the larger
          population and the audit lens an operator usually starts
          with; Creators (the moderation queue) is one click away. */}
      <div className="mb-5 inline-flex rounded-2xl border border-border/40 bg-card p-1">
        <TabButton active={tab === "viewers"} onClick={() => setTab("viewers")}>
          Viewers
        </TabButton>
        <TabButton active={tab === "creators"} onClick={() => setTab("creators")}>
          Creators
        </TabButton>
      </div>

      {tab === "viewers" ? <ViewersTab /> : <CreatorsTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/* ============================================================
 * Viewers tab
 * ============================================================ */

/**
 * Viewers tab — table of every registered profile. Search + role
 * filter live in the same row above the table (matching the Ledger
 * page filter strip). The Role column renders a derived label
 * ('Viewer' / 'Creator' / 'Admin') computed server-side by
 * list_admin_users so a creator who's also a super_admin gets the
 * Admin badge (highest precedence).
 */
function ViewersTab() {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "users", "viewers"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_admin_users");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((u) => {
      if (roleFilter !== "all" && u.role_label !== roleFilter) return false;
      if (query) {
        const q = query.trim().toLowerCase();
        const haystack = [u.email, u.display_name ?? "", u.id]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [data, query, roleFilter]);

  return (
    <div>
      {/* Filter strip — search input + role dropdown, same shape and
          max-width as the Ledger page so the two admin tables share
          a control surface. */}
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
          <option value="all">All roles</option>
          <option value="viewer">Viewers</option>
          <option value="creator">Creators</option>
          <option value="admin">Admin</option>
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
            {data && data.length === 0
              ? "No users yet."
              : "No users match these filters."}
          </div>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* Header style matches the Ledger + Events tables — same
                  bg-secondary/40 + uppercase tracking — so the three
                  admin tables read as a set. */}
              <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-semibold">When</th>
                  <th className="px-4 py-2 font-semibold w-12"></th>
                  <th className="px-4 py-2 font-semibold">ID</th>
                  <th className="px-4 py-2 font-semibold">Email</th>
                  <th className="px-4 py-2 text-right font-semibold">Balance</th>
                  <th className="px-4 py-2 font-semibold">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((user) => (
                  <tr key={user.id}>
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {dateFormatter.format(new Date(user.created_at))}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                        {user.avatar_url ? (
                          <img
                            src={user.avatar_url}
                            alt=""
                            className="h-full w-full rounded-full object-cover"
                          />
                        ) : (
                          <UserCircle2 className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <CopyIdCell id={user.id} />
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <div className="min-w-0 max-w-[260px]">
                        <p className="truncate font-semibold text-foreground">
                          {user.email}
                        </p>
                        {user.display_name && (
                          <p className="truncate text-[10px] text-muted-foreground">
                            {user.display_name}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-heading text-sm font-bold tabular-nums whitespace-nowrap">
                      {formatCents(user.balance_cents ?? 0)}
                    </td>
                    <td className="px-4 py-2">
                      <RoleBadge role={user.role_label} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** Copy-able short id chip — used for the ID column. Click copies
 *  the full uuid to the clipboard. */
function CopyIdCell({ id }: { id: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(id);
        toast.success("Copied user id");
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-secondary/60"
      title={id}
      aria-label="Copy user id"
    >
      {id.slice(0, 8)}
      <Copy className="h-3 w-3" />
    </button>
  );
}

function RoleBadge({
  role,
}: {
  role: "viewer" | "creator" | "admin";
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap",
        ROLE_BADGE_CLASSES[role],
      )}
    >
      {ROLE_LABEL_TEXT[role]}
    </span>
  );
}

/* ============================================================
 * Creators tab
 * ============================================================ */

type CreatorStatus = "pending" | "verified" | "rejected";
type CreatorStatusFilter = "all" | CreatorStatus;

type CreatorRow =
  Awaited<
    ReturnType<typeof supabase.rpc<"list_admin_creators">>
  >["data"] extends Array<infer Row> | null
    ? Row
    : never;

const dateFormatterShort = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function CreatorsTab() {
  const queryClient = useQueryClient();
  // Default to "All" so the operator sees the whole list — they can
  // narrow down to Pending (the work queue) with one click when they
  // want to triage.
  const [statusFilter, setStatusFilter] = useState<CreatorStatusFilter>("all");
  const [query, setQuery] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "users", "creators"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_admin_creators");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Pre-compute per-status counts so the filter pills can show how
  // much work is sitting in each bucket without flipping through tabs.
  // "All" gets the total count.
  const counts = useMemo(() => {
    const c = { all: 0, pending: 0, verified: 0, rejected: 0 };
    for (const row of data ?? []) {
      c.all += 1;
      c[row.status as CreatorStatus] = (c[row.status as CreatorStatus] ?? 0) + 1;
    }
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    const rows = (data ?? []).filter(
      (row) => statusFilter === "all" || row.status === statusFilter,
    );
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.email?.toLowerCase().includes(q) ||
        row.display_name?.toLowerCase().includes(q) ||
        row.handle?.toLowerCase().includes(q),
    );
  }, [data, statusFilter, query]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "users", "creators"] });

  return (
    <div className="rounded-2xl border border-border/40 bg-card shadow-sm">
      {/* Header row — search on the left, filter pills on the right.
          Same `px-4 py-3 sm:px-6` padding as the Viewers header so
          the row heights match. flex-wrap so the pills drop below the
          search on narrow viewports instead of overflowing. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-4 py-3 sm:px-6">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search by handle, name or email…"
        />
        <div className="flex flex-wrap items-center gap-2">
          <FilterTab
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            label="All"
            count={counts.all}
          />
          <FilterTab
            active={statusFilter === "pending"}
            onClick={() => setStatusFilter("pending")}
            label="Pending"
            count={counts.pending}
          />
          <FilterTab
            active={statusFilter === "verified"}
            onClick={() => setStatusFilter("verified")}
            label="Verified"
            count={counts.verified}
          />
          <FilterTab
            active={statusFilter === "rejected"}
            onClick={() => setStatusFilter("rejected")}
            label="Rejected"
            count={counts.rejected}
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {error && <ErrorBanner error={error as Error} />}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyRow
          label={
            query
              ? "No creators match this search."
              : statusFilter === "all"
                ? "No creators yet."
                : `No ${statusFilter} creators.`
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <div className="divide-y divide-border/40">
          {filtered.map((row) => (
            <CreatorRowItem key={row.id} row={row} onChange={invalidate} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] tabular-nums",
          active ? "bg-primary-foreground/20" : "bg-secondary",
        )}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Single-row creator card. Visual structure mirrors the ViewersTab
 * row layout (avatar + name/email block + right-aligned meta) so the
 * Users page reads as one consistent list whichever tab you're on.
 * The right-aligned slot shifts between meta (verified/rejected) and
 * Approve/Reject buttons (pending). The rejection-note expand still
 * lives inline below the row when the operator opens it.
 */
function CreatorRowItem({
  row,
  onChange,
}: {
  row: CreatorRow;
  onChange: () => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  const approveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("approve_creator", {
        p_creator_id: row.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Approved ${row.display_name}`);
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!note.trim()) throw new Error("Note required");
      const { error } = await supabase.rpc("reject_creator", {
        p_creator_id: row.id,
        p_note: note.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Rejected ${row.display_name}`);
      setRejectOpen(false);
      setNote("");
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-4 px-4 py-3 sm:px-6">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted">
          {row.avatar_url ? (
            <img
              src={row.avatar_url}
              alt=""
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <UserCircle2 className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-foreground">
              {row.display_name}
            </p>
            {row.status === "verified" && (
              <BadgeCheck className="h-4 w-4 flex-shrink-0 fill-primary text-white" />
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            @{row.handle} · {row.email}
          </p>
        </div>

        {/* Activity stats — always rendered for desktop, hidden on
            mobile to keep the row compact. Mirrors the Viewers tab's
            balance/joined block visually (headline number on top, two
            muted facts beneath). Earned cents is the headline because
            it answers "is this creator worth the slot?" most directly. */}
        <div className="hidden text-right sm:block">
          <p className="font-heading text-sm font-bold tabular-nums text-foreground">
            {formatCents(row.earned_cents ?? 0)}
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {row.events_created} event{row.events_created === 1 ? "" : "s"}
            {" "}· {row.events_hosted} hosted
          </p>
        </div>

        {/* Action slot — buttons for pending, status meta for others.
            Sits to the right of the stats block so the row reads
            left-to-right as "who · what they've done · what the
            operator can do". */}
        {row.status === "pending" ? (
          <div className="flex flex-shrink-0 gap-2">
            <Button
              size="sm"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejectOpen((v) => !v)}
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        ) : (
          <div className="hidden text-right sm:block">
            <p
              className={cn(
                "text-[11px] font-semibold uppercase tracking-wide",
                row.status === "verified"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400",
              )}
            >
              {row.status}
            </p>
            {row.moderated_at && (
              <p className="text-[11px] text-muted-foreground">
                {dateFormatterShort.format(new Date(row.moderated_at))}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Rejection note display — visible only when looking at the
          Rejected tab, sits below the row as a small caption so the
          row itself stays uniform with the rest of the list. */}
      {row.status === "rejected" && row.rejected_note && (
        <div className="mx-4 mb-3 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 sm:mx-6">
          <strong className="font-semibold">Rejection note:</strong>{" "}
          {row.rejected_note}
        </div>
      )}

      {/* Inline Reject form — same as before, drops below the row
          when the operator clicks Reject on a pending creator. */}
      {rejectOpen && row.status === "pending" && (
        <div className="mx-4 mb-3 rounded-xl border border-border/60 bg-background p-3 sm:mx-6">
          <label className="text-xs font-semibold text-foreground">
            Rejection note (visible to creator)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="Explain why this creator profile is being rejected so they know what to fix."
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRejectOpen(false);
                setNote("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending || !note.trim()}
            >
              {rejectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldX className="h-3.5 w-3.5" />
              )}
              Confirm rejection
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Shared search input — used by both Viewers and Creators tabs.
 * Hard-coded width caps so the input doesn't stretch to fill the
 * header row (which would push the filter pills off-screen on
 * smaller widths). `flex-1` + `max-w-md` keeps it responsive without
 * leaving the pills overlapping.
 */
function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full max-w-md flex-1 min-w-[200px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9"
      />
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function ErrorBanner({ error }: { error: Error }) {
  return (
    <div className="m-4 flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p>{error.message}</p>
    </div>
  );
}
