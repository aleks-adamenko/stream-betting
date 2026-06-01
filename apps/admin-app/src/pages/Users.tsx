import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
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

const dateFormatterShort = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

type RoleFilter = "all" | "creator" | "admin" | "pending_creator";

type UserRow = {
  id: string;
  email: string;
  role: "user" | "influencer" | "super_admin";
  is_admin: boolean;
  display_name: string | null;
  avatar_url: string | null;
  balance_cents: number;
  email_confirmed_at: string | null;
  creator_status: "pending" | "verified" | "rejected" | null;
  creator_rejected_note: string | null;
  creator_moderated_at: string | null;
  created_at: string;
};

/**
 * /users — single unified table. Two verification-status columns:
 *   • Viewer: every user is a viewer; column tracks email confirmation
 *     (Verified / Email pending).
 *   • Creator: only populated when the user has a creator_profiles row.
 *     Status pipeline = Email pending → Pending review → Verified|Rejected.
 *     Approve / Reject buttons live inline in this column on Pending rows.
 *
 * Admin is rendered as a small inline pill next to the email — no
 * dedicated column because being a super_admin is a one-time
 * provisioned state, not a workflow with a status.
 */
export default function Users() {
  const queryClient = useQueryClient();
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

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((u) => {
      if (roleFilter === "creator" && u.creator_status == null) return false;
      if (roleFilter === "admin" && !u.is_admin) return false;
      if (roleFilter === "pending_creator" && u.creator_status !== "pending")
        return false;
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

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Users</h1>
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.length} loaded · {filtered.length} shown
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
          <option value="pending_creator">Pending creators</option>
          <option value="creator">All creators</option>
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
            {data && data.length === 0
              ? "No users yet."
              : "No users match these filters."}
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
                  <th className="px-4 py-2 font-semibold">Creator</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((user) => (
                  <UserRowItem
                    key={user.id}
                    user={user}
                    onChange={invalidate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function UserRowItem({
  user,
  onChange,
}: {
  user: UserRow;
  onChange: () => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  const approveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("approve_creator", {
        p_creator_id: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Approved ${user.display_name ?? user.email}`);
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!note.trim()) throw new Error("Note required");
      const { error } = await supabase.rpc("reject_creator", {
        p_creator_id: user.id,
        p_note: note.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Rejected ${user.display_name ?? user.email}`);
      setRejectOpen(false);
      setNote("");
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const emailVerified = user.email_confirmed_at != null;
  const isCreator = user.creator_status != null;
  const isPendingCreator = user.creator_status === "pending";
  const isRejectedCreator = user.creator_status === "rejected";

  return (
    <>
      <tr>
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
          <div className="min-w-0 max-w-[280px]">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-semibold text-foreground">
                {user.email}
              </p>
              {user.is_admin && (
                <span className="flex-shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                  Admin
                </span>
              )}
            </div>
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

        {/* Viewer column — every user is a viewer; status tracks
            email confirmation. Verified green vs amber pending. */}
        <td className="px-4 py-2">
          <StatusBadge
            tone={emailVerified ? "success" : "warning"}
            label={emailVerified ? "Verified" : "Email pending"}
          />
        </td>

        {/* Creator column — `—` when not a creator. Otherwise:
            email-not-confirmed → Email pending. Status pending →
            Pending review + Approve/Reject inline. Status verified
            → Verified + moderated date. Status rejected → Rejected
            (note shows in colspan strip below). */}
        <td className="px-4 py-2">
          {!isCreator ? (
            <span className="text-muted-foreground">—</span>
          ) : !emailVerified ? (
            <StatusBadge tone="warning" label="Email pending" />
          ) : isPendingCreator ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="warning" label="Pending review" />
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
          ) : user.creator_status === "verified" ? (
            <div className="flex flex-col gap-0.5">
              <StatusBadge tone="success" label="Verified" />
              {user.creator_moderated_at && (
                <span className="text-[10px] text-muted-foreground">
                  {dateFormatterShort.format(
                    new Date(user.creator_moderated_at),
                  )}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <StatusBadge tone="danger" label="Rejected" />
              {user.creator_moderated_at && (
                <span className="text-[10px] text-muted-foreground">
                  {dateFormatterShort.format(
                    new Date(user.creator_moderated_at),
                  )}
                </span>
              )}
            </div>
          )}
        </td>
      </tr>

      {/* Rejection note under the row when rejected */}
      {isRejectedCreator && user.creator_rejected_note && (
        <tr>
          <td colSpan={7} className="px-4 pb-3">
            <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              <strong className="font-semibold">Rejection note:</strong>{" "}
              {user.creator_rejected_note}
            </div>
          </td>
        </tr>
      )}

      {/* Inline Reject form */}
      {rejectOpen && isPendingCreator && (
        <tr>
          <td colSpan={7} className="px-4 pb-3">
            <div className="rounded-xl border border-border/60 bg-background p-3">
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
          </td>
        </tr>
      )}
    </>
  );
}

/** Tone-keyed status pill — shared between Viewer + Creator columns. */
function StatusBadge({
  tone,
  label,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
}) {
  const toneClasses = {
    success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    danger: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    neutral: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap",
        toneClasses[tone],
      )}
    >
      {label}
    </span>
  );
}

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

function ErrorBanner({ error }: { error: Error }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p>{error.message}</p>
    </div>
  );
}
