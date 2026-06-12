import { Link } from "react-router-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DEFAULT_META,
  TYPE_META,
  type ToastType,
} from "./notificationTypeMeta";
import { renderWithCoins } from "./renderWithCoins";

/**
 * Custom notification card rendered by NotificationStack. Geometry
 * follows the reference screenshot:
 *   • Icon-tinted avatar circle on the left (40 × 40, type-coloured)
 *   • Title + body stacked in the centre, body inlined with
 *     coin glyphs via renderWithCoins
 *   • X close button on the right
 *
 * Cards no longer auto-dismiss — the X button (or, for clickable
 * variants, navigating into the event) is the only way to close one.
 * `onClose` removes the card from the on-screen stack; `onDismiss` is
 * an optional side-effect that runs first (e.g. the welcome card marks
 * its DB row read so it doesn't re-fire on the next page load).
 *
 * The card itself is always "wired" — NotificationStack gates which
 * card is interactive by toggling `pointer-events` on the wrapper, so
 * only the front card's X / link actually receive clicks.
 */

interface NotificationToastCardProps {
  type: ToastType;
  title: string;
  body: string | null;
  eventId: string | null;
  /** When true, the entire card is a navigation link. */
  clickable?: boolean;
  /** Remove this card from the on-screen stack. */
  onClose: () => void;
  /**
   * Optional side-effect to run when the user dismisses or navigates
   * away from the card. Used by sticky DB-backed notifications (e.g.
   * welcome) to mark the underlying row as read so the card doesn't
   * re-fire on the next page load.
   */
  onDismiss?: () => void;
}

export function NotificationToastCard({
  type,
  title,
  body,
  eventId,
  clickable = false,
  onClose,
  onDismiss,
}: NotificationToastCardProps) {
  const meta = TYPE_META[type] ?? DEFAULT_META;
  const Icon = meta.icon;

  // Run the optional side-effect (welcome → mark read) BEFORE removing
  // the card from the stack so the closure still has its context.
  const close = () => {
    onDismiss?.();
    onClose();
  };

  const inner = (
    <>
      {/* Avatar circle — tinted by type per TYPE_META. h-10/w-10 to
          match the reference screenshot's icon-on-the-left silhouette.
          `fill-current` for iconFilled types (welcome, round_starting)
          renders the Lucide icon as a solid silhouette instead of the
          default thin stroke that reads as AI-generated. */}
      <span
        aria-hidden
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full",
          meta.iconClassName,
        )}
      >
        <Icon className={cn("h-5 w-5", meta.iconFilled && "fill-current")} />
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
          fire a navigation when the user explicitly dismissed. */}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          close();
        }}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </>
  );

  // Two-layer outline matching the reference design:
  //   • Inner: `border-2 border-primary/30` — thin, darker primary
  //     blue, hugs the card edge.
  //   • Outer: `ring-4 ring-primary/15` — wider, lighter primary
  //     blue, sits OUTSIDE the border like a soft halo.
  // Tailwind's `ring` paints a box-shadow outside `border`, so the
  // two stack naturally without overlapping. Both reference the
  // same primary token so the colours stay in lockstep with the
  // brand even if design-tokens.css evolves later.
  //
  // `w-full` fills the fixed-width NotificationStack wrapper so every
  // card in the stack shares one silhouette.
  const baseClasses =
    "flex w-full items-start gap-3 rounded-2xl border-2 border-primary/30 ring-4 ring-primary/15 bg-card p-4 shadow-xl";

  if (clickable && eventId) {
    return (
      <Link
        to={`/event/${eventId}`}
        onClick={() => close()}
        // Hover affordance is a ring + shadow lift rather than a
        // background tint — `hover:bg-secondary/30` painted a
        // 30%-alpha overlay on top of `bg-card`, which Tailwind's
        // hover pseudo-class wins so the WHOLE toast went
        // see-through on hover (visible bug — page content
        // bleeds through the card body and the title). Brightening
        // the existing primary ring + nudging the shadow keeps the
        // tactile "clickable card" feedback without touching the
        // background opacity.
        className={cn(
          baseClasses,
          "transition-shadow hover:shadow-2xl hover:ring-primary/30",
        )}
      >
        {inner}
      </Link>
    );
  }

  return <div className={baseClasses}>{inner}</div>;
}
