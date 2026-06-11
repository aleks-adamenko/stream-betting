// Shared building blocks for the admin Users + Creators tables.
//
// Both pages read the same list_admin_users() RPC (single query key
// ["admin","users"]) and filter client-side — Users shows non-creators,
// Creators shows everyone with a creator_profiles row. The row type,
// date formatters, avatar/id/status/timezone cells, and the error banner
// are identical across the two, so they live here to avoid drift.

import { AlertTriangle, Copy, UserCircle2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@liverush/lib";

export const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const dateFormatterShort = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** One row of list_admin_users(). Mirrors the RPC Returns shape. */
export type UserRow = {
  id: string;
  email: string;
  role: "user" | "influencer" | "super_admin";
  is_admin: boolean;
  display_name: string | null;
  avatar_url: string | null;
  /** Viewer spending wallet (profiles.balance_cents). */
  balance_cents: number;
  /** Creator cashable rake pot (profiles.withdrawable_cents). 0 for
   *  non-creators. Shown on the Creators table instead of balance_cents. */
  creator_balance_cents: number;
  email_confirmed_at: string | null;
  /** `studio` = signed up via studio first (creator-applicant);
   *  `user_app` = signed up via the viewer app. Drives which
   *  column the email-pending / verified status badge lives in. */
  signup_origin: "studio" | "user_app" | null;
  /** Stamp of the user's first user-app visit (where activate_viewer
   *  awards the 100-coin starter). Null = they've never used the
   *  viewer side; the Viewer column shows "—" in that case. */
  viewer_activated_at: string | null;
  creator_status: "pending" | "verified" | "rejected" | null;
  creator_rejected_note: string | null;
  creator_moderated_at: string | null;
  /** profiles.timezone — IANA name, null when never set. */
  timezone: string | null;
  /** Total events authored (events.creator_id), all statuses. */
  streams_total: number;
  /** Subset broadcast (status in 'live'/'finished'). */
  streams_live: number;
  created_at: string;
};

/** 8×8 rounded avatar with a UserCircle2 fallback. */
export function AvatarCell({ url }: { url: string | null }) {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <UserCircle2 className="h-5 w-5 text-muted-foreground" />
      )}
    </div>
  );
}

/** Timezone label, or a muted dash when the user never set one. */
export function TimezoneCell({ timezone }: { timezone: string | null }) {
  if (!timezone) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="whitespace-nowrap text-xs text-foreground">
      {timezone}
    </span>
  );
}

/** Tone-keyed status pill — shared across both tables. */
export function StatusBadge({
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

export function CopyIdCell({ id }: { id: string }) {
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

/** Email + admin pill + display-name subtext, shared cell content. */
export function EmailCell({ user }: { user: UserRow }) {
  return (
    <div className="min-w-0 max-w-[280px]">
      <div className="flex items-center gap-1.5">
        <p className="truncate font-semibold text-foreground">{user.email}</p>
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
  );
}

export function ErrorBanner({ error }: { error: Error }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p>{error.message}</p>
    </div>
  );
}
