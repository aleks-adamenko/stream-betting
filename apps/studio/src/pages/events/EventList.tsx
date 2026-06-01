import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Bell,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Radio,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Button } from "@liverush/ui";
import { cn } from "@liverush/lib";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  // After declare_winner, before moderator approval.
  pending_moderation: "Pending settlement",
  // After moderator approves payouts. We show "Finished" everywhere
  // the viewer/creator sees it — the schema name `settled` stays in
  // the DB but never reaches the UI.
  settled: "Finished",
  finished: "Finished",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-primary/10 text-primary",
  live: "bg-destructive/15 text-destructive",
  pending_moderation: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  settled: "bg-success/15 text-success",
  finished: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

// The 4-step model used in the editor — kept in sync so list completion
// reflects exactly what the editor considers "done" per section.
const TOTAL_STEPS = 4;

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  scheduled_at: string;
  cover_url: string | null;
  category: string;
  created_at: string;
  rules: string | null;
  round_format: "time" | "event";
  round_duration_sec: number | null;
  min_bet_cents: number | null;
  max_bet_cents: number | null;
  source_type: string | null;
  video_url: string | null;
  archived_at: string | null;
  outcomes: Array<{ label: string }>;
};

type TabId = "all" | "live" | "finished" | "drafts" | "archived";

const FINISHED_STATUSES = new Set([
  "finished",
  "settled",
  "pending_moderation",
  "cancelled",
]);

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "finished", label: "Finished" },
  { id: "drafts", label: "Drafts" },
  { id: "archived", label: "Archived" },
];

/**
 * Mirror of the per-step completion predicates inside EventEditor — kept
 * here so the list can show progress without re-opening the draft. If
 * the editor's predicates change, update both places (or extract into
 * @liverush/lib later).
 */
function completedStepsCount(event: EventRow): number {
  const title = (event.title ?? "").trim();
  const description = (event.description ?? "").trim();
  const rules = (event.rules ?? "").trim();
  const labels = event.outcomes
    .map((o) => o.label.trim().toLowerCase())
    .filter(Boolean);
  const uniqueLabels = new Set(labels);

  // Merged "Challenge" step — owns what used to be Basics too.
  const challenge =
    title.length >= 5 &&
    description.length > 0 &&
    !!event.cover_url &&
    rules.length >= 30 &&
    (event.round_format !== "time" || (event.round_duration_sec ?? 0) > 0);

  const betLimitsValid =
    event.min_bet_cents !== null &&
    event.max_bet_cents !== null &&
    event.min_bet_cents >= 100 &&
    event.max_bet_cents >= event.min_bet_cents &&
    event.max_bet_cents <= 1_000_000;

  const betting =
    labels.length >= 2 &&
    uniqueLabels.size === labels.length &&
    betLimitsValid;

  const stream =
    !!event.scheduled_at &&
    new Date(event.scheduled_at).getTime() > Date.now() &&
    (event.source_type !== "external_url" ||
      (event.video_url ?? "").trim().length > 0);

  // Review mirrors "all other steps complete" — same rule as editor.
  const review = challenge && betting && stream;

  return [challenge, betting, stream, review].filter(Boolean).length;
}

export default function EventList() {
  const { creator } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const verifiedCreator = creator?.status === "verified";

  const { data: events, isLoading } = useQuery({
    queryKey: ["studio", "events", creator?.id],
    enabled: !!creator,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(
          `
          id, title, description, status, scheduled_at, cover_url, category, created_at,
          rules, round_format, round_duration_sec,
          min_bet_cents, max_bet_cents,
          source_type, video_url,
          archived_at,
          outcomes:event_outcomes!event_outcomes_event_id_fkey ( label )
        `,
        )
        .eq("creator_id", creator!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as EventRow[];
    },
  });

  // Per-event bet counts — the bets RLS policy hides viewer bets from
  // the creator, so a naive `bets(count)` aggregate returns 0 even
  // when viewers have bet. This SECURITY DEFINER RPC bypasses RLS but
  // scopes to creator_id = auth.uid() so a creator can only see counts
  // for events they own. The map drives Delete vs Archive UI below.
  const { data: betCounts } = useQuery({
    queryKey: ["studio", "events", "bet-counts", creator?.id],
    enabled: !!creator,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "list_creator_event_bet_counts",
      );
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data ?? []) {
        map.set(row.event_id, row.bet_count ?? 0);
      }
      return map;
    },
  });

  // Subscriber counts for all the creator's scheduled events. Fans
  // out N parallel RPC calls (the count predicate is fast +
  // index-friendly). Refreshes whenever the events list refreshes.
  const scheduledIds = (events ?? [])
    .filter((e) => e.status === "scheduled")
    .map((e) => e.id);
  const subscriberCounts = useQuery({
    queryKey: ["studio", "event-subscriber-counts", scheduledIds.join(",")],
    enabled: scheduledIds.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        scheduledIds.map(async (id) => {
          const { data, error } = await supabase.rpc(
            "get_event_subscriber_count",
            { p_event_id: id },
          );
          if (error) {
            console.warn("subscriber count failed for", id, error.message);
            return [id, 0] as const;
          }
          return [id, (data as number) ?? 0] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
  });

  // Inline delete from the list — uses the same SQL RPC as the editor's
  // Delete button. RLS decides what can actually be deleted (drafts +
  // scheduled at the moment; finished/live get a 403 which we surface
  // as a toast). Confirmation is a plain `confirm()` because the
  // affordance is destructive but rare enough that bringing in a modal
  // component would be overkill.
  // Tab state — drives the filter applied to the events list below.
  // Default to "All" so the creator sees their whole catalogue.
  const [activeTab, setActiveTab] = useState<TabId>("all");

  const deleteMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.rpc("delete_event", {
        p_event_id: eventId,
      });
      if (error) throw error;
      return eventId;
    },
    onSuccess: () => {
      toast.success("Event deleted");
      void queryClient.invalidateQueries({
        queryKey: ["studio", "events", creator?.id],
      });
    },
    onError: (err) => {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Delete failed";
      toast.error(message);
    },
  });

  // Archive = soft-delete for events that have / could have financial
  // history (anything past the live broadcast). Hides from the list
  // and the user-app feed; ledger / payouts / bets stay intact.
  const archiveMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.rpc("archive_event", {
        p_event_id: eventId,
      });
      if (error) throw error;
      return eventId;
    },
    onSuccess: () => {
      toast.success("Event archived");
      void queryClient.invalidateQueries({
        queryKey: ["studio", "events", creator?.id],
      });
    },
    onError: (err) => {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Archive failed";
      toast.error(message);
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.rpc("unarchive_event", {
        p_event_id: eventId,
      });
      if (error) throw error;
      return eventId;
    },
    onSuccess: () => {
      toast.success("Event restored");
      void queryClient.invalidateQueries({
        queryKey: ["studio", "events", creator?.id],
      });
    },
    onError: (err) => {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Restore failed";
      toast.error(message);
    },
  });

  // Per-tab event counts for the tab bar pills. Computed off the
  // unfiltered list so counts are stable across tab switches.
  const tabCounts = useMemo(() => {
    const counts: Record<TabId, number> = {
      all: 0, live: 0, finished: 0, drafts: 0, archived: 0,
    };
    for (const e of events ?? []) {
      if (e.archived_at) {
        counts.archived += 1;
        continue; // archived rows don't appear in any non-archived tab
      }
      counts.all += 1;
      if (e.status === "live") counts.live += 1;
      else if (e.status === "draft") counts.drafts += 1;
      else if (FINISHED_STATUSES.has(e.status)) counts.finished += 1;
    }
    return counts;
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    return events.filter((e) => {
      if (activeTab === "archived") return !!e.archived_at;
      if (e.archived_at) return false; // hide archived from all other tabs
      if (activeTab === "all") return true;
      if (activeTab === "live") return e.status === "live";
      if (activeTab === "drafts") return e.status === "draft";
      if (activeTab === "finished") return FINISHED_STATUSES.has(e.status);
      return true;
    });
  }, [events, activeTab]);

  const publishMutation = useMutation({
    mutationFn: async (eventId: string) => {
      // Go through the provision-stream Edge Function so Mux gets a
      // live stream + the events row gets stamped with the playback
      // id. The function calls publish_event internally to flip
      // status. Idempotent on event_id.
      const { error } = await supabase.functions.invoke("provision-stream", {
        body: { event_id: eventId },
      });
      if (error) throw error;
      return eventId;
    },
    onSuccess: (eventId) => {
      toast.success("Event published");
      void queryClient.invalidateQueries({
        queryKey: ["studio", "events", creator?.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["studio", "event", eventId],
      });
    },
    onError: (err) => {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Publish failed";
      toast.error(message);
    },
  });

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold sm:text-3xl">My events</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Every event you've drafted or published lives here.
          </p>
        </div>
        <Button asChild variant="accent" size="lg">
          <Link to="/events/new">
            <Plus className="h-4 w-4" />
            New event
          </Link>
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-border/40 bg-card"
            />
          ))}
        </div>
      )}

      {!isLoading && events && events.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 p-12 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-4 font-heading text-lg font-semibold">
            No events yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Spin up your first betting event in a couple of minutes.
          </p>
          <Button asChild variant="accent" size="lg" className="mt-5">
            <Link to="/events/new">
              <Plus className="h-4 w-4" />
              Create your first event
            </Link>
          </Button>
        </div>
      )}

      {/* Tab bar — same visual language as the user-app filter chips
          and the Balance page filter pills. */}
      {!isLoading && events && events.length > 0 && (
        <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-border/40 bg-card p-1 shadow-sm">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:text-sm",
                activeTab === tab.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary/40",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                  activeTab === tab.id
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground/80",
                )}
              >
                {tabCounts[tab.id]}
              </span>
            </button>
          ))}
        </nav>
      )}

      {!isLoading && events && events.length > 0 && filteredEvents.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {activeTab === "archived"
              ? "No archived events. Archive a finished event from the All / Finished tab to keep your list clean."
              : "Nothing in this tab yet."}
          </p>
        </div>
      )}

      {!isLoading && filteredEvents.length > 0 && (
        <ul className="space-y-3">
          {filteredEvents.map((event) => {
            const isDraft = event.status === "draft";
            const isScheduled = event.status === "scheduled";
            const isLive = event.status === "live";
            // After Phase 1 the natural "ended" cluster spans the three
            // terminal statuses. Used for the "hide scheduled_at /
            // hide delete" UX so the row reads cleanly post-end.
            const isFinished =
              event.status === "finished" ||
              event.status === "settled" ||
              event.status === "pending_moderation";
            const stepsDone = isDraft
              ? completedStepsCount(event)
              : TOTAL_STEPS;
            const isComplete = stepsDone === TOTAL_STEPS;
            const publishing =
              publishMutation.isPending &&
              publishMutation.variables === event.id;
            const canPublish = isDraft && isComplete && verifiedCreator;
            const publishTooltip = !verifiedCreator
              ? "Publishing unlocks once your account is verified"
              : !isComplete
                ? "Complete every section in the editor to publish"
                : undefined;

            // Start Stream unlocks the moment the scheduled time
            // arrives. We don't auto-flip to live ourselves — the
            // creator clicks Start Stream → camera grant → start_event
            // RPC.
            const startTimeMs = new Date(event.scheduled_at).getTime();
            const canStartStream = isScheduled && startTimeMs <= Date.now();
            const startStreamTooltip = !canStartStream
              ? "Available at the scheduled start time"
              : undefined;

            const deleting =
              deleteMutation.isPending &&
              deleteMutation.variables === event.id;
            const archiving =
              archiveMutation.isPending &&
              archiveMutation.variables === event.id;
            const unarchiving =
              unarchiveMutation.isPending &&
              unarchiveMutation.variables === event.id;
            // Edit + destructive affordances are status-aware:
            //   • Live: no edit (the event is broadcasting) and no
            //     destructive action (mid-stream).
            //   • Scheduled: edit allowed, no destructive action
            //     (a Cloudflare resource is provisioned).
            //   • Draft: edit + delete. Hard delete is safe — no
            //     bets, no ledger, no Cloudflare resource yet.
            //   • Terminal states (finished / cancelled) with zero
            //     bets ever: hard delete is safe too — nothing in the
            //     ledger to preserve. We surface a Delete icon so the
            //     creator doesn't have to flip through an Archive tab
            //     for events nobody touched.
            //   • Terminal states with bets (settled, pending_moderation,
            //     finished/cancelled w/ bets): archive only — ledger
            //     audit trail must stay intact.
            // Reads from the RPC-fed map, not the bets aggregate join
            // — the latter is RLS-blocked from seeing viewer bets and
            // would always come back 0 for a creator who didn't bet on
            // their own event.
            const betsCount = betCounts?.get(event.id) ?? 0;
            const hasBets = betsCount > 0;
            const canEdit = isDraft || isScheduled;
            const isArchived = !!event.archived_at;
            // Delete: draft always; finished/cancelled only if zero bets.
            // settled / pending_moderation never (always had bets to settle).
            const canDelete =
              !isArchived &&
              (isDraft ||
                ((event.status === "finished" || event.status === "cancelled") &&
                  !hasBets));
            // Archive: any non-archived terminal state with bets (or
            // settled/pending_moderation which by definition had bets).
            const canArchive =
              !isArchived &&
              FINISHED_STATUSES.has(event.status) &&
              !canDelete;
            const canUnarchive = isArchived;
            // External user-app affordances — visible for everything
            // except drafts (drafts don't have a public /event/:id
            // page yet, so the link would 404 / redirect home).
            const hasPublicPage = !isDraft;
            const publicEventUrl = `https://liverush.co/event/${event.id}`;
            const copyPublicLink = async () => {
              try {
                await navigator.clipboard.writeText(publicEventUrl);
                toast.success("Event link copied");
              } catch {
                toast.error("Couldn't copy link — your browser blocked it");
              }
            };

            return (
              <li
                key={event.id}
                className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5"
              >
                <div className="flex items-center gap-4">
                  {/* Row body — NOT clickable. The Edit icon on the
                      right is the dedicated affordance to open the
                      editor. This prevents accidental nav when the
                      creator only meant to glance at a row. */}
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    {event.cover_url ? (
                      <img
                        src={event.cover_url}
                        alt=""
                        className="h-16 w-16 flex-shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <CalendarClock className="h-6 w-6" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-heading text-base font-semibold text-foreground sm:text-lg">
                        {event.title}
                      </p>

                      {/* Status pill + scheduled date sitting together
                          on the same line so the creator can read both
                          at a glance. For live events the pill carries
                          the start time; for finished events we omit
                          the date entirely. */}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            STATUS_CLASS[event.status] ??
                              "bg-muted text-muted-foreground",
                          )}
                        >
                          {STATUS_LABEL[event.status] ?? event.status}
                        </span>
                        {/* Subscriber pill — only on scheduled rows
                            (where the creator can still gain a count
                            before the event starts). Hidden when 0
                            so an empty list doesn't broadcast "no
                            one cares yet". */}
                        {isScheduled &&
                          (subscriberCounts.data?.[event.id] ?? 0) > 0 && (
                            <span
                              className="hidden sm:inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
                              title="People subscribed for go-live notification"
                            >
                              <Bell className="h-3 w-3" />
                              {subscriberCounts.data?.[event.id] ?? 0}{" "}
                              subscribed
                            </span>
                          )}
                        {!isFinished && (
                          <span className="text-muted-foreground">
                            {new Date(event.scheduled_at).toLocaleString()}
                          </span>
                        )}
                        {/* Real commission data lives in the
                            payouts table now — surfaced on the
                            Balance page. We could join it here too,
                            but the per-row pill added noise once the
                            status badge already conveyed the state. */}
                      </div>

                      {/* Draft completion bar — only shown for drafts. */}
                      {isDraft && (
                        <div className="mt-2 flex items-center gap-2">
                          <div
                            className="h-1.5 w-32 overflow-hidden rounded-full bg-secondary"
                            aria-hidden
                          >
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                isComplete ? "bg-success" : "bg-primary",
                              )}
                              style={{
                                width: `${(stepsDone / TOTAL_STEPS) * 100}%`,
                              }}
                            />
                          </div>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-[11px] font-semibold",
                              isComplete
                                ? "text-success"
                                : "text-muted-foreground",
                            )}
                          >
                            {isComplete ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Complete
                              </>
                            ) : (
                              `${stepsDone} / ${TOTAL_STEPS} done`
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right side: status-aware actions. Order is
                      Copy → Open → Edit → Delete → primary CTA
                      (Publish / Start / Resume). The leading three
                      icons share the public-page boundary — they're
                      hidden for drafts (no /event/:id yet).
                      Icons are rendered as bare clickable glyphs
                      (no border / background) to match the look of
                      the EventEditor stepper bar. */}
                  <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
                    {hasPublicPage && (
                      <>
                        <button
                          type="button"
                          title="Copy event link"
                          aria-label="Copy event link"
                          onClick={() => void copyPublicLink()}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Link2 className="h-5 w-5" />
                        </button>
                        <a
                          href={publicEventUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open event page in a new tab"
                          aria-label="Open event page in a new tab"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ExternalLink className="h-5 w-5" />
                        </a>
                      </>
                    )}

                    {canEdit && (
                      <Link
                        to={`/events/${event.id}`}
                        title="Edit event"
                        aria-label="Edit event"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Pencil className="h-5 w-5" />
                      </Link>
                    )}

                    {canDelete && (
                      <button
                        type="button"
                        disabled={deleting}
                        title="Delete event"
                        aria-label="Delete event"
                        onClick={() => {
                          if (
                            !confirm(
                              `Delete "${event.title}"? This can't be undone.`,
                            )
                          ) {
                            return;
                          }
                          deleteMutation.mutate(event.id);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-destructive transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {deleting ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Trash2 className="h-5 w-5" />
                        )}
                      </button>
                    )}

                    {canArchive && (
                      <button
                        type="button"
                        disabled={archiving}
                        title="Archive event (keeps payouts + history intact)"
                        aria-label="Archive event"
                        onClick={() => {
                          if (
                            !confirm(
                              `Archive "${event.title}"? It disappears from your list and the public feed. Bets, payouts and ledger history stay intact and viewers can still open it from their My Bets.`,
                            )
                          ) {
                            return;
                          }
                          archiveMutation.mutate(event.id);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {archiving ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Archive className="h-5 w-5" />
                        )}
                      </button>
                    )}

                    {canUnarchive && (
                      <button
                        type="button"
                        disabled={unarchiving}
                        title="Restore event to the active list"
                        aria-label="Unarchive event"
                        onClick={() => unarchiveMutation.mutate(event.id)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-primary transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {unarchiving ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <ArchiveRestore className="h-5 w-5" />
                        )}
                      </button>
                    )}

                    {isDraft && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={!canPublish || publishing}
                        title={publishTooltip}
                        onClick={() => {
                          if (!canPublish) return;
                          publishMutation.mutate(event.id);
                        }}
                      >
                        {publishing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Send className="h-4 w-4" />
                            Publish
                          </>
                        )}
                      </Button>
                    )}

                    {isScheduled && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={!canStartStream}
                        title={startStreamTooltip}
                        onClick={() => navigate(`/events/${event.id}/live`)}
                      >
                        <Radio className="h-4 w-4" />
                        Start stream
                      </Button>
                    )}

                    {isLive && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => navigate(`/events/${event.id}/live`)}
                      >
                        <Radio className="h-4 w-4" />
                        Resume live
                      </Button>
                    )}
                    {/* Finished: Edit + Delete only (handled above by
                        canEdit / canDelete). No primary action — the
                        stream is over. */}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
