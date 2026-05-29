import { useEffect, useState } from "react";

import { cn } from "@liverush/lib";

/**
 * Absolute countdown to the betting cutoff. Used by both the
 * user-app's video container and the studio's LiveStream header so
 * every viewer + the streamer see the same number.
 *
 * Reads `closesAt` directly from the DB-stamped `betting_closes_at`
 * timestamp; there's no per-client setup state — the component just
 * ticks every second and recomputes the diff. Reaching zero swaps the
 * chip to a "Betting closed" message; the parent UI is expected to
 * unmount this component shortly after when the event status flips.
 *
 * Two visual variants:
 *  - `overlay` — large MM:SS centred inside the video container
 *    (user-app top-center overlay).
 *  - `compact` — small pill suitable for the studio's header strip
 *    next to the Live + viewers chips.
 */

export interface BettingCountdownProps {
  closesAt: string | null | undefined;
  variant?: "overlay" | "compact";
  className?: string;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function BettingCountdown({
  closesAt,
  variant = "overlay",
  className,
}: BettingCountdownProps) {
  const closesAtMs = closesAt ? new Date(closesAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!closesAtMs) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [closesAtMs]);

  if (!closesAtMs) return null;

  const remainingMs = closesAtMs - now;
  const closed = remainingMs <= 0;
  const formatted = formatRemaining(remainingMs);

  // Urgency tint: under 60 seconds → red, otherwise the cool blue
  // shared with the rest of the player overlays.
  const urgent = !closed && remainingMs <= 60_000;

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums backdrop-blur",
          closed
            ? "bg-muted text-muted-foreground"
            : urgent
              ? "bg-destructive/85 text-white"
              : "bg-black/55 text-white",
          className,
        )}
      >
        <span className="opacity-80">
          {closed ? "Betting closed" : "Bets close"}
        </span>
        {!closed && <span className="font-extrabold">{formatted}</span>}
      </div>
    );
  }

  // Overlay variant: large MM:SS centred inside the video container.
  return (
    <div
      className={cn(
        "pointer-events-none flex flex-col items-center gap-0.5 rounded-2xl px-4 py-2 text-center backdrop-blur",
        closed
          ? "bg-black/55 text-white/80"
          : urgent
            ? "bg-destructive/80 text-white shadow-lg"
            : "bg-black/55 text-white shadow-lg",
        className,
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-80 sm:text-xs">
        {closed ? "Betting closed" : "Betting ends in"}
      </p>
      {!closed && (
        <p className="font-heading text-2xl font-extrabold tabular-nums leading-none sm:text-3xl">
          {formatted}
        </p>
      )}
    </div>
  );
}
