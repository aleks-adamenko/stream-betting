import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface RoundStatusProps {
  durationSec: number;
  className?: string;
  onRoundEnd?: (roundIndex: number) => void;
}

/**
 * Visual stub for round timing. Cycles a countdown locally so the player feels
 * "live". Phase 4 will replace this with realtime round state from Supabase.
 */
export function RoundStatus({ durationSec, className, onRoundEnd }: RoundStatusProps) {
  const [roundIndex, setRoundIndex] = useState(1);
  const [remaining, setRemaining] = useState(durationSec);

  useEffect(() => {
    setRemaining(durationSec);
  }, [durationSec]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          onRoundEnd?.(roundIndex);
          setRoundIndex((r) => r + 1);
          return durationSec;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [durationSec, roundIndex, onRoundEnd]);

  const progress = ((durationSec - remaining) / durationSec) * 100;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const formatted = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <div
      className={cn(
        "pointer-events-none rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-white backdrop-blur",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            Round {roundIndex}
          </span>
          <span className="text-xs font-medium text-white/80">Bets close in</span>
        </div>
        <span className="font-heading text-base font-bold tabular-nums">{formatted}</span>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-destructive transition-[width] duration-500 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
