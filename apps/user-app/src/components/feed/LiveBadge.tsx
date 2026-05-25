import { cn } from "@/lib/utils";

interface LiveBadgeProps {
  className?: string;
  size?: "sm" | "md";
}

export function LiveBadge({ className, size = "md" }: LiveBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-0.5 font-semibold uppercase tracking-wide text-destructive-foreground shadow-md",
        size === "sm" ? "text-[10px]" : "text-xs",
        className,
      )}
    >
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-live-pulse rounded-full bg-destructive-foreground/80" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive-foreground" />
      </span>
      Live
    </span>
  );
}
