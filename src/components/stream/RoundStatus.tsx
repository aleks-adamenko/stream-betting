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

  const remainingPct = (remaining / durationSec) * 100;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const formatted = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  return (
    <div className={cn("flex items-center gap-3 py-1.5", className)}>
      <span className="inline-flex items-center rounded-full bg-primary/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
        Round {roundIndex}
      </span>
      <span className="whitespace-nowrap text-sm font-semibold text-foreground">
        Bets close in
      </span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#F61527] to-[#584CFC] transition-[width] duration-500 ease-linear"
          style={{ width: `${remainingPct}%` }}
        />
      </div>
      <span className="font-heading text-base font-bold tabular-nums text-foreground">
        {formatted}
      </span>
    </div>
  );
}
