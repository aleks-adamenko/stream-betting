import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Radio,
  Send,
  Sparkles,
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

  const publishMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.rpc("publish_event", {
        p_event_id: eventId,
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

            return (
              <li
                key={event.id}
                className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5"
              >
                <div className="flex items-center gap-4">
                  {/* Clickable row body — opens the editor */}
                  <Link
                    to={`/events/${event.id}`}
                    className="flex min-w-0 flex-1 items-center gap-4"
                  >
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
                  </Link>

                  {/* Right side: status-aware actions */}
                  <div className="flex flex-shrink-0 items-center gap-2">
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
                      <>
                        {/* Edit (icon) — opens the editor. Editing is
                            allowed for scheduled events; the editor
                            itself enforces the per-status field locks. */}
                        <Button
                          asChild
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Edit event"
                          aria-label="Edit event"
                        >
                          <Link to={`/events/${event.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        {/* Start Stream — sends the creator into the
                            full-screen live view; the live page
                            actually fires the start_event RPC after
                            the camera permission lands. */}
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
                      </>
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
                    {/* Finished: no actions — just the status pill that
                        already sits inline with the title. */}
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
