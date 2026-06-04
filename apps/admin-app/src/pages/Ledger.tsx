import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button, CoinAmount, Input } from "@liverush/ui";
import { cn, formatDollarCents } from "@liverush/lib";
import { supabase } from "@/integrations/supabase/client";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "deposit", label: "deposit" },
  { value: "bet", label: "bet" },
  { value: "withdrawal", label: "withdrawal" },
  { value: "payout_pending", label: "payout_pending" },
  { value: "payout_credit", label: "payout_credit" },
  { value: "payout_reverse", label: "payout_reverse" },
  { value: "refund", label: "refund" },
  { value: "rake", label: "rake" },
  { value: "residual", label: "residual" },
  { value: "adjustment", label: "adjustment" },
  // Added by the 20260604_000001_ledger_rebuild.sql migration.
  { value: "top_up", label: "top_up" },
  { value: "top_up_received", label: "top_up_received" },
  { value: "starter_grant", label: "starter_grant" },
  { value: "payout_request", label: "payout_request" },
  { value: "payout_paid", label: "payout_paid" },
];

// Both `platform` (rake/residual coin earnings) and `platform_cash`
// (the AUD treasury — top-up inflows + payout outflows) are conceptually
// the same actor — the platform. Render them with one shared blue badge
// in the Role column so the operator's eye groups them as "the platform";
// the Account + Type columns already disambiguate which side moved
// (Platform / Platform cash and rake vs top_up_received vs payout_paid).
const ROLE_BADGE_CLASSES: Record<string, string> = {
  platform: "bg-primary/15 text-primary",
  platform_cash: "bg-primary/15 text-primary",
  event_pool: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  creator: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  viewer: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  unknown: "bg-muted text-muted-foreground",
};

const ROLE_LABELS: Record<string, string> = {
  platform: "Platform",
  platform_cash: "Platform",
  event_pool: "Event pool",
  creator: "Creator",
  viewer: "Viewer",
  unknown: "—",
};

type LedgerRow = {
  id: string;
  account: string;
  account_role:
    | "platform"
    | "platform_cash"
    | "event_pool"
    | "creator"
    | "viewer"
    | "unknown";
  account_label: string;
  account_id: string | null;
  type: string;
  amount_cents: number;
  // Added by the 20260604_000001_ledger_rebuild.sql migration. Null
  // on every row written before that migration.
  amount_cash_cents: number | null;
  reference_id: string | null;
  event_id: string | null;
  event_title: string | null;
  created_at: string;
};

const PAGE_SIZE = 100;
const USER_APP_URL = "https://liverush.co";

/**
 * /ledger — flat chronological timeline of every ledger_entries row.
 *
 * No grouping: bets, payouts, refunds, deposits across different
 * events stream in side-by-side ordered strictly by created_at desc.
 * This is how an operator reviews "what happened at 14:32" — across
 * everything, not per event.
 *
 * Columns:
 *   When | Account | Role | Event | Type | Amount | Ref
 *
 * `Account` is the resolved name (display_name → email → handle),
 * `Role` is a context-aware badge (a creator placing a bet shows as
 * Viewer in that row), and `Account ID` lives as a small caption
 * underneath the name for traceability without crowding.
 */
export default function Ledger() {
  const [accountFilter, setAccountFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const { data, error } = await supabase.rpc("list_admin_ledger", {
        p_limit: PAGE_SIZE,
        p_cursor: null,
      });
      if (cancelled) return;
      if (error) {
        setError(error as Error);
        setLoading(false);
        return;
      }
      const page = (data as LedgerRow[]) ?? [];
      setRows(page);
      setReachedEnd(page.length < PAGE_SIZE);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = async () => {
    if (loadingMore || reachedEnd) return;
    const cursor = rows.at(-1)?.created_at ?? null;
    if (!cursor) return;
    setLoadingMore(true);
    const { data, error } = await supabase.rpc("list_admin_ledger", {
      p_limit: PAGE_SIZE,
      p_cursor: cursor,
    });
    setLoadingMore(false);
    if (error) {
      setError(error as Error);
      return;
    }
    const page = (data as LedgerRow[]) ?? [];
    const seen = new Set(rows.map((r) => r.id));
    const newRows = page.filter((r) => !seen.has(r.id));
    setRows((prev) => [...prev, ...newRows]);
    setReachedEnd(page.length < PAGE_SIZE);
  };

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (accountFilter) {
        const q = accountFilter.toLowerCase();
        // Include event_id in the haystack so pasting an event id
        // into the filter pulls every ledger row tied to that event
        // (bets + payouts + pool entries + refunds), not just the
        // event_pool rows where the id lives inside `account`.
        const haystack = [
          row.account,
          row.account_label,
          row.account_id ?? "",
          row.event_id ?? "",
          row.event_title ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (typeFilter && row.type !== typeFilter) return false;
      return true;
    });
  }, [rows, accountFilter, typeFilter]);

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Ledger</h1>
        <span className="text-sm text-muted-foreground">
          {rows.length} loaded · {filtered.length} shown
        </span>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          placeholder="Filter by name, account id, event…"
          className="max-w-sm"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {(accountFilter || typeFilter) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAccountFilter("");
              setTypeFilter("");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {error && <ErrorBanner error={error} />}

      <div className="overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? "No ledger entries yet."
              : "No ledger entries match these filters."}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-semibold">When</th>
                    <th className="px-4 py-2 font-semibold">Account</th>
                    <th className="px-4 py-2 font-semibold">Account ID</th>
                    <th className="px-4 py-2 font-semibold">Role</th>
                    <th className="px-4 py-2 font-semibold">Event ID</th>
                    <th className="px-4 py-2 font-semibold">Type</th>
                    <th className="px-4 py-2 text-right font-semibold">Amount</th>
                    <th className="px-4 py-2 text-right font-semibold">Cash</th>
                    <th className="px-4 py-2 font-semibold">Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {dateFormatter.format(new Date(row.created_at))}
                      </td>
                      <td className="px-4 py-2 text-xs font-semibold text-foreground">
                        <span className="block max-w-[180px] truncate">
                          {row.account_label}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <CopyIdCell
                          id={row.account_id}
                          ariaLabel="Copy account id"
                          toastLabel="Copied account id"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <RoleBadge role={row.account_role} />
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <EventIdCell
                          eventId={row.event_id}
                          eventTitle={row.event_title}
                        />
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px]">
                          {row.type}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2 text-right font-heading font-bold tabular-nums whitespace-nowrap",
                          row.amount_cents > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : row.amount_cents < 0
                              ? "text-rose-600 dark:text-rose-400"
                              : "",
                        )}
                      >
                        {row.amount_cents === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 leading-none">
                            {row.amount_cents > 0 && "+"}
                            <CoinAmount cents={row.amount_cents} />
                          </span>
                        )}
                      </td>
                      {/* Cash only renders on the `platform_cash` side — that's
                          the only account where the cash inflow/outflow is
                          recorded (top_up_received credits in, payout_paid
                          debits out). User-side top_up / payout_request rows
                          carry the same cash number on the DB row as
                          contextual metadata, but showing "+$10.00" next to a
                          viewer's name reads as "viewer got $10 cash" — they
                          paid it via the mock checkout, didn't receive it.
                          Hide there. */}
                      <td
                        className={cn(
                          "px-4 py-2 text-right font-heading font-bold tabular-nums whitespace-nowrap",
                          row.account_role === "platform_cash" &&
                            row.amount_cash_cents != null &&
                            row.amount_cash_cents > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : row.account_role === "platform_cash" &&
                                row.amount_cash_cents != null &&
                                row.amount_cash_cents < 0
                              ? "text-rose-600 dark:text-rose-400"
                              : "",
                        )}
                      >
                        {row.account_role !== "platform_cash" ||
                        row.amount_cash_cents == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {row.amount_cash_cents > 0 && "+"}
                            {formatDollarCents(row.amount_cash_cents)}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <ReferenceCell reference={row.reference_id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-center border-t border-border/40 py-3">
              {reachedEnd ? (
                <p className="text-xs text-muted-foreground">End of ledger.</p>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Load more
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Reusable click-to-copy short-id chip. Same UI for Account ID and
 * any other uuid column where the operator might want the full
 * value on the clipboard.
 */
function CopyIdCell({
  id,
  ariaLabel,
  toastLabel,
}: {
  id: string | null;
  ariaLabel: string;
  toastLabel: string;
}) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(id);
        toast.success(toastLabel);
      }}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-secondary/60"
      title={id}
    >
      {id.slice(0, 8)}
      <Copy className="h-3 w-3" />
    </button>
  );
}

function RoleBadge({ role }: { role: LedgerRow["account_role"] }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap",
        ROLE_BADGE_CLASSES[role] ?? ROLE_BADGE_CLASSES.unknown,
      )}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

/**
 * Event ID column — short event_id with copy icon, then external link
 * icon to the public event page. The full event id goes on the
 * clipboard so the admin can paste it into the filter search above
 * to pull every ledger row tied to that event together.
 *
 * Renders `—` for ledger rows that don't tie to an event (deposits,
 * manual adjustments, top-ups).
 */
function EventIdCell({
  eventId,
  eventTitle,
}: {
  eventId: string | null;
  eventTitle: string | null;
}) {
  if (!eventId) return <span className="text-muted-foreground">—</span>;
  const fullTitle = eventTitle ? `${eventId} — ${eventTitle}` : eventId;
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(eventId);
          toast.success("Copied event id");
        }}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-secondary/60"
        title={fullTitle}
        aria-label="Copy event id"
      >
        {eventId.slice(0, 12)}
        <Copy className="h-3 w-3" />
      </button>
      <a
        href={`${USER_APP_URL}/event/${eventId}`}
        target="_blank"
        rel="noreferrer"
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        aria-label="Open event in user-app"
        title="Open event in user-app"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function ReferenceCell({ reference }: { reference: string | null }) {
  if (!reference) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(reference);
        toast.success("Copied");
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-secondary/60"
      title={reference}
    >
      {reference.slice(0, 8)}
      <Copy className="h-3 w-3" />
    </button>
  );
}

function ErrorBanner({ error }: { error: Error }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p className="flex-1">{error.message}</p>
    </div>
  );
}
