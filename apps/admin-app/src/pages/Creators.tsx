import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldX } from "lucide-react";
import { toast } from "sonner";

import { Button, CoinAmount, Input } from "@liverush/ui";
import { supabase } from "@/integrations/supabase/client";
import {
  AvatarCell,
  CopyIdCell,
  ErrorBanner,
  StatusBadge,
  TimezoneCell,
  dateFormatterShort,
  type UserRow,
} from "@/components/adminUserTable";

type StatusFilter = "all" | "pending" | "verified" | "rejected";

/**
 * /creators — everyone with a creator_profiles row (creator_status set).
 * Reads the same list_admin_users() RPC as /viewers (shared query key)
 * and filters client-side. The pending-creator approve/reject workflow
 * lives here, in the Verification column.
 *
 * Columns: Created · Avatar · ID · Email · Display name · Balance ·
 * Verification (status + moderated date + inline Approve/Reject) ·
 * Streams (total created · live/finished) · Timezone.
 *
 * The table is fixed-layout (`table-fixed`) with percentage column
 * widths so all nine columns fit the container with no horizontal
 * scroll; long text (email / display name / timezone) truncates with a
 * title tooltip.
 *
 * Balance here is the CREATOR balance (creator_balance_cents =
 * profiles.withdrawable_cents — the cashable rake pot), NOT the viewer
 * spending wallet.
 */
export default function Creators() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_admin_users");
      if (error) throw error;
      return (data ?? []) as UserRow[];
    },
  });

  // Creators only — anyone with a creator_profiles row.
  const creators = useMemo(
    () => (data ?? []).filter((u) => u.creator_status != null),
    [data],
  );

  const filtered = useMemo(() => {
    return creators.filter((u) => {
      if (statusFilter !== "all" && u.creator_status !== statusFilter)
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
  }, [creators, query, statusFilter]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">
          Creators
        </h1>
        {data && (
          <span className="text-sm text-muted-foreground">
            {creators.length} loaded · {filtered.length} shown
          </span>
        )}
      </header>

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email, name, or id…"
          className="max-w-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="all">All creators</option>
          <option value="pending">Pending review</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
        {(query || statusFilter !== "all") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQuery("");
              setStatusFilter("all");
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
            {creators.length === 0
              ? "No creators yet."
              : "No creators match these filters."}
          </div>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col style={{ width: "11%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "9%" }} />
            </colgroup>
            <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-3 py-2 font-semibold"></th>
                <th className="px-3 py-2 font-semibold">ID</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Display name</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
                <th className="px-3 py-2 font-semibold">Verification</th>
                <th className="px-3 py-2 font-semibold">Streams</th>
                <th className="px-3 py-2 font-semibold">Timezone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.map((creator) => (
                <CreatorRowItem
                  key={creator.id}
                  creator={creator}
                  onChange={invalidate}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CreatorRowItem({
  creator,
  onChange,
}: {
  creator: UserRow;
  onChange: () => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  const approveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("approve_creator", {
        p_creator_id: creator.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Approved ${creator.display_name ?? creator.email}`);
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!note.trim()) throw new Error("Note required");
      const { error } = await supabase.rpc("reject_creator", {
        p_creator_id: creator.id,
        p_note: note.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Rejected ${creator.display_name ?? creator.email}`);
      setRejectOpen(false);
      setNote("");
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const emailVerified = creator.email_confirmed_at != null;
  const isPending = creator.creator_status === "pending";
  const isRejected = creator.creator_status === "rejected";

  return (
    <>
      <tr>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          <span className="block truncate">
            {dateFormatterShort.format(new Date(creator.created_at))}
          </span>
        </td>
        <td className="px-3 py-2">
          <AvatarCell url={creator.avatar_url} />
        </td>
        <td className="px-3 py-2">
          <CopyIdCell id={creator.id} />
        </td>
        <td className="px-3 py-2 text-xs">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate font-semibold text-foreground" title={creator.email}>
              {creator.email}
            </p>
            {creator.is_admin && (
              <span className="flex-shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                Admin
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-xs">
          {creator.display_name ? (
            <span
              className="block truncate text-foreground"
              title={creator.display_name}
            >
              {creator.display_name}
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </td>
        <td className="px-3 py-2 text-right font-heading text-sm font-bold tabular-nums">
          <CoinAmount
            cents={creator.creator_balance_cents ?? 0}
            className="justify-end"
          />
        </td>

        {/* Verification — Email pending → Pending review (with Approve /
            Reject stacked below the badge) → Verified | Rejected (with
            moderated date). Buttons stack vertically so the column stays
            within its fixed width. */}
        <td className="px-3 py-2">
          {!emailVerified ? (
            <StatusBadge tone="warning" label="Email pending" />
          ) : isPending ? (
            <div className="flex flex-col gap-1">
              <StatusBadge tone="warning" label="Pending review" />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending}
                  className="text-xs font-semibold text-primary transition-opacity hover:underline disabled:opacity-50"
                >
                  {approveMutation.isPending ? (
                    <Loader2 className="inline h-3 w-3 animate-spin" />
                  ) : (
                    "Approve"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setRejectOpen((v) => !v)}
                  className="text-xs font-semibold text-destructive transition-opacity hover:underline"
                >
                  Reject
                </button>
              </div>
            </div>
          ) : creator.creator_status === "verified" ? (
            <div className="flex flex-col gap-0.5">
              <StatusBadge tone="success" label="Verified" />
              {creator.creator_moderated_at && (
                <span className="text-[10px] text-muted-foreground">
                  {dateFormatterShort.format(
                    new Date(creator.creator_moderated_at),
                  )}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <StatusBadge tone="danger" label="Rejected" />
              {creator.creator_moderated_at && (
                <span className="text-[10px] text-muted-foreground">
                  {dateFormatterShort.format(
                    new Date(creator.creator_moderated_at),
                  )}
                </span>
              )}
            </div>
          )}
        </td>

        {/* Streams — total authored, with the broadcast (live/finished)
            subset stacked underneath. */}
        <td
          className="px-3 py-2 text-xs"
          title={`${creator.streams_total} created · ${creator.streams_live} live or finished`}
        >
          <span className="block font-semibold text-foreground tabular-nums">
            {creator.streams_total} created
          </span>
          <span className="block text-muted-foreground">
            <span className="tabular-nums">{creator.streams_live}</span>{" "}
            live/fin
          </span>
        </td>

        <td className="px-3 py-2">
          <TimezoneCell timezone={creator.timezone} />
        </td>
      </tr>

      {/* Rejection note under the row when rejected */}
      {isRejected && creator.creator_rejected_note && (
        <tr>
          <td colSpan={9} className="px-3 pb-3">
            <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              <strong className="font-semibold">Rejection note:</strong>{" "}
              {creator.creator_rejected_note}
            </div>
          </td>
        </tr>
      )}

      {/* Inline Reject form */}
      {rejectOpen && isPending && (
        <tr>
          <td colSpan={9} className="px-3 pb-3">
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
