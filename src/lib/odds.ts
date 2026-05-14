/**
 * Map a decimal odd to Tailwind classes so the pill color shifts
 * relative to the event's own outcomes — brand blue for the favorite,
 * yellow → orange → red as the payout grows toward the long-shot.
 */
const TIERS = [
  "bg-primary/15 text-primary",
  "bg-cyan-500/15 text-cyan-600",
  "bg-amber-400/25 text-amber-700",
  "bg-orange-500/20 text-orange-700",
  "bg-red-500/15 text-red-600",
];

export function oddsPillClasses(odds: number, min: number, max: number): string {
  if (max <= min) return TIERS[0];
  const t = (odds - min) / (max - min);
  const idx = Math.min(TIERS.length - 1, Math.max(0, Math.floor(t * TIERS.length)));
  return TIERS[idx];
}

export function oddsRange(odds: number[]): { min: number; max: number } {
  if (odds.length === 0) return { min: 1, max: 1 };
  return { min: Math.min(...odds), max: Math.max(...odds) };
}
