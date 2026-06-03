import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Gavel,
  ImageOff,
  Loader2,
  ShieldX,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button, CoinAmount, Input } from "@liverush/ui";
import { cn } from "@liverush/lib";
import { supabase } from "@/integrations/supabase/client";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  live: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  pending_moderation: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  settled: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  finished: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

// Lightweight SELECT for the list (only what the row needs). Full
// detail comes from EVENT_DETAIL_SELECT once the drawer opens.
//
// We fetch `event_outcomes(pool_cents)` and sum it client-side
// instead of reading `events.total_pool`. The latter is a legacy
// column that place_bet doesn't touch — the pari-mutuel pool lives
// per-outcome in `event_outcomes.pool_cents` and the running total
// is derived on demand. (Verified against
// 20260529_000001_betting_mvp.sql — place_bet updates
// event_outcomes.pool_cents only.)
const EVENT_LIST_SELECT = `
  id,
  title,
  status,
  created_at,
  scheduled_at,
  archived_at,
  creator:creator_profiles!events_creator_id_fkey ( id, handle, display_name ),
  event_outcomes!event_outcomes_event_id_fkey ( pool_cents )
` as const;

const EVENT_DETAIL_SELECT = `
  id,
  title,
  description,
  cover_url,
  video_url,
  playback_url,
  rules,
  category,
  round_format,
  status,
  created_at,
  scheduled_at,
  started_at,
  settled_at,
  cancelled_at,
  cancelled_reason,
  winning_outcome_ids,
  betting_closes_at,
  betting_window_minutes,
  archived_at,
  creator:creator_profiles!events_creator_id_fkey ( id, handle, display_name ),
  event_outcomes!event_outcomes_event_id_fkey ( pool_cents )
` as const;

type EventListRow = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  scheduled_at: string;
  archived_at: string | null;
  creator: { id: string; handle: string; display_name: string } | null;
  event_outcomes: { pool_cents: number }[] | null;
};

type EventDetail = EventListRow & {
  description: string | null;
  cover_url: string | null;
  video_url: string | null;
  playback_url: string | null;
  rules: string | null;
  category: string;
  round_format: string;
  started_at: string | null;
  settled_at: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  winning_outcome_ids: string[] | null;
  betting_closes_at: string | null;
  betting_window_minutes: number | null;
};

/** Sum per-outcome pool_cents into the true total pool for an event. */
function totalPoolCents(row: { event_outcomes: { pool_cents: number }[] | null }): number {
  return (row.event_outcomes ?? []).reduce(
    (acc, o) => acc + (o.pool_cents ?? 0),
    0,
  );
}

type OutcomeRow = {
  id: string;
  label: string;
  sort_order: number;
};

// User-app event-page URL. Hardcoded against the prod domain (admin
// is operator-only, no local-dev fallback needed).
const USER_APP_URL = "https://liverush.co";

/**
 * /events — admin view of every event regardless of status. Click a
 * row to open the side drawer with full payout detail + moderator
 * actions (settle / approve payouts / reject payouts).
 *
 * Admin RLS lets this SELECT see drafts and archived events too;
 * creators only see their own rows on the studio side.
 */
export default function Events() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(EVENT_LIST_SELECT)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as unknown as EventListRow[]) ?? [];
    },
  });

  // Client-side filter. Matches across event name, event id, and the
  // creator's id / handle / display_name so an operator can paste any
  // of those into the search to narrow the list.
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((evt) => {
      const haystack = [
        evt.title,
        evt.id,
        evt.creator?.id ?? "",
        evt.creator?.handle ?? "",
        evt.creator?.display_name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [data, query]);

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Events</h1>
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.length} loaded · {filtered.length} shown
          </span>
        )}
      </header>

      {/* Search — same shape and max-width as the Ledger filter input
          so the two admin tables present a consistent control surface. */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by event name, event id, or creator…"
          className="max-w-sm"
        />
        {query && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuery("")}
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
              ? "No events yet."
              : "No events match this search."}
          </div>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* Header style matches the Ledger table — same
                  bg-secondary/40 + uppercase tracking — so the two
                  admin tables read as a set. */}
              <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-semibold">When</th>
                  <th className="px-4 py-2 font-semibold">Name</th>
                  <th className="px-4 py-2 font-semibold">Event ID</th>
                  <th className="px-4 py-2 font-semibold">Creator</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 text-right font-semibold">Total pool</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((evt) => (
                  <tr
                    key={evt.id}
                    onClick={() => setSelectedId(evt.id)}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-secondary/40",
                      selectedId === evt.id && "bg-secondary/60",
                    )}
                  >
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {dateFormatter.format(new Date(evt.created_at))}
                    </td>
                    {/* Name cell — title + external-link icon to the
                        public event page. stopPropagation on the link
                        so clicking it doesn't also open the drawer. */}
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5 min-w-[180px] max-w-[280px]">
                        <span className="truncate text-xs font-semibold text-foreground" title={evt.title}>
                          {evt.title}
                        </span>
                        <a
                          href={`${USER_APP_URL}/event/${evt.id}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                          aria-label="Open event in user-app"
                          title="Open event in user-app"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void navigator.clipboard.writeText(evt.id);
                          toast.success("Copied event id");
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-secondary/60"
                        title={evt.id}
                        aria-label="Copy event id"
                      >
                        {evt.id.slice(0, 12)}
                        <Copy className="h-3 w-3" />
                      </button>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <div className="min-w-0 max-w-[180px]">
                        <p className="truncate font-semibold text-foreground">
                          {evt.creator?.display_name ?? "—"}
                        </p>
                        {evt.creator?.handle && (
                          <p className="truncate text-[10px] text-muted-foreground">
                            @{evt.creator.handle}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={evt.status} />
                        {evt.archived_at && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Archived
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-heading text-sm font-bold tabular-nums whitespace-nowrap">
                      <CoinAmount cents={totalPoolCents(evt)} className="justify-end" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedId && (
        <EventDrawer
          eventId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STATUS_BADGE[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}

/* ============================================================
 * Drawer — event detail + actions
 * ============================================================ */

type PayoutRow = {
  id: string;
  type: string;
  recipient_id: string | null;
  recipient_kind: string;
  amount_cents: number;
  status: string;
  reject_reason: string | null;
  reject_notes: string | null;
  bet_id: string | null;
  created_at: string;
  completed_at: string | null;
};

function EventDrawer({
  eventId,
  onClose,
}: {
  eventId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: event } = useQuery({
    queryKey: ["admin", "events", eventId, "detail"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(EVENT_DETAIL_SELECT)
        .eq("id", eventId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as EventDetail | null;
    },
  });

  const { data: outcomes } = useQuery({
    queryKey: ["admin", "events", eventId, "outcomes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_outcomes")
        .select("id, label, sort_order")
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as OutcomeRow[]) ?? [];
    },
  });

  const { data: payouts } = useQuery({
    queryKey: ["admin", "events", eventId, "payouts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payouts")
        .select(
          "id, type, recipient_id, recipient_kind, amount_cents, status, reject_reason, reject_notes, bet_id, created_at, completed_at",
        )
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as PayoutRow[]) ?? [];
    },
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "events"] });
    void queryClient.invalidateQueries({
      queryKey: ["admin", "events", eventId],
    });
  };

  const settleMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("settle_event", {
        p_event_id: eventId,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (result: any) => {
      if (result?.cancelled) {
        toast.warning(`Event auto-cancelled: ${result.reason ?? "unknown"}`);
      } else {
        toast.success("Event settled — payouts created.");
      }
      invalidateAll();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const approveAllMutation = useMutation({
    mutationFn: async () => {
      const pending = (payouts ?? []).filter((p) => p.status === "pending");
      let approved = 0;
      let failed = 0;
      for (const p of pending) {
        const { error } = await supabase.rpc("approve_payout", {
          p_payout_id: p.id,
          p_idempotency_key: crypto.randomUUID(),
        });
        if (error) failed += 1;
        else approved += 1;
      }
      return { approved, failed };
    },
    onSuccess: ({ approved, failed }) => {
      if (approved > 0) {
        toast.success(
          `Approved ${approved} payout${approved === 1 ? "" : "s"}`,
        );
      }
      if (failed > 0) {
        toast.error(`${failed} approval(s) failed — see logs`);
      }
      invalidateAll();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const pendingPayouts = (payouts ?? []).filter((p) => p.status === "pending");
  const canSettle = event?.status === "pending_moderation";
  const canApproveAll = pendingPayouts.length > 0;

  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        type="button"
        className="flex-1 bg-black/50"
        aria-label="Close drawer"
        onClick={onClose}
      />
      <aside className="flex w-full max-w-2xl flex-col bg-background shadow-2xl">
        {/* Drawer header */}
        <header className="flex items-start justify-between gap-3 border-b border-border/40 px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-lg font-bold">
              {event?.title ?? "Loading…"}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <span className="font-mono">{eventId}</span>
            </p>
          </div>
          {/* External link to the public user-app event page — handy
              for cross-checking what the audience sees while moderating. */}
          <a
            href={`${USER_APP_URL}/event/${eventId}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            aria-label="Open event in user-app"
            title="Open event in user-app"
          >
            <ExternalLink className="h-5 w-5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!event && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {event && (
            <div className="space-y-6">
              {/* Cover preview — compact thumbnail matching the
                  studio EventEditor's cover slot (h-24 w-32) so the
                  drawer doesn't waste vertical space on the asset.
                  Click the thumbnail to open the full image in a
                  new tab. */}
              {event.cover_url ? (
                <a
                  href={event.cover_url}
                  target="_blank"
                  rel="noreferrer"
                  className="group block h-24 w-32 overflow-hidden rounded-xl border border-border/40 bg-muted"
                  title="Open full image"
                >
                  <img
                    src={event.cover_url}
                    alt={event.title}
                    className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                  />
                </a>
              ) : (
                <div className="flex h-24 w-32 flex-col items-center justify-center rounded-xl border border-dashed border-border/60 text-muted-foreground">
                  <ImageOff className="h-5 w-5" />
                  <span className="mt-1 text-[10px]">No cover</span>
                </div>
              )}

              {/* Description + rules — both can wrap. whitespace-pre-wrap
                  preserves creator-authored line breaks. */}
              {event.description && (
                <section>
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Description
                  </h3>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {event.description}
                  </p>
                </section>
              )}

              {event.rules && (
                <section>
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Rules
                  </h3>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {event.rules}
                  </p>
                </section>
              )}

              {/* Outcomes list — same order the creator saw in studio
                  + the bettor saw in the user-app. Winning outcomes
                  (post-declare) get a highlight pill so the admin can
                  spot-check the result against the live stream. */}
              <section>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Outcomes ({outcomes?.length ?? 0})
                </h3>
                {!outcomes ? (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : outcomes.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/60 py-3 text-center text-sm text-muted-foreground">
                    No outcomes defined yet.
                  </p>
                ) : (
                  <ol className="space-y-1.5">
                    {outcomes.map((o, idx) => {
                      const isWinner = event.winning_outcome_ids?.includes(o.id);
                      return (
                        <li
                          key={o.id}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                            isWinner
                              ? "border-emerald-500/40 bg-emerald-500/10"
                              : "border-border/40 bg-card",
                          )}
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            #{idx + 1}
                          </span>
                          <span className="flex-1 truncate font-medium text-foreground">
                            {o.label}
                          </span>
                          {isWinner && (
                            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                              Winner
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              {/* Event meta */}
              <section>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Meta
                </h3>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <DetailField label="Status">
                    <StatusBadge status={event.status} />
                  </DetailField>
                  <DetailField label="Creator">
                    {event.creator?.display_name ?? "—"}
                    {event.creator?.handle && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        @{event.creator.handle}
                      </span>
                    )}
                  </DetailField>
                  <DetailField label="Category">{event.category}</DetailField>
                  <DetailField label="Round format">
                    {event.round_format}
                  </DetailField>
                  <DetailField label="Total pool">
                    <CoinAmount cents={totalPoolCents(event)} />
                  </DetailField>
                  <DetailField label="Betting window">
                    {event.betting_window_minutes != null
                      ? `${event.betting_window_minutes} min`
                      : "—"}
                  </DetailField>
                  <DetailField label="Scheduled at">
                    {event.scheduled_at
                      ? dateFormatter.format(new Date(event.scheduled_at))
                      : "—"}
                  </DetailField>
                  <DetailField label="Started at">
                    {event.started_at
                      ? dateFormatter.format(new Date(event.started_at))
                      : "—"}
                  </DetailField>
                  <DetailField label="Settled at">
                    {event.settled_at
                      ? dateFormatter.format(new Date(event.settled_at))
                      : "—"}
                  </DetailField>
                  {event.betting_closes_at && (
                    <DetailField label="Betting closes">
                      {dateFormatter.format(new Date(event.betting_closes_at))}
                    </DetailField>
                  )}
                  {event.cancelled_at && (
                    <DetailField label="Cancelled" wide>
                      {dateFormatter.format(new Date(event.cancelled_at))}
                      {event.cancelled_reason && (
                        <span className="ml-1 text-muted-foreground">
                          — {event.cancelled_reason}
                        </span>
                      )}
                    </DetailField>
                  )}
                </dl>
              </section>

              {/* Action buttons */}
              <section className="rounded-xl border border-border/40 bg-card p-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Moderator actions
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => settleMutation.mutate()}
                    disabled={!canSettle || settleMutation.isPending}
                  >
                    {settleMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Gavel className="h-3.5 w-3.5" />
                    )}
                    Settle event
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => approveAllMutation.mutate()}
                    disabled={
                      !canApproveAll || approveAllMutation.isPending
                    }
                  >
                    {approveAllMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    Approve all pending ({pendingPayouts.length})
                  </Button>
                </div>
                {!canSettle && event.status !== "settled" && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Settle is only available when status is
                    {" "}<code>pending_moderation</code>.
                  </p>
                )}
              </section>

              {/* Payouts table */}
              <section>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Payouts ({(payouts ?? []).length})
                </h3>
                {!payouts && (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                )}
                {payouts && payouts.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border/60 py-6 text-center text-sm text-muted-foreground">
                    No payouts yet — settle the event to create them.
                  </p>
                )}
                {payouts && payouts.length > 0 && (
                  <div className="divide-y divide-border/40 rounded-xl border border-border/40 bg-card">
                    {payouts.map((p) => (
                      <PayoutRowCard
                        key={p.id}
                        payout={p}
                        onChange={invalidateAll}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function DetailField({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn(wide && "col-span-2")}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function PayoutRowCard({
  payout,
  onChange,
}: {
  payout: PayoutRow;
  onChange: () => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const approveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("approve_payout", {
        p_payout_id: payout.id,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payout approved");
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("Reason required");
      const { error } = await supabase.rpc("reject_payout", {
        p_payout_id: payout.id,
        p_reason: reason.trim(),
        p_notes: notes.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payout rejected");
      setRejectOpen(false);
      setReason("");
      setNotes("");
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {payout.type.replace("_", " ")}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                payout.status === "pending" &&
                  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                payout.status === "completed" &&
                  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                payout.status === "rejected" &&
                  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
              )}
            >
              {payout.status}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {payout.recipient_kind}
            {payout.recipient_id && (
              <>
                {" "}
                ·{" "}
                <span className="font-mono">
                  {payout.recipient_id.slice(0, 8)}
                </span>
              </>
            )}
          </p>
          {payout.status === "rejected" && payout.reject_reason && (
            <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
              {payout.reject_reason}
              {payout.reject_notes && ` — ${payout.reject_notes}`}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="font-heading text-sm font-bold tabular-nums">
            <CoinAmount cents={payout.amount_cents} />
          </p>
        </div>
      </div>

      {payout.status === "pending" && (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant="outline"
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
            <ShieldX className="h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      )}

      {rejectOpen && payout.status === "pending" && (
        <div className="mt-2 rounded-xl border border-border/60 bg-background p-3">
          <label className="text-xs font-semibold text-foreground">
            Reason (required)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. suspicious_activity"
            className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <label className="mt-3 block text-xs font-semibold text-foreground">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="More context that the recipient can see in their email."
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRejectOpen(false);
                setReason("");
                setNotes("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending || !reason.trim()}
            >
              {rejectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Confirm rejection
            </Button>
          </div>
        </div>
      )}
    </div>
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
