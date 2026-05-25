import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  Camera,
  Loader2,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";

import { Button, Input } from "@liverush/ui";
import { cn } from "@liverush/lib";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { LiveStreamTest } from "@/components/LiveStreamTest";

type RoundFormat = "time" | "event";
type Outcome = { id?: string; label: string; odds: string; sort_order: number };

// Supabase RPC errors are PostgrestError plain objects, not Error instances,
// so `err instanceof Error` is false and `err.message` is on the object
// directly. This helper pulls the most useful text out either way.
function errMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [e.message, e.details, e.hint].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    if (parts.length > 0) return parts.join(" — ");
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

const COVER_MAX_BYTES = 300 * 1024; // 300 KB
const COVER_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

// Static category for now — the user-facing dropdown was removed; once
// categories become part of the platform UX they'll come back here.
const DEFAULT_CATEGORY = "Challenge";

// Until dynamic, pool-based odds are computed at bet-time, every outcome
// gets seeded with the same neutral 2.00× value so the existing schema
// constraint (odds > 1) is satisfied. Existing outcomes loaded from the
// DB keep whatever odds they were saved with.
const DEFAULT_ODDS = "2.00";

export default function EventEditor() {
  const { id: idParam } = useParams<{ id: string }>();
  const isNew = !idParam || idParam === "new";
  const eventId = isNew ? null : idParam!;
  const navigate = useNavigate();
  const { user, creator } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [title, setTitle] = useState("");
  // `category` is kept in state so existing rows that already have one
  // round-trip cleanly, but new events get the DEFAULT_CATEGORY value.
  // The user-facing dropdown was removed per product call.
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [roundFormat, setRoundFormat] = useState<RoundFormat>("event");
  const [roundDurationSec, setRoundDurationSec] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([
    { label: "", odds: DEFAULT_ODDS, sort_order: 0 },
    { label: "", odds: DEFAULT_ODDS, sort_order: 1 },
  ]);
  const [status, setStatus] = useState<string>("draft");

  // Load existing event when editing.
  const { data: loaded, isLoading } = useQuery({
    queryKey: ["studio", "event", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(
          `
          id, title, description, cover_url, video_url, category, rules,
          round_format, round_duration_sec, status, scheduled_at, creator_id,
          outcomes:event_outcomes!event_outcomes_event_id_fkey (
            id, label, odds, sort_order
          )
        `,
        )
        .eq("id", eventId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!loaded) return;
    setTitle(loaded.title);
    setCategory(loaded.category);
    setDescription(loaded.description ?? "");
    setRules(loaded.rules ?? "");
    setRoundFormat(loaded.round_format as RoundFormat);
    setRoundDurationSec(loaded.round_duration_sec?.toString() ?? "");
    // Format for datetime-local: "YYYY-MM-DDTHH:mm" (local)
    setScheduledAt(toLocalDateTimeInput(loaded.scheduled_at));
    setVideoUrl(loaded.video_url ?? "");
    setCoverUrl(loaded.cover_url ?? null);
    setStatus(loaded.status);
    if (loaded.outcomes && loaded.outcomes.length > 0) {
      setOutcomes(
        [...loaded.outcomes]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((o) => ({
            id: o.id,
            label: o.label,
            odds: Number(o.odds).toFixed(2),
            sort_order: o.sort_order,
          })),
      );
    }
  }, [loaded]);

  const editable = status === "draft";
  const verifiedCreator = creator?.status === "verified";
  // Odds are no longer user-edited (computed at bet-time later), so the
  // only thing we check here is the label.
  const validOutcomes = outcomes.filter((o) => o.label.trim() !== "");
  const canSave =
    title.trim().length >= 3 &&
    !!scheduledAt &&
    (roundFormat !== "time" || Number(roundDurationSec) > 0) &&
    validOutcomes.length >= 2;

  // Dirty-tracking: when editing an existing draft, keep "Save changes"
  // disabled until the form actually diverges from what's on the server.
  // New events are always dirty (the user is composing from scratch).
  const isDirty = useMemo(() => {
    if (isNew) return true;
    if (!loaded) return false;

    if (title !== loaded.title) return true;
    if (category !== loaded.category) return true;
    if (description !== (loaded.description ?? "")) return true;
    if (rules !== (loaded.rules ?? "")) return true;
    if (roundFormat !== loaded.round_format) return true;
    if (
      roundDurationSec !== (loaded.round_duration_sec?.toString() ?? "")
    ) {
      return true;
    }
    if (scheduledAt !== toLocalDateTimeInput(loaded.scheduled_at)) return true;
    if (videoUrl !== (loaded.video_url ?? "")) return true;
    if (coverUrl !== (loaded.cover_url ?? null)) return true;

    const loadedOutcomes = [...(loaded.outcomes ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    if (outcomes.length !== loadedOutcomes.length) return true;
    for (let i = 0; i < outcomes.length; i++) {
      const cur = outcomes[i];
      const prev = loadedOutcomes[i];
      if (cur.id !== prev.id) return true;
      if (cur.label !== prev.label) return true;
      // Odds aren't user-edited anymore so we don't compare them.
    }
    return false;
  }, [
    isNew,
    loaded,
    title,
    category,
    description,
    rules,
    roundFormat,
    roundDurationSec,
    scheduledAt,
    videoUrl,
    coverUrl,
    outcomes,
  ]);

  const canPublish = canSave && verifiedCreator;

  const handleCoverChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (!COVER_ALLOWED_MIME.includes(file.type)) {
      toast.error("Use a JPG, PNG, or WebP file.");
      return;
    }
    if (file.size > COVER_MAX_BYTES) {
      toast.error(
        `Cover is too large (${(file.size / 1024).toFixed(0)} KB). Max 300 KB.`,
      );
      return;
    }
    setCoverUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${user.id}/covers/${eventId ?? "draft"}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("creator-assets")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: true,
          contentType: file.type,
        });
      if (upErr) throw upErr;
      const { data } = supabase.storage
        .from("creator-assets")
        .getPublicUrl(path);
      setCoverUrl(data.publicUrl);
      toast.success("Cover uploaded");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message);
    } finally {
      setCoverUploading(false);
    }
  };

  // Mock for now — wires up to an image-gen service in a later phase.
  const handleGenerateCover = () => {
    toast.info("AI cover generation coming soon", {
      description:
        "We'll wire this up to an image model once the creator side is feature-complete.",
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canSave) throw new Error("Fill the required fields first");

      const isoScheduled = new Date(scheduledAt).toISOString();
      const duration =
        roundFormat === "time" ? Number(roundDurationSec) || null : null;

      let savedId = eventId;
      if (isNew) {
        const { data, error } = await supabase.rpc("create_event", {
          p_title: title.trim(),
          p_cover_url: coverUrl,
          p_description: description.trim() || null,
          p_rules: rules.trim() || null,
          p_category: category,
          p_round_format: roundFormat,
          p_round_duration_sec: duration,
          p_scheduled_at: isoScheduled,
          p_video_url: videoUrl.trim() || null,
        });
        if (error) throw error;
        savedId = data.id;
      } else {
        const { error } = await supabase.rpc("update_event", {
          p_event_id: eventId!,
          p_title: title.trim(),
          p_cover_url: coverUrl,
          p_description: description.trim() || null,
          p_rules: rules.trim() || null,
          p_category: category,
          p_round_format: roundFormat,
          p_round_duration_sec: duration,
          p_scheduled_at: isoScheduled,
          p_video_url: videoUrl.trim() || null,
        });
        if (error) throw error;
      }

      // Reconcile outcomes: add new, update changed, delete removed.
      const existingIds = new Set(
        (loaded?.outcomes ?? []).map((o) => o.id),
      );
      const keptIds = new Set(
        outcomes.filter((o) => o.id).map((o) => o.id!),
      );

      // Deletes
      for (const ex of loaded?.outcomes ?? []) {
        if (!keptIds.has(ex.id)) {
          const { error } = await supabase.rpc("delete_event_outcome", {
            p_outcome_id: ex.id,
          });
          if (error) throw error;
        }
      }

      // Inserts + updates. Odds aren't user-edited anymore; existing
      // outcomes keep whatever odds they were saved with, new ones get
      // DEFAULT_ODDS (will be replaced by pool-derived odds at bet-time).
      for (const [idx, o] of outcomes.entries()) {
        const trimmedLabel = o.label.trim();
        if (!trimmedLabel) continue;
        const parsedOdds = parseFloat(o.odds);
        const odds =
          Number.isFinite(parsedOdds) && parsedOdds > 1
            ? parsedOdds
            : parseFloat(DEFAULT_ODDS);
        if (o.id && existingIds.has(o.id)) {
          const { error } = await supabase.rpc("update_event_outcome", {
            p_outcome_id: o.id,
            p_label: trimmedLabel,
            p_odds: odds,
            p_sort_order: idx,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc("add_event_outcome", {
            p_event_id: savedId!,
            p_label: trimmedLabel,
            p_odds: odds,
            p_sort_order: idx,
          });
          if (error) throw error;
        }
      }

      return savedId!;
    },
    onSuccess: (savedId) => {
      toast.success("Event saved");
      void queryClient.invalidateQueries({ queryKey: ["studio", "events", creator?.id] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "event", savedId] });
      if (isNew) navigate(`/events/${savedId}`, { replace: true });
    },
    onError: (err) => {
      // Log to the console so Postgrest details/hint/code show up in DevTools
      // for the next layer of diagnosis if the toast text isn't enough.
      console.error("Event save failed", err);
      toast.error(errMessage(err, "Save failed"));
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error("Save the event first");
      const { error } = await supabase.rpc("publish_event", {
        p_event_id: eventId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event published");
      void queryClient.invalidateQueries({ queryKey: ["studio", "events", creator?.id] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "event", eventId] });
      navigate("/events");
    },
    onError: (err) => {
      console.error("Event publish failed", err);
      toast.error(errMessage(err, "Publish failed"));
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error("Save the event first");
      const { error } = await supabase.rpc("unpublish_event", {
        p_event_id: eventId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event reverted to draft");
      void queryClient.invalidateQueries({ queryKey: ["studio", "events", creator?.id] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "event", eventId] });
    },
    onError: (err) => {
      console.error("Event unpublish failed", err);
      toast.error(errMessage(err, "Unpublish failed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error("Nothing to delete");
      const { error } = await supabase.rpc("delete_event", {
        p_event_id: eventId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event deleted");
      void queryClient.invalidateQueries({ queryKey: ["studio", "events", creator?.id] });
      navigate("/events", { replace: true });
    },
    onError: (err) => {
      console.error("Event delete failed", err);
      toast.error(errMessage(err, "Delete failed"));
    },
  });

  if (eventId && isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (eventId && !loaded) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
        <p className="font-heading text-lg font-semibold">Event not found</p>
        <Button asChild variant="secondary">
          <Link to="/events">Back to events</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            to="/events"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to events
          </Link>
          <h1 className="mt-2 font-heading text-2xl font-bold sm:text-3xl">
            {isNew ? "Create event" : title || "Untitled event"}
          </h1>
          {!isNew && (
            <p className="mt-1 text-sm text-muted-foreground">
              Status: <span className="font-semibold text-foreground">{status}</span>
            </p>
          )}
        </div>
      </div>

      {!editable && (
        <div className="rounded-2xl border border-border/40 bg-muted/30 p-4 text-sm text-muted-foreground">
          This event is published. Revert to draft to edit fields or outcomes.
        </div>
      )}

      {/* Cover */}
      <section className="space-y-2">
        <label className="text-sm font-semibold">Cover image</label>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!editable || coverUploading}
            className="group relative h-24 w-32 flex-shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted disabled:opacity-60"
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt="Cover"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <Camera className="h-6 w-6" />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              {coverUploading ? (
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              ) : (
                <Camera className="h-5 w-5 text-white" />
              )}
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleCoverChange}
          />
          <div className="flex flex-col items-start gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleGenerateCover}
              disabled={!editable}
            >
              <Sparkles className="h-4 w-4" />
              Generate image
            </Button>
            <p className="text-xs text-muted-foreground">
              JPG / PNG / WebP, max 300 KB. Recommended 16:9.
            </p>
          </div>
        </div>
      </section>

      {/* Title */}
      <section className="space-y-2">
        <label htmlFor="title" className="text-sm font-semibold">
          Title
        </label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!editable}
          maxLength={120}
          placeholder="What's the show?"
        />
      </section>

      {/* Description + rules */}
      <section className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="description" className="text-sm font-semibold">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!editable}
            rows={3}
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            placeholder="A quick hook for the feed."
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="rules" className="text-sm font-semibold">
            Rules
          </label>
          <textarea
            id="rules"
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            disabled={!editable}
            rows={4}
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            placeholder="How the rounds work, win conditions, etc."
          />
        </div>
      </section>

      {/* Round format + scheduled at */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <label htmlFor="round-format" className="text-sm font-semibold">
            Round format
          </label>
          <select
            id="round-format"
            value={roundFormat}
            onChange={(e) => setRoundFormat(e.target.value as RoundFormat)}
            disabled={!editable}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="event">Event-based</option>
            <option value="time">Time-based</option>
          </select>
        </div>
        {roundFormat === "time" && (
          <div className="space-y-2">
            <label htmlFor="round-duration" className="text-sm font-semibold">
              Round duration (sec)
            </label>
            <Input
              id="round-duration"
              type="number"
              min={5}
              value={roundDurationSec}
              onChange={(e) => setRoundDurationSec(e.target.value)}
              disabled={!editable}
              placeholder="30"
            />
          </div>
        )}
        <div className="space-y-2">
          <label htmlFor="scheduled-at" className="text-sm font-semibold">
            Scheduled for
          </label>
          <div className="relative">
            <CalendarClock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="scheduled-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              disabled={!editable}
              className="pl-9"
            />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <label htmlFor="video-url" className="text-sm font-semibold">
          Stream URL <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="video-url"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          disabled={!editable}
          placeholder="https://instagram.com/reel/... or https://www.tiktok.com/.../video/..."
        />
        <p className="text-xs text-muted-foreground">
          Instagram Reel or TikTok URL. If left blank, the user-app uses the
          fallback HLS test stream.
        </p>
      </section>

      {/* Outcomes — odds aren't user-edited anymore (computed from the
          pool at bet-time later), so this collapses to just a label
          per outcome. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold">Bet outcomes</label>
          <span className="text-xs text-muted-foreground">Min 2, max 8.</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Odds are calculated automatically from the betting pool once users
          start placing bets.
        </p>
        <ul className="space-y-2">
          {outcomes.map((o, idx) => (
            <li
              key={o.id ?? `new-${idx}`}
              className="flex items-center gap-2 rounded-xl border border-border/40 bg-card p-2"
            >
              <Input
                value={o.label}
                onChange={(e) =>
                  setOutcomes((prev) =>
                    prev.map((p, i) =>
                      i === idx ? { ...p, label: e.target.value } : p,
                    ),
                  )
                }
                disabled={!editable}
                placeholder="Outcome label"
                className="flex-1"
              />
              <button
                type="button"
                onClick={() =>
                  setOutcomes((prev) => prev.filter((_, i) => i !== idx))
                }
                disabled={!editable || outcomes.length <= 2}
                aria-label="Remove outcome"
                className={cn(
                  "inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/40 hover:text-destructive",
                  (!editable || outcomes.length <= 2) && "cursor-not-allowed opacity-40",
                )}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!editable || outcomes.length >= 8}
          onClick={() =>
            setOutcomes((prev) => [
              ...prev,
              { label: "", odds: DEFAULT_ODDS, sort_order: prev.length },
            ])
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add outcome
        </Button>
      </section>

      {/* Camera check — preview-only, helps creators confirm their hardware
          works before publishing. No recording, no upload. */}
      <LiveStreamTest />

      {/* Actions */}
      <section className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-6">
        <Button
          type="button"
          variant="accent"
          size="lg"
          onClick={() => saveMutation.mutate()}
          disabled={
            !canSave ||
            !editable ||
            saveMutation.isPending ||
            // Stay disabled on the edit screen until the user actually
            // changes something — `isDirty` is always true for new events.
            !isDirty
          }
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Save className="h-4 w-4" />
              {isNew ? "Create draft" : "Save changes"}
            </>
          )}
        </Button>
        {!isNew && status === "draft" && (
          <Button
            type="button"
            size="lg"
            onClick={() => publishMutation.mutate()}
            disabled={!canPublish || publishMutation.isPending}
          >
            {publishMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Send className="h-4 w-4" />
                Publish
              </>
            )}
          </Button>
        )}
        {!isNew && (status === "scheduled" || status === "live") && (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => unpublishMutation.mutate()}
            disabled={unpublishMutation.isPending}
          >
            {unpublishMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <XCircle className="h-4 w-4" />
                Unpublish
              </>
            )}
          </Button>
        )}
        {!isNew && status === "draft" && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => {
              if (confirm("Delete this draft? This cannot be undone.")) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="ml-auto text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete draft
          </Button>
        )}
        {!verifiedCreator && status === "draft" && !isNew && (
          <p className="ml-auto text-xs text-muted-foreground">
            Publishing unlocks once your creator profile is verified.
          </p>
        )}
      </section>
    </div>
  );
}

function toLocalDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${mm}`;
}
