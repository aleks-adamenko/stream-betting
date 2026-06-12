import { cn } from "@/lib/utils";

import { NotificationToastCard } from "./NotificationToastCard";
import type { ToastType } from "./notificationTypeMeta";

/**
 * One card in the on-screen notification stack. Built by
 * NotificationsContext from a realtime row or a local (client-only)
 * toast and handed to <NotificationStack/> for rendering.
 */
export interface StackItem {
  /** DB row id for server notifications, `local-N` for client toasts. */
  id: string;
  type: ToastType;
  title: string;
  body: string | null;
  eventId: string | null;
  /** When true the whole card is a link to /event/<id>. */
  clickable: boolean;
  /** Side-effect to run before the card leaves the stack (mark read). */
  onDismiss?: () => void;
}

interface NotificationStackProps {
  /** Oldest → newest. The newest sits at the front of the stack. */
  items: StackItem[];
  /** Remove a card from the stack by id. */
  onClose: (id: string) => void;
}

/**
 * Top-centre notification stack.
 *
 * Cards never auto-dismiss — the viewer closes the front card with its
 * X (or by tapping into the event, for clickable variants). The rest
 * sit behind it as a collapsed deck:
 *
 *   • The newest card is the front, fully visible and the ONLY
 *     interactive one (the wrapper toggles `pointer-events`).
 *   • Each older card is one layer back: nudged UP a little, scaled
 *     down, and faded, so a sliver peeks above the front card.
 *   • Closing the front card promotes the next one — it animates
 *     DOWN + up to full scale into the spot the front card held,
 *     and the deck behind it shuffles forward.
 *
 * Every card is absolutely positioned against a fixed-width wrapper so
 * the promote transition is a pure transform tween (no layout-mode
 * switch to fight), and the whole thing floats above app chrome.
 */

// How many cards are visible at once (front + peeking layers behind).
// Older undismissed cards stay queued and surface as the front ones
// are closed.
const MAX_VISIBLE = 4;
// Per-layer visual offsets, applied cumulatively by depth.
const PEEK_STEP_PX = 12; // upward nudge per layer back
const SCALE_STEP = 0.04; // shrink per layer back
const OPACITY_STEP = 0.22; // fade per layer back

export function NotificationStack({ items, onClose }: NotificationStackProps) {
  if (items.length === 0) return null;

  // Only the newest MAX_VISIBLE render; `visible` is still oldest →
  // newest so depth 0 (the front) is the last entry.
  const visible = items.slice(-MAX_VISIBLE);
  const count = visible.length;

  return (
    <div
      // pointer-events-none on the wrapper so the empty area around the
      // deck never blocks clicks on the page beneath; the front card
      // re-enables pointer events on itself.
      className="pointer-events-none fixed left-1/2 top-4 z-[100] -translate-x-1/2"
      style={{ width: "min(420px, calc(100vw - 32px))" }}
    >
      <div className="relative">
        {visible.map((item, i) => {
          const depth = count - 1 - i; // newest → 0 (front)
          const isFront = depth === 0;
          const translateY = -depth * PEEK_STEP_PX;
          const scale = 1 - depth * SCALE_STEP;
          const opacity = Math.max(0, 1 - depth * OPACITY_STEP);

          return (
            <div
              key={item.id}
              className={cn(
                "absolute left-0 top-0 w-full transition-all duration-300 ease-out",
                // animate-in fires once on mount → only brand-new
                // (front) cards slide in; cards shuffling backward keep
                // the same DOM node and just transition their transform.
                "animate-in fade-in slide-in-from-top-2",
                isFront ? "pointer-events-auto" : "pointer-events-none",
              )}
              style={{
                transform: `translateY(${translateY}px) scale(${scale})`,
                opacity,
                // Front card on top; deeper layers behind it.
                zIndex: count - depth,
                // Scale from the top edge so the peek slivers line up
                // above the front card rather than around its centre.
                transformOrigin: "top center",
              }}
            >
              <NotificationToastCard
                type={item.type}
                title={item.title}
                body={item.body}
                eventId={item.eventId}
                clickable={item.clickable}
                onClose={() => onClose(item.id)}
                onDismiss={item.onDismiss}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
