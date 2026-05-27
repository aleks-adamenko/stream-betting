import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
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
  finished: "Finished",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-primary/10 text-primary",
  live: "bg-destructive/15 text-destructive",
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
  outcomes: Array<{ label: string }>;
};

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
          outcomes:event_outcomes!event_outcomes_event_id_fkey ( label )
        `,
        )
        .eq("creator_id", creator!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as EventRow[];
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

      {!isLoading && events && events.length > 0 && (
        <ul className="space-y-3">
          {events.map((event) => {
            const isDraft = event.status === "draft";
            const isScheduled = event.status === "scheduled";
            const isLive = event.status === "live";
            const isFinished = event.status === "finished";
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
            // Edit + Delete affordances are status-aware:
            //   • Live: no edit (the event is broadcasting) and no
            //     delete (destructive while bytes are flying around).
            //   • Scheduled: edit is allowed, but delete is hidden
            //     because the SQL side rejects it — a scheduled event
            //     owns a Cloudflare live input we'd leak. (We could
            //     wire an "unpublish via end-stream" path later.)
            //   • Draft / finished / cancelled: both visible. SQL
            //     gets the final word; errors surface as a toast.
            const canEdit = !isLive;
            const canDelete = isDraft || isFinished;
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
