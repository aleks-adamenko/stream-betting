import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Camera,
  CheckCircle2,
  HelpCircle,
  Info,
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
import { useBettingConfig } from "@/hooks/useBettingConfig";
import { invokeEdgeFunction, supabase } from "@/integrations/supabase/client";
import { LiveStreamTest } from "@/components/LiveStreamTest";

// =========================================================================
// Types + constants
// =========================================================================

type RoundFormat = "event" | "multi";
type Outcome = { id?: string; label: string; odds: string; sort_order: number };

type BetWindowOpens = "on_live" | "15m_before" | "1h_before" | "24h_before";
type BetWindowLocks =
  | "manual"
  | "30s_after"
  | "1m_after"
  | "2m_after"
  | "5m_after";
// `external_rtmp` is intentionally not in this union anymore. The DB
// enum still accepts it (so historical rows continue to load), but the
// editor no longer offers it as a creatable option — see SOURCE_TYPES
// below. If we ever add OBS / RTMPS publishing back, add the value
// here and an entry in SOURCE_TYPES.
type SourceType = "browser_camera" | "external_url";

const COVER_MAX_BYTES = 300 * 1024; // 300 KB
const COVER_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

// The DB schema still requires a non-empty `category` (create_event raises
// otherwise), but the product no longer surfaces categories in the UI. We
// send a single sentinel value for every new studio event; existing rows
// keep whatever category they were already saved with.
const DEFAULT_CATEGORY = "General";

// Betting window is stored in seconds (events.betting_window_seconds);
// the editor exposes it as separate minutes + seconds inputs. These
// helpers translate between the stored integer and the two fields,
// clamping to the LIVE admin-config [min, max] bounds (the editor
// reads `useBettingConfig()` and threads those bounds in, so a draft
// snapshots the current rules at go-live).
type WindowBounds = { minSec: number; maxSec: number; defaultSec: number };

function clampWindowSeconds(total: number, b: WindowBounds): number {
  return Math.min(b.maxSec, Math.max(b.minSec, total));
}

function splitWindowSeconds(
  total: number,
  b: WindowBounds,
): { min: string; sec: string } {
  const clamped = clampWindowSeconds(total, b);
  return { min: String(Math.floor(clamped / 60)), sec: String(clamped % 60) };
}

// Reads the effective window length (seconds) from a loaded event row,
// tolerating the not-yet-regenerated types: betting_window_seconds is
// absent from the generated Row type until the operator regenerates, so
// it's typed optional here and we fall back to the legacy minutes column
// (×60), then the live default.
function readWindowSeconds(
  row: {
    betting_window_seconds?: number | null;
    betting_window_minutes?: number | null;
  },
  b: WindowBounds,
): number {
  const sec = row.betting_window_seconds;
  if (typeof sec === "number" && sec >= b.minSec && sec <= b.maxSec) {
    return sec;
  }
  const min = row.betting_window_minutes;
  if (typeof min === "number" && Number.isFinite(min)) {
    return clampWindowSeconds(Math.round(min * 60), b);
  }
  return b.defaultSec;
}

// Human-readable window length for the editor's help line — "10
// seconds" / "1 minute" / "2 min 30 s" depending on the value.
function humanizeWindow(totalSec: number): string {
  if (totalSec < 60) {
    return `${totalSec} second${totalSec === 1 ? "" : "s"}`;
  }
  if (totalSec % 60 === 0) {
    const m = totalSec / 60;
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  return `${Math.floor(totalSec / 60)} min ${totalSec % 60} s`;
}

const BET_WINDOW_OPENS: Array<{ value: BetWindowOpens; label: string }> = [
  { value: "on_live", label: "When event goes live" },
  { value: "15m_before", label: "15 min before live" },
  { value: "1h_before", label: "1 hour before live" },
  { value: "24h_before", label: "24 hours before live" },
];

const BET_WINDOW_LOCKS: Array<{
  value: BetWindowLocks;
  label: string;
  recommended?: boolean;
}> = [
  {
    value: "manual",
    label: "When creator hits 'Lock bets'",
    recommended: true,
  },
  { value: "30s_after", label: "30 seconds after going live" },
  { value: "1m_after", label: "1 minute after going live" },
  { value: "2m_after", label: "2 minutes after going live" },
  { value: "5m_after", label: "5 minutes after going live" },
];

const SOURCE_TYPES: Array<{
  value: SourceType;
  label: string;
  helper: string;
  disabled?: boolean;
}> = [
  {
    value: "browser_camera",
    label: "Device camera",
    helper: "Stream directly from this device's camera.",
  },
  {
    // Visible but not selectable yet — we surface the option so creators
    // know it's planned, but the user-app side that consumes external
    // links isn't ready to play them next to Cloudflare-ingested
    // streams. Flip `disabled` off when the social-embed playback path
    // is verified end-to-end.
    value: "external_url",
    label: "External stream link",
    helper: "Coming soon — paste an Instagram Reel or TikTok URL.",
    disabled: true,
  },
];

const DEFAULT_ODDS = "2.00";
// Stake caps are platform-enforced. Single source of truth lives in
// @liverush/lib (mirrored in the SQL get_betting_constants()
// function). The viewer-side stake chips are the fixed [1, 5, 10]
// set, and aggregate-per-round MAX_BET = $10 is enforced inside
// place_bet — there's no per-event override anymore, so the editor
// stopped surfacing min/max bet fields. We still WRITE the platform
// constants into events.min_bet_cents / events.max_bet_cents on
// save so legacy queries (EventList completeness, admin tools) keep
// reading the same shape — they're just no longer creator-tunable.

// =========================================================================
// Helpers
// =========================================================================

function toLocalDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Earliest start-time the user is allowed to schedule — the next
 *  whole minute. Refreshed every 30s by the component so it stays
 *  current as time ticks forward.
 */
function getMinScheduledAtIsoLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Sensible default scheduled time for a brand-new draft — now + 1h,
 *  rounded down to the nearest 5-minute mark. Means the Save button
 *  can activate as soon as the creator types a title (the other DB-
 *  required field is already filled).
 */
function getDefaultScheduledAtIsoLocal(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// centsToDollarsString / dollarsStringToCents helpers were only used
// by the now-removed min/max bet inputs. The stake-limit values are
// written into the RPC payload from the LIVE admin config
// (useBettingConfig: minBetCents / maxBetCents).

// Supabase RPC errors are plain PostgrestError objects, not Error instances.
// Pull the most useful text out either way.
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

// =========================================================================
// Steps rail (left side of the editor, sticky, full height)
// =========================================================================

const SECTIONS = [
  {
    id: "challenge",
    label: "Challenge",
    helper: "Cover, title, rules, format",
  },
  {
    id: "betting",
    label: "Betting",
    helper: "Outcomes, limits, void conditions",
  },
  { id: "stream", label: "Stream", helper: "Source and schedule" },
  { id: "review", label: "Review", helper: "Summary + publish" },
] as const;

// Step stepper + action buttons are rendered as a sticky top bar inside
// EventEditor's main render — see the JSX below.

// =========================================================================
// Main editor
// =========================================================================

export default function EventEditor() {
  const { id: idParam } = useParams<{ id: string }>();
  const isNew = !idParam || idParam === "new";
  const eventId = isNew ? null : idParam!;
  const navigate = useNavigate();
  const { user, creator } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // LIVE global config — stake limits + betting-window bounds the draft
  // will be created with (it snapshots the live config at go-live).
  // Falls back to the lib defaults while the query loads.
  const config = useBettingConfig();
  const windowBounds: WindowBounds = {
    minSec: config.bettingWindowMinSec,
    maxSec: config.bettingWindowMaxSec,
    defaultSec: config.bettingWindowDefaultSec,
  };
  // True once the creator manually edits a window field, so the
  // config-default re-seed effect (new events) backs off after a touch.
  const windowTouchedRef = useRef(false);

  // ---- Form state ----
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // `category` is hidden from the UI but still needed by the RPC. Held
  // in state so loaded drafts round-trip their existing value.
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [rules, setRules] = useState("");
  const [roundFormat, setRoundFormat] = useState<RoundFormat>("event");
  const [voidConditions, setVoidConditions] = useState("");
  const [outcomes, setOutcomes] = useState<Outcome[]>([
    { label: "", odds: DEFAULT_ODDS, sort_order: 0 },
    { label: "", odds: DEFAULT_ODDS, sort_order: 1 },
  ]);
  const [betWindowOpens, setBetWindowOpens] =
    useState<BetWindowOpens>("on_live");
  const [betWindowLocks, setBetWindowLocks] =
    useState<BetWindowLocks>("manual");
  // Pari-mutuel hard betting window, now stored in SECONDS
  // (events.betting_window_seconds; 10–1800). Surfaced as two inputs —
  // minutes + seconds — backed by raw string state so the typist isn't
  // fought mid-edit; the clamped integer is derived in
  // `bettingWindowSeconds` below and used for save + dirty checks. The
  // legacy betting_window_minutes column is no longer written.
  const windowInit = splitWindowSeconds(
    config.bettingWindowDefaultSec,
    windowBounds,
  );
  const [windowMinStr, setWindowMinStr] = useState<string>(windowInit.min);
  const [windowSecStr, setWindowSecStr] = useState<string>(windowInit.sec);
  const bettingWindowSeconds = useMemo(
    () =>
      clampWindowSeconds(
        (Number.parseInt(windowMinStr, 10) || 0) * 60 +
          (Number.parseInt(windowSecStr, 10) || 0),
        windowBounds,
      ),
    // windowBounds is derived from config; depend on its primitive parts
    // so the clamp re-runs when the admin config resolves / changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [windowMinStr, windowSecStr, windowBounds.minSec, windowBounds.maxSec],
  );
  // Re-snap both fields to the clamped value on blur so an under-min or
  // over-max entry visibly corrects (e.g. "0 min 5 s" → "0 min 10 s").
  const normalizeWindowInputs = () => {
    const sp = splitWindowSeconds(bettingWindowSeconds, windowBounds);
    setWindowMinStr(sp.min);
    setWindowSecStr(sp.sec);
  };
  // New events: seed the window from the LIVE config default once the
  // config query resolves (the useState seed above ran against the lib
  // fallback on first render). Backs off once the creator types.
  useEffect(() => {
    if (!isNew || windowTouchedRef.current) return;
    const sp = splitWindowSeconds(config.bettingWindowDefaultSec, windowBounds);
    setWindowMinStr(sp.min);
    setWindowSecStr(sp.sec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isNew,
    config.bettingWindowDefaultSec,
    windowBounds.minSec,
    windowBounds.maxSec,
  ]);
  // New events start with a sensible future scheduled time so Save
  // can unlock with only a typed title (the DB requires scheduled_at).
  // Existing events overwrite this in the load effect below.
  const [scheduledAt, setScheduledAt] = useState<string>(() =>
    isNew ? getDefaultScheduledAtIsoLocal() : "",
  );
  // Refreshed every 30s so the datetime-local input's `min` keeps
  // tracking real time forward (no picking past minutes).
  const [minScheduledAt, setMinScheduledAt] = useState<string>(() =>
    getMinScheduledAtIsoLocal(),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setMinScheduledAt(getMinScheduledAtIsoLocal());
    }, 30_000);
    return () => clearInterval(id);
  }, []);
  const [sourceType, setSourceType] = useState<SourceType>("browser_camera");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [status, setStatus] = useState<string>("draft");

  // Schedule-for-later: when off, Publish flips status to scheduled
  // with `scheduled_at = now()` and takes the creator straight into
  // the live page so they can go on air immediately. When on, the
  // datetime picker is revealed and the user picks a future start
  // time; Publish then returns them to the events list where the
  // event waits as scheduled.
  //
  // For existing drafts we infer the initial state from the loaded
  // scheduled_at — if it's already > 5 min ahead of now, the creator
  // had previously chosen a future time, so default the checkbox to
  // on. Otherwise off.
  const [scheduleForLater, setScheduleForLater] = useState<boolean>(false);

  // ---- Load existing draft ----
  const { data: loaded, isLoading } = useQuery({
    queryKey: ["studio", "event", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(
          `
          id, title, description, cover_url, video_url, category, rules,
          round_format, status, scheduled_at, creator_id,
          void_conditions,
          min_bet_cents, max_bet_cents,
          bet_window_opens, bet_window_locks,
          betting_window_minutes,
          betting_window_seconds,
          source_type, broadcast_delay_sec,
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
    setDescription(loaded.description ?? "");
    // Preserve whatever category the row was saved with so we don't
    // overwrite legacy values on update.
    setCategory(loaded.category || DEFAULT_CATEGORY);
    setCoverUrl(loaded.cover_url ?? null);
    setRules(loaded.rules ?? "");
    // Legacy 'time' rows were migrated to 'multi' but defensively
    // coerce here so a draft created pre-migration still loads
    // cleanly into the editor.
    setRoundFormat(
      loaded.round_format === "event" ? "event" : "multi",
    );
    setVoidConditions(loaded.void_conditions ?? "");
    setBetWindowOpens(loaded.bet_window_opens ?? "on_live");
    setBetWindowLocks(loaded.bet_window_locks ?? "manual");
    const loadedWindow = splitWindowSeconds(
      readWindowSeconds(loaded, windowBounds),
      windowBounds,
    );
    setWindowMinStr(loadedWindow.min);
    setWindowSecStr(loadedWindow.sec);
    setScheduledAt(toLocalDateTimeInput(loaded.scheduled_at));
    // If the saved scheduled_at is meaningfully in the future, the
    // creator had previously asked us to schedule — keep the checkbox
    // checked on reopen. Otherwise default to "publish now".
    if (loaded.scheduled_at) {
      const ms = new Date(loaded.scheduled_at).getTime();
      setScheduleForLater(ms - Date.now() > 5 * 60 * 1000);
    } else {
      setScheduleForLater(false);
    }
    // Loaded events created when RTMP was selectable could still carry
    // `external_rtmp` — coerce those (and any other dropped legacy
    // values) back to the new default so the radio group renders
    // something selected.
    setSourceType(
      loaded.source_type === "browser_camera" ||
        loaded.source_type === "external_url"
        ? loaded.source_type
        : "browser_camera",
    );
    setVideoUrl(loaded.video_url ?? "");
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

  // Drafts and scheduled (published-but-not-yet-live) events both
  // allow most edits. Live / finished / cancelled events lock down.
  const editable = status === "draft" || status === "scheduled";
  // Source type + stream URL are frozen the moment the event leaves
  // draft — viewers may already be queued up watching for that source.
  const sourceEditable = status === "draft";
  const verifiedCreator = creator?.status === "verified";

  // ---- Derived validation ----
  const validOutcomes = useMemo(
    () => outcomes.filter((o) => o.label.trim() !== ""),
    [outcomes],
  );
  const outcomeLabelsLower = useMemo(
    () => outcomes.map((o) => o.label.trim().toLowerCase()),
    [outcomes],
  );
  const outcomeDuplicates = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<number>();
    outcomeLabelsLower.forEach((label, idx) => {
      if (!label) return;
      const first = seen.get(label);
      if (first === undefined) {
        seen.set(label, idx);
      } else {
        dupes.add(idx);
        dupes.add(first);
      }
    });
    return dupes;
  }, [outcomeLabelsLower]);

  // Bet limits used to be creator-tunable but are now platform-wide,
  // admin-editable config. We still write cents values into the row on
  // save so EventList's completeness check + admin tools keep reading
  // the same shape; we source them LIVE so the persisted snapshot
  // matches the rules the event will be created with.
  const minCents = config.minBetCents;
  const maxCents = config.maxBetCents;

  // Minimums needed to call create_event / update_event without the
  // DB rejecting the row. Save activates as soon as the creator has
  // typed a title — outcomes can be added later, scheduledAt is pre-
  // filled. Multi-round events no longer require a duration (the
  // streamer controls round advancement manually).
  const canSave =
    title.trim().length >= 3 &&
    !!scheduledAt &&
    outcomeDuplicates.size === 0;

  // Compliance checks shown in the Review section. All must pass before
  // Publish unlocks (in addition to being a verified creator).
  const complianceChecks = useMemo(() => {
    return [
      {
        key: "title",
        label: "Title and description provided",
        passed: title.trim().length >= 5 && description.trim().length > 0,
      },
      {
        key: "cover",
        label: "Cover image uploaded",
        passed: !!coverUrl,
      },
      {
        key: "rules",
        label: "Rules describe the challenge clearly",
        passed: rules.trim().length >= 30,
      },
      {
        key: "outcomes",
        label: "At least 2 unique outcomes defined",
        passed: validOutcomes.length >= 2 && outcomeDuplicates.size === 0,
      },
      // Bet-limits compliance row deleted — stake range is platform-
      // wide (the admin-editable config's min/max bet cents), so it's
      // not something the creator can fail.
      {
        key: "stream",
        label: "Stream source configured",
        passed:
          sourceType === "browser_camera" ||
          (sourceType === "external_url" && videoUrl.trim().length > 0),
      },
      {
        key: "schedule",
        // The schedule check is only meaningful when the creator
        // opted to schedule for later — going-live-now needs no
        // future timestamp. publishMutation handles synthesising a
        // current scheduled_at when the checkbox is off.
        label: scheduleForLater
          ? "Scheduled in the future"
          : "Going live immediately on Publish",
        passed: scheduleForLater
          ? !!scheduledAt && new Date(scheduledAt).getTime() > Date.now()
          : true,
      },
    ];
  }, [
    title,
    description,
    coverUrl,
    rules,
    validOutcomes.length,
    outcomeDuplicates.size,
    sourceType,
    videoUrl,
    scheduledAt,
    scheduleForLater,
  ]);
  const allComplianceMet = complianceChecks.every((c) => c.passed);
  const canPublish = canSave && verifiedCreator && allComplianceMet;
  // Save requires the loose `canSave` minimums for a draft, but a
  // strict "all compliance checks pass" for a scheduled event since
  // its data is already public and shouldn't regress into an invalid
  // state. Non-editable statuses (live / finished / cancelled) can't
  // save at all.
  const canSaveNow =
    editable &&
    canSave &&
    (status === "draft" || allComplianceMet);

  // Per-step completion — drives the green check marks in the rail. Each
  // step is "complete" only when every field that belongs to it is fully
  // valid (same predicates used for the Missing chips in the summary).
  // The merged "Challenge" step owns what used to be in Basics too.
  const stepComplete: Record<(typeof SECTIONS)[number]["id"], boolean> = {
    challenge:
      title.trim().length >= 5 &&
      description.trim().length > 0 &&
      !!coverUrl &&
      rules.trim().length >= 30,
    betting:
      validOutcomes.length >= 2 &&
      outcomeDuplicates.size === 0,
    stream:
      // Schedule clause:
      //  • If "Schedule for later" is on, require a future
      //    scheduled_at the same way we used to.
      //  • If off (Go Live Now), no scheduled_at is needed — the
      //    publish mutation will stamp it at click time.
      (scheduleForLater
        ? !!scheduledAt && new Date(scheduledAt).getTime() > Date.now()
        : true) &&
      // Source clause: external link requires a URL; device camera
      // is self-sufficient.
      (sourceType !== "external_url" || videoUrl.trim().length > 0),
    // Review is a summary step — mark it complete once the rest of the
    // form is ready to publish (without requiring verified-creator,
    // which is a moderator concern, not the creator's).
    review: allComplianceMet,
  };

  // ---- Dirty tracking ----
  const isDirty = useMemo(() => {
    if (isNew) return true;
    if (!loaded) return false;

    if (title !== loaded.title) return true;
    if (description !== (loaded.description ?? "")) return true;
    if (category !== (loaded.category || DEFAULT_CATEGORY)) return true;
    if (rules !== (loaded.rules ?? "")) return true;
    // Treat the legacy 'time' value as 'multi' for dirty comparison
    // since loaded.round_format on a pre-migration draft can still
    // be 'time' until the migration runs.
    const loadedFormat =
      loaded.round_format === "event" ? "event" : "multi";
    if (roundFormat !== loadedFormat) return true;
    if (voidConditions !== (loaded.void_conditions ?? "")) return true;
    if (betWindowOpens !== (loaded.bet_window_opens ?? "on_live"))
      return true;
    if (betWindowLocks !== (loaded.bet_window_locks ?? "manual"))
      return true;
    if (bettingWindowSeconds !== readWindowSeconds(loaded, windowBounds))
      return true;
    if (scheduledAt !== toLocalDateTimeInput(loaded.scheduled_at))
      return true;
    // Compare against the same coerced default we use when loading the
    // event, so RTMP-era legacy rows don't mark themselves dirty on
    // open just because the radio normalised to browser_camera.
    const loadedSourceType =
      loaded.source_type === "browser_camera" ||
      loaded.source_type === "external_url"
        ? loaded.source_type
        : "browser_camera";
    if (sourceType !== loadedSourceType) return true;
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
    }
    return false;
  }, [
    isNew,
    loaded,
    title,
    description,
    category,
    rules,
    roundFormat,
    voidConditions,
    betWindowOpens,
    betWindowLocks,
    scheduledAt,
    sourceType,
    videoUrl,
    coverUrl,
    outcomes,
  ]);

  // ---- Section anchor highlight on scroll ----
  const [activeSection, setActiveSection] =
    useState<(typeof SECTIONS)[number]["id"]>("basics");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const targets = SECTIONS.map((s) =>
      document.getElementById(s.id),
    ).filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.target.id) {
            setActiveSection(
              e.target.id as (typeof SECTIONS)[number]["id"],
            );
          }
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  // ---- Cover upload handler ----
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
      toast.error(errMessage(err, "Upload failed"));
    } finally {
      setCoverUploading(false);
    }
  };

  const handleGenerateCover = () => {
    toast.info("AI cover generation coming soon", {
      description:
        "We'll wire this up to an image model once the creator side is feature-complete.",
    });
  };

  // ---- Save / publish / delete mutations ----
  //
  // `runSave` is the underlying side-effecting logic. We extract it
  // out of the mutation so publishMutation can call it first on a
  // brand-new event (so the Publish button can be active before
  // there's a saved row, instead of forcing a two-click save → publish
  // dance).
  const runSave = async (): Promise<string> => {
    if (!canSave) throw new Error("Fill the required fields first");

    // When the creator left "Schedule for later" unchecked we synthesise
    // the start time at save time (now()), so the DB column — which is
    // NOT NULL — stays satisfied without leaking the "go live now" UI
    // choice into the schema. publishMutation reads `scheduleForLater`
    // directly to decide where to navigate after success.
    const scheduledAtForSave =
      scheduleForLater && scheduledAt
        ? new Date(scheduledAt)
        : new Date();
    const isoScheduled = scheduledAtForSave.toISOString();

    const rpcArgs = {
      p_title: title.trim(),
      p_cover_url: coverUrl,
      p_description: description.trim() || null,
      p_rules: rules.trim() || null,
      p_category: category,
      p_round_format: roundFormat,
      p_scheduled_at: isoScheduled,
      p_video_url: videoUrl.trim() || null,
      p_void_conditions: voidConditions.trim() || null,
      p_min_bet_cents: minCents,
      p_max_bet_cents: maxCents,
      p_bet_window_opens: betWindowOpens,
      p_bet_window_locks: betWindowLocks,
      p_source_type: sourceType,
      // Broadcast delay is now enforced platform-side; no per-event
      // override gets sent.
    };

    let savedId = eventId;
    if (isNew) {
      const { data, error } = await supabase.rpc("create_event", rpcArgs);
      if (error) throw error;
      savedId = data.id;
    } else {
      const { error } = await supabase.rpc("update_event", {
        p_event_id: eventId!,
        ...rpcArgs,
      });
      if (error) throw error;
    }

    // Persist the pari-mutuel betting window (seconds) via the dedicated
    // set_event_betting_window RPC. (Kept separate from update_event so
    // we don't bloat its already-wide signature.) Cast to `never` because
    // the renamed p_seconds param isn't in the generated types until the
    // operator regenerates.
    if (savedId) {
      const { error: windowErr } = await supabase.rpc(
        "set_event_betting_window",
        {
          p_event_id: savedId,
          p_seconds: bettingWindowSeconds,
        } as never,
      );
      if (windowErr) throw windowErr;
    }

    // Reconcile outcomes: add new, update changed, delete removed.
    const existingIds = new Set((loaded?.outcomes ?? []).map((o) => o.id));
    const keptIds = new Set(
      outcomes.filter((o) => o.id).map((o) => o.id!),
    );
    for (const ex of loaded?.outcomes ?? []) {
      if (!keptIds.has(ex.id)) {
        const { error } = await supabase.rpc("delete_event_outcome", {
          p_outcome_id: ex.id,
        });
        if (error) throw error;
      }
    }
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
  };

  const saveMutation = useMutation({
    mutationFn: runSave,
    onSuccess: (savedId) => {
      toast.success("Event saved");
      void queryClient.invalidateQueries({
        queryKey: ["studio", "events", creator?.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["studio", "event", savedId],
      });
      if (isNew) navigate(`/events/${savedId}`, { replace: true });
    },
    onError: (err) => {
      console.error("Event save failed", err);
      toast.error(errMessage(err, "Save failed"));
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      // Always save the latest form state first — for a new draft
      // this creates the row, for an existing one it flushes any
      // un-saved edits before publishing. Then we provision the
      // Cloudflare live input + flip status via the `provision-stream`
      // Edge Function. Idempotent.
      const id = await runSave();
      const { error } = await invokeEdgeFunction("provision-stream", {
        event_id: id,
      });
      if (error) throw error;
      return id;
    },
    onSuccess: async (id) => {
      // Two terminal screens:
      //  • Schedule for later → events list (the creator will come
      //    back at the scheduled time and click Start stream).
      //  • Go live now → directly into the LiveStream page so the
      //    creator can grant camera + start broadcasting in one flow.
      //
      // For the Go-live-now branch we must REFETCH (not just
      // invalidate) before navigating, otherwise the LiveStream page
      // reads the still-cached `status='draft'` row and flashes
      // "This event isn't ready to stream" while the post-publish
      // refresh is in flight. The events-list branch can just
      // invalidate — the list refetches on its own focus.
      void queryClient.invalidateQueries({
        queryKey: ["studio", "events", creator?.id],
      });
      if (scheduleForLater) {
        void queryClient.invalidateQueries({
          queryKey: ["studio", "event", eventId],
        });
        toast.success("Event scheduled");
        navigate("/events");
      } else {
        await queryClient.refetchQueries({
          queryKey: ["studio", "event", id],
        });
        toast.success("Event published — let's go live");
        navigate(`/events/${id}/live`);
      }
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
      void queryClient.invalidateQueries({
        queryKey: ["studio", "events", creator?.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["studio", "event", eventId],
      });
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
      void queryClient.invalidateQueries({
        queryKey: ["studio", "events", creator?.id],
      });
      navigate("/events", { replace: true });
    },
    onError: (err) => {
      console.error("Event delete failed", err);
      toast.error(errMessage(err, "Delete failed"));
    },
  });

  // ---- Loading / not-found states ----
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

  // =======================================================================
  // RENDER
  // =======================================================================

  return (
    <div className="w-full space-y-6">
      {/* ============================================================== */}
      {/* Sticky top bar — horizontal stepper + 3 action buttons.        */}
      {/* Rendered as a card-elevated container (same surface treatment  */}
      {/* every other section uses) and pinned to the top of the scroll  */}
      {/* viewport. Its left/right edges align with the page wrapper's   */}
      {/* content padding so the bar feels continuous with the cards     */}
      {/* below it.                                                       */}
      {/* ============================================================== */}
      {/* `top-4` leaves a 16px gap between the bar and the scroll
          viewport's top edge once it's stuck — keeps the card visually
          detached instead of crashing into the screen edge. Dark
          blue→purple gradient bg makes the stepper feel like part of
          the platform's brand surface; stepper text + line colors
          below are swapped to white-tinted variants for contrast. */}
      <div className="sticky top-4 z-20 rounded-xl border border-white/10 bg-gradient-to-r from-[#210B88] to-[#5B21FA] shadow-lg">
        <div className="flex items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-5">
          {/* Stepper — each step is a [icon + label] pill linked back to
              its anchor section. Connection lines turn green once the
              step on their LEFT is complete, so the bar visually fills
              in left-to-right as the form gets done. On mobile we drop
              the labels and tighten the line widths so the whole row
              fits at 375px viewport. */}
          <ol className="flex items-center gap-1 sm:gap-3">
            {SECTIONS.map((s, idx) => {
              const isActive = activeSection === s.id;
              const complete = stepComplete[s.id];
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-1 sm:gap-3"
                >
                  <a
                    href={`#${s.id}`}
                    title={s.label}
                    aria-label={s.label}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-1 py-1 text-sm transition-colors sm:px-1.5",
                      complete
                        ? "font-semibold text-success"
                        : isActive
                          ? "font-semibold text-white"
                          : "font-medium text-white/70 hover:text-white",
                    )}
                  >
                    {complete ? (
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />
                    ) : isActive ? (
                      <span
                        aria-hidden
                        className="h-3 w-3 flex-shrink-0 rounded-full bg-white"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="h-3 w-3 flex-shrink-0 rounded-full border-2 border-white/50"
                      />
                    )}
                    <span className="hidden whitespace-nowrap sm:inline">
                      {s.label}
                    </span>
                  </a>
                  {idx < SECTIONS.length - 1 && (
                    <div
                      aria-hidden
                      className={cn(
                        "h-0.5 w-3 transition-colors sm:w-10",
                        complete ? "bg-success" : "bg-white/25",
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>

          {/* Right: 3 action buttons. All three are always visible; the
              ones that don't make sense yet (Delete/Publish on a brand-
              new draft) show as disabled with an explanatory tooltip
              instead of disappearing. */}
          <div className="flex items-center gap-2">
            {/* Delete — bare white icon on the gradient bar (no chrome).
                Available on draft + finished states, hidden once the
                event is scheduled/live. Disabled on a brand-new draft
                with a tooltip explaining why. */}
            {status !== "scheduled" && status !== "live" && (
              <button
                type="button"
                aria-label="Delete draft"
                title={
                  isNew
                    ? "Save the draft first to enable deletion"
                    : "Delete draft"
                }
                onClick={() => {
                  if (
                    !isNew &&
                    confirm("Delete this draft? This cannot be undone.")
                  ) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={isNew || deleteMutation.isPending}
                className="inline-flex h-10 w-7 items-center justify-center rounded-md text-white transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Trash2 className="h-5 w-5" />
                )}
              </button>
            )}

            {/* Save — same bare white icon treatment as Delete. The
                Publish button (next over) keeps its accent fill so the
                colour anchor stays on the primary action. */}
            <button
              type="button"
              aria-label={isNew ? "Create draft" : "Save"}
              title={
                status === "scheduled" && !allComplianceMet
                  ? "All fields must be valid before saving a scheduled event"
                  : isNew
                    ? "Create draft"
                    : "Save"
              }
              onClick={() => saveMutation.mutate()}
              disabled={!canSaveNow || saveMutation.isPending || !isDirty}
              className="inline-flex h-10 w-7 items-center justify-center rounded-md text-white transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Save className="h-5 w-5" />
              )}
            </button>

            {/* Publish — visible while the event is still a draft. For a
                brand-new draft it stays disabled with a "Save the draft
                first" tooltip. Accent variant is the headline action.
                On mobile the label collapses so the button matches the
                icon-only Save/Delete next to it. */}
            {status === "draft" && (
              <Button
                type="button"
                variant="accent"
                aria-label="Publish"
                title={
                  !verifiedCreator
                    ? "Publishing unlocks once your account is verified"
                    : !allComplianceMet
                      ? "Complete every field above to publish"
                      : "Publish"
                }
                onClick={() => publishMutation.mutate()}
                disabled={!canPublish || publishMutation.isPending}
                className="w-10 px-0 sm:w-auto sm:px-5"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    <span className="hidden sm:inline">Publish</span>
                  </>
                )}
              </Button>
            )}

            {/* Unpublish — replaces Publish once the event has been
                pushed live or scheduled. Same icon-on-mobile treatment. */}
            {!isNew && (status === "scheduled" || status === "live") && (
              <Button
                type="button"
                variant="secondary"
                aria-label="Unpublish"
                title="Unpublish"
                onClick={() => unpublishMutation.mutate()}
                disabled={unpublishMutation.isPending}
                className="w-10 px-0 sm:w-auto sm:px-5"
              >
                {unpublishMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <XCircle className="h-4 w-4" />
                    <span className="hidden sm:inline">Unpublish</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Header */}
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
              Status:{" "}
              <span className="font-semibold text-foreground">{status}</span>
            </p>
          )}
        </div>
      </div>

      {status === "scheduled" && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
          <span className="font-semibold">Event scheduled.</span> Edits
          save instantly and refresh what viewers see at liverush.co.
          Source and stream URL are locked once published.
        </div>
      )}
      {(status === "live" ||
        status === "finished" ||
        status === "cancelled") && (
        <div className="rounded-2xl border border-border/40 bg-muted/30 p-4 text-sm text-muted-foreground">
          This event is {status}. Editing is locked.
        </div>
      )}

      {/* ================================================================ */}
      {/* SECTION 1 — CHALLENGE (merged with the former Basics card)        */}
      {/* ================================================================ */}
      <section
        id="challenge"
        aria-labelledby="challenge-heading"
        className="card-elevated overflow-hidden scroll-mt-20"
      >
        <SectionHeading
          id="challenge-heading"
          index={1}
          label="Challenge"
        />
        <div className="space-y-6 p-5 sm:p-6">

        <FieldRow label="Cover image">
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
        </FieldRow>

        <FieldRow label="Title" htmlFor="title">
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 80))}
            disabled={!editable}
            maxLength={80}
            placeholder="What's the show?"
          />
          <CharCounter value={title} max={80} />
        </FieldRow>

        <FieldRow label="Description" htmlFor="description">
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 300))}
            disabled={!editable}
            rows={3}
            maxLength={300}
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:text-sm"
            placeholder="A quick hook for the feed."
          />
          <CharCounter value={description} max={300} />
        </FieldRow>

        <FieldRow
          label="Rules"
          htmlFor="rules"
          helper="Describe exactly what you'll do and what counts as success. Write rules so the winning outcome is obvious to anyone watching — clear, observable conditions reduce viewer disputes and speed up moderation."
        >
          <textarea
            id="rules"
            value={rules}
            onChange={(e) => setRules(e.target.value.slice(0, 1000))}
            disabled={!editable}
            rows={5}
            maxLength={1000}
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:text-sm"
            placeholder="Example: I'll attempt to pop 10 balloons blindfolded in under 60 seconds. A balloon counts as popped only if fully burst, not deflated."
          />
          <CharCounter value={rules} max={1000} />
        </FieldRow>

        <FieldRow
          label="Round format"
          htmlFor="round-format"
          helper="Single round = one outcome decides the whole event. Multi-round = you click Next round between rounds; betting + payouts repeat per round with the same betting window."
        >
          <select
            id="round-format"
            value={roundFormat}
            onChange={(e) => setRoundFormat(e.target.value as RoundFormat)}
            disabled={!editable}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-base disabled:opacity-60 sm:text-sm"
          >
            <option value="event">Single round</option>
            <option value="multi">Multi-round</option>
          </select>
        </FieldRow>
        </div>
      </section>

      {/* ================================================================ */}
      {/* SECTION 2 — BETTING                                               */}
      {/* ================================================================ */}
      <section
        id="betting"
        aria-labelledby="betting-heading"
        className="card-elevated overflow-hidden scroll-mt-20"
      >
        <SectionHeading id="betting-heading" index={2} label="Betting" />
        <div className="space-y-6 p-5 sm:p-6">

        <div className="rounded-2xl border border-border/40 bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-semibold">Bet outcomes</label>
              <HelperTooltip text="What can viewers bet on? Each outcome should be mutually exclusive — only one can be true at the end. Odds are calculated automatically from the betting pool." />
            </div>
            <span className="text-xs text-muted-foreground">
              Min 2, max 8
            </span>
          </div>
          <ul className="space-y-2">
            {outcomes.map((o, idx) => {
              const isDup = outcomeDuplicates.has(idx);
              const trimmed = o.label.trim();
              const isEmpty =
                trimmed === "" && outcomes.length <= validOutcomes.length;
              return (
                <li
                  key={o.id ?? `new-${idx}`}
                  className="flex flex-col gap-1 rounded-xl border border-border/40 bg-card p-2"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={o.label}
                      onChange={(e) =>
                        setOutcomes((prev) =>
                          prev.map((p, i) =>
                            i === idx
                              ? { ...p, label: e.target.value.slice(0, 50) }
                              : p,
                          ),
                        )
                      }
                      disabled={!editable}
                      placeholder="Outcome label"
                      maxLength={50}
                      className={cn(
                        "flex-1",
                        isDup &&
                          "border-destructive focus-visible:ring-destructive",
                      )}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setOutcomes((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      disabled={!editable || outcomes.length <= 2}
                      aria-label="Remove outcome"
                      className={cn(
                        "inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/40 hover:text-destructive",
                        (!editable || outcomes.length <= 2) &&
                          "cursor-not-allowed opacity-40",
                      )}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {isDup && (
                    <p className="text-xs text-destructive">
                      Duplicate outcome
                    </p>
                  )}
                  {isEmpty && idx < 2 && (
                    <p className="text-xs text-muted-foreground">
                      Outcome cannot be empty
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!editable || outcomes.length >= 8}
            onClick={() =>
              setOutcomes((prev) => [
                ...prev,
                {
                  label: "",
                  odds: DEFAULT_ODDS,
                  sort_order: prev.length,
                },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add outcome
          </Button>
        </div>

        {/* Platform-wide moderation note — not a field, no border, no
            background. Sits between outcomes and bet limits. */}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Winning outcomes are verified by the LiveRush moderation team
            before payouts are released.
          </span>
        </p>

        {/* The per-event "minimum / maximum bet" inputs used to live
            here. The user-app's stake chips are a fixed [1, 5, 10]
            set and the aggregate-per-round MAX_BET = $10 is enforced
            inside place_bet (see 20260610_000001 migration), so the
            range is no longer creator-tunable. We still write the
            platform constants into events.min_bet_cents /
            events.max_bet_cents on save for backward compatibility
            with EventList completeness + admin tooling. */}

        <FieldRow
          label="When can viewers bet?"
          helper="Betting opens when the stream goes live and closes after the window below — a hard cutoff. The cutoff matches the pari-mutuel rules: once it passes, no new bets, and the streamer can declare a winner."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="window-opens"
                className="text-xs font-medium text-muted-foreground"
              >
                Opens
              </label>
              <select
                id="window-opens"
                value={betWindowOpens}
                onChange={(e) =>
                  setBetWindowOpens(e.target.value as BetWindowOpens)
                }
                disabled={!editable}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-base disabled:opacity-60 sm:text-sm"
              >
                {BET_WINDOW_OPENS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Betting window (after going live)
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Input
                    id="window-minutes"
                    type="number"
                    min={0}
                    max={Math.floor(windowBounds.maxSec / 60)}
                    step={1}
                    inputMode="numeric"
                    aria-label="Betting window minutes"
                    value={windowMinStr}
                    onChange={(e) => {
                      windowTouchedRef.current = true;
                      setWindowMinStr(e.target.value);
                    }}
                    onBlur={normalizeWindowInputs}
                    disabled={!editable}
                    className="h-10 w-20"
                  />
                  <span className="text-sm text-muted-foreground">min</span>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    id="window-seconds"
                    type="number"
                    min={0}
                    max={59}
                    step={1}
                    inputMode="numeric"
                    aria-label="Betting window seconds"
                    value={windowSecStr}
                    onChange={(e) => {
                      windowTouchedRef.current = true;
                      setWindowSecStr(e.target.value);
                    }}
                    onBlur={normalizeWindowInputs}
                    disabled={!editable}
                    className="h-10 w-20"
                  />
                  <span className="text-sm text-muted-foreground">sec</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Minimum {humanizeWindow(windowBounds.minSec)}, maximum{" "}
                {humanizeWindow(windowBounds.maxSec)}. Default{" "}
                {humanizeWindow(config.bettingWindowDefaultSec)}.
              </p>
            </div>
          </div>
        </FieldRow>

        <FieldRow
          label="Special void conditions (optional)"
          htmlFor="void-conditions"
          helper="Platform defaults already cover stream disconnects, technical failures, and creator cancellation. Use this only for challenge-specific situations."
        >
          <textarea
            id="void-conditions"
            value={voidConditions}
            onChange={(e) => setVoidConditions(e.target.value.slice(0, 300))}
            disabled={!editable}
            rows={3}
            maxLength={300}
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:text-sm"
            placeholder="Example: bets are voided if more than 2 balloons are defective and cannot be popped through normal effort."
          />
          <CharCounter value={voidConditions} max={300} />
        </FieldRow>
        </div>
      </section>

      {/* ================================================================ */}
      {/* SECTION 3 — STREAM                                                */}
      {/* ================================================================ */}
      <section
        id="stream"
        aria-labelledby="stream-heading"
        className="card-elevated overflow-hidden scroll-mt-20"
      >
        <SectionHeading id="stream-heading" index={3} label="Stream" />
        <div className="space-y-5 p-5 sm:p-6">

        {/* Schedule controls — checkbox first (off by default, meaning
            "publish + go live right now"), then a conditional picker
            for when the creator wants to set a future start time. */}
        <FieldRow label="When to go live">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={scheduleForLater}
              onChange={(e) => {
                const on = e.target.checked;
                setScheduleForLater(on);
                if (on) {
                  // Switching to scheduled — prefill with a sensible
                  // future time if the field is empty or in the past.
                  if (
                    !scheduledAt ||
                    new Date(scheduledAt).getTime() <= Date.now()
                  ) {
                    setScheduledAt(getDefaultScheduledAtIsoLocal());
                  }
                }
              }}
              disabled={!editable}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
            />
            <span>
              <span className="font-medium">Schedule for later</span>
              <span className="ml-1 text-muted-foreground">
                — leave unchecked to go live immediately when you hit
                Publish.
              </span>
            </span>
          </label>

          {scheduleForLater && (
            <div className="relative mt-3">
              <CalendarClock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="scheduled-at"
                type="datetime-local"
                value={scheduledAt}
                min={minScheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={!editable}
                className="pl-9"
              />
            </div>
          )}
        </FieldRow>

        <FieldRow label="Source">
          <RadioCardGroup
            name="source_type"
            value={sourceType}
            onChange={(v) => setSourceType(v as SourceType)}
            disabled={!sourceEditable}
            options={SOURCE_TYPES}
          />
        </FieldRow>

        {sourceType === "external_url" && (
          <FieldRow label="Stream URL" htmlFor="video-url">
            <Input
              id="video-url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={!sourceEditable}
              placeholder="https://instagram.com/reel/... or https://www.tiktok.com/.../video/..."
            />
            <p className="text-xs text-muted-foreground">
              Instagram Reel or TikTok URL. If left blank, the user-app
              uses the fallback HLS test stream.
            </p>
          </FieldRow>
        )}

        {/* Broadcast delay is enforced uniformly by the platform now — no
            per-event creator toggle. Surfaced as a static notice so
            creators understand the integrity guarantee. */}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            LiveRush adds a small broadcast delay to all streams to ensure
            fair betting for everyone watching.
          </span>
        </p>

        <LiveStreamTest title={title} />
        </div>
      </section>

      {/* ================================================================ */}
      {/* SECTION 4 — REVIEW                                                */}
      {/* ================================================================ */}
      <section
        id="review"
        aria-labelledby="review-heading"
        className="card-elevated overflow-hidden scroll-mt-20"
      >
        <SectionHeading id="review-heading" index={4} label="Review" />
        <div className="space-y-5 p-5 sm:p-6">

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <SummaryGroup
              title="Challenge"
              anchor="challenge"
              rows={[
                {
                  label: "Title",
                  value: title,
                  missing: title.trim().length < 5,
                },
                {
                  label: "Description",
                  value: description,
                  missing: description.trim().length === 0,
                },
                {
                  label: "Rules",
                  value:
                    rules.trim().length > 80
                      ? `${rules.trim().slice(0, 80)}…`
                      : rules.trim(),
                  missing: rules.trim().length < 30,
                },
                {
                  label: "Round format",
                  value:
                    roundFormat === "multi" ? "Multi-round" : "Single round",
                  missing: false,
                },
              ]}
            />
            <SummaryGroup
              title="Betting"
              anchor="betting"
              rows={[
                {
                  label: "Outcomes",
                  value:
                    validOutcomes.length > 0
                      ? validOutcomes
                          .map((o) => o.label.trim())
                          .join(" · ")
                      : "",
                  missing:
                    validOutcomes.length < 2 || outcomeDuplicates.size > 0,
                },
                // Bet-range summary row removed — stake range is
                // platform-fixed (1/5/10 coin chips, MAX_BET=$10 per
                // round). The studio doesn't surface it anymore
                // because the creator can't change it.
                {
                  label: "Betting window",
                  value: `${
                    BET_WINDOW_OPENS.find((o) => o.value === betWindowOpens)
                      ?.label
                  } → ${
                    BET_WINDOW_LOCKS.find((o) => o.value === betWindowLocks)
                      ?.label
                  }`,
                },
              ]}
            />
            <SummaryGroup
              title="Stream"
              anchor="stream"
              rows={[
                {
                  label: "Scheduled",
                  // Scheduling is OPTIONAL: when the creator picked
                  // "Go live now" (scheduleForLater off) there's
                  // nothing to validate — Publish synthesises a now()
                  // timestamp server-side. The row shows the chosen
                  // intent ("Going live now") instead of flagging
                  // Missing in that case.
                  value: scheduleForLater
                    ? scheduledAt
                      ? new Date(scheduledAt).toLocaleString()
                      : ""
                    : "Going live now on Publish",
                  missing: scheduleForLater
                    ? !scheduledAt ||
                      new Date(scheduledAt).getTime() <= Date.now()
                    : false,
                },
                {
                  label: "Source",
                  value:
                    SOURCE_TYPES.find((s) => s.value === sourceType)?.label ??
                    "",
                },
                // Only show the URL row when the source is "external link"
                // — for browser camera there's no URL to validate.
                ...(sourceType === "external_url"
                  ? [
                      {
                        label: "Stream URL",
                        value: videoUrl.trim(),
                        missing: videoUrl.trim().length === 0,
                      },
                    ]
                  : []),
              ]}
            />
          </div>

          <aside className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              How viewers will see this
            </p>
            <div className="overflow-hidden rounded-2xl border border-border/40 bg-card lg:sticky lg:top-20">
              <div className="relative aspect-[16/9] w-full bg-muted">
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt="Preview cover"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Camera className="h-6 w-6" />
                    <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Cover missing
                    </span>
                  </div>
                )}
              </div>
              <div className="space-y-2 p-4">
                <p className="font-heading text-base font-bold leading-tight">
                  {title || "Untitled event"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {scheduledAt
                    ? new Date(scheduledAt).toLocaleString()
                    : "Schedule pending"}
                </p>
                <ul className="space-y-1">
                  {validOutcomes.slice(0, 4).map((o, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between rounded-md bg-secondary/30 px-2 py-1 text-xs"
                    >
                      <span className="truncate">{o.label.trim()}</span>
                      <span className="ml-2 text-muted-foreground">—</span>
                    </li>
                  ))}
                  {validOutcomes.length === 0 && (
                    <li className="text-xs text-muted-foreground">
                      Outcomes will appear here
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </aside>
        </div>

        {/* Compliance checklist now lives in the left steps rail. */}
        </div>
      </section>

      {/* All action buttons now live in the sticky stepper bar at the
          top of the page, so no separate footer section is needed. */}
    </div>
  );
}

// =========================================================================
// Small layout helpers
// =========================================================================

/**
 * Section card header — same gradient bar pattern as the user-app's
 * UpcomingPanel / betting panel so the studio editor visually matches the
 * surface where these events will eventually be played back.
 */
function SectionHeading({
  id,
  index,
  label,
}: {
  id: string;
  index: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 bg-gradient-to-r from-[#1973FF] to-[#5048FF] px-4 py-3 text-white sm:px-5">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-bold backdrop-blur-sm">
        {index}
      </span>
      <h2
        id={id}
        className="font-heading text-sm font-bold uppercase tracking-wide"
      >
        {label}
      </h2>
    </div>
  );
}

function SubSectionHeading({ text }: { text: string }) {
  return (
    <p className="border-t border-border/30 pt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {text}
    </p>
  );
}

function FieldRow({
  label,
  htmlFor,
  helper,
  children,
}: {
  label: string;
  htmlFor?: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <label
          htmlFor={htmlFor}
          className="block text-sm font-semibold text-foreground"
        >
          {label}
        </label>
        {helper && <HelperTooltip text={helper} />}
      </div>
      {children}
    </div>
  );
}

/**
 * Small circled "?" rendered inline next to a field label. Hover (or
 * keyboard focus) reveals a styled tooltip — dark navy background
 * (the app's `--foreground` value, same as regular text) with light
 * text — instead of relying on the unstylable native `title` popup.
 */
function HelperTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:text-foreground"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 w-64 max-w-[min(16rem,calc(100vw-2rem))] rounded-md bg-foreground px-3 py-2 text-xs font-normal leading-snug text-background opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

function CharCounter({ value, max }: { value: string; max: number }) {
  return (
    <p
      className={cn(
        "text-right text-[11px] tabular-nums",
        value.length >= max ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {value.length} / {max}
    </p>
  );
}

function RadioCardGroup<T extends string>({
  name,
  value,
  onChange,
  disabled,
  options,
}: {
  name: string;
  value: T | "";
  onChange: (v: T) => void;
  disabled?: boolean;
  options: Array<{
    value: T;
    label: string;
    helper?: string;
    disabled?: boolean;
    badge?: "recommended" | "warning";
  }>;
}) {
  return (
    // Stack on mobile, evenly spaced columns at sm+. We currently
    // have 2 Source choices (Device camera + External link),
    // so 2 columns. Update both the class and the comment if a
    // third option is added back.
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((opt) => {
        const isSelected = value === opt.value;
        const isInteractive = !disabled && !opt.disabled;
        return (
          <label
            key={opt.value}
            className={cn(
              "flex h-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors",
              isSelected
                ? "border-primary bg-primary/5"
                : "border-border/40 hover:border-border",
              !isInteractive && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={isSelected}
              onChange={() => onChange(opt.value)}
              disabled={!isInteractive}
              className="mt-1"
            />
            <div className="flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">
                  {opt.label}
                </span>
                {opt.badge === "recommended" && (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                    Recommended
                  </span>
                )}
                {opt.badge === "warning" && (
                  <span className="rounded-full bg-[#FEE53A]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#B47C00]">
                    Higher dispute risk
                  </span>
                )}
              </div>
              {opt.helper && (
                <p className="text-xs text-muted-foreground">{opt.helper}</p>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}

function SummaryGroup({
  title,
  anchor,
  rows,
}: {
  title: string;
  anchor: string;
  // `value` is a ReactNode so a row can render a coin glyph + number
  // (e.g. Bet range) alongside plain-string rows. Empty string still
  // works as the "no value yet" signal — Missing chip kicks in via the
  // sibling `missing` flag, not the type of `value`.
  rows: Array<{ label: string; value: ReactNode; missing?: boolean }>;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="font-heading text-sm font-bold">{title}</p>
        <a
          href={`#${anchor}`}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Edit
        </a>
      </div>
      <dl className="mt-3 space-y-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3"
          >
            <dt className="w-40 flex-shrink-0 text-xs uppercase tracking-wider text-muted-foreground">
              {r.label}
            </dt>
            <dd className="flex items-center gap-1.5 text-sm">
              {r.missing ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Missing
                </span>
              ) : (
                <span className="text-foreground">{r.value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
