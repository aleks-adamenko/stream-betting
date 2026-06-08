import { Link } from "react-router-dom";
import { toast } from "sonner";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NotificationType } from "@/services/notificationsService";
import {
  DEFAULT_META,
  TYPE_META,
} from "./notificationTypeMeta";
import { renderWithCoins } from "./renderWithCoins";

/**
 * Custom toast card rendered via `toast.custom()` from
 * NotificationsContext. Geometry follows the reference screenshot:
 *   • Icon-tinted avatar circle on the left (40 × 40, type-coloured)
 *   • Title + body stacked in the centre, body inlined with
 *     coin glyphs via renderWithCoins
 *   • X close button on the right (`toast.dismiss(toastId)`)
 *
 * Sticky variants (event_starting, round_starting) are clickable —
 * the whole card becomes a <Link> to /event/<id> that dismisses on
 * navigation. Non-sticky variants are static; the X button is the
 * only escape.
 */

interface NotificationToastCardProps {
  toastId: string | number;
  type: NotificationType;
  title: string;
  body: string | null;
  eventId: string | null;
  /** When true, the entire card is a navigation link. */
  clickable?: boolean;
}

export function NotificationToastCard({
  toastId,
  type,
  title,
  body,
  eventId,
  clickable = false,
}: NotificationToastCardProps) {
  const meta = TYPE_META[type] ?? DEFAULT_META;
  const Icon = meta.icon;

  const inner = (
    <>
      {/* Avatar circle — tinted by type per TYPE_META. h-10/w-10 to
          match the reference screenshot's icon-on-the-left silhouette. */}
      <span
        aria-hidden
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full",
          meta.iconClassName,
        )}
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-heading text-base font-semibold leading-tight text-foreground">
          {renderWithCoins(title)}
        </p>
        {body && (
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {renderWithCoins(body)}
          </p>
        )}
      </div>

      {/* X close — stopPropagation so the surrounding Link doesn't
          fire a navigation when the user explicitly dismissed.
          Hidden from screen readers in favour of the toast's own
          dismiss affordance handled by Sonner. */}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toast.dismiss(toastId);
        }}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </>
  );

  const baseClasses =
    "flex w-[min(420px,calc(100vw-32px))] items-start gap-3 rounded-2xl border border-border/40 bg-card p-4 shadow-2xl";

  if (clickable && eventId) {
    return (
      <Link
        to={`/event/${eventId}`}
        onClick={() => toast.dismiss(toastId)}
        className={cn(baseClasses, "transition-colors hover:bg-secondary/30")}
      >
        {inner}
      </Link>
    );
  }

  return <div className={baseClasses}>{inner}</div>;
}
