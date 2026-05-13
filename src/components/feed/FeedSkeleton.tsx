export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <article key={i} className="flex gap-3 sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/40 bg-card shadow-lg">
            <div className="aspect-video w-full animate-pulse bg-muted" />
            <div className="space-y-3 p-4">
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="flex gap-2">
                <div className="h-7 w-28 animate-pulse rounded-lg bg-muted" />
                <div className="h-7 w-28 animate-pulse rounded-lg bg-muted" />
                <div className="h-7 w-28 animate-pulse rounded-lg bg-muted" />
              </div>
              <div className="h-10 w-full animate-pulse rounded-lg bg-muted" />
            </div>
          </div>
          <div className="hidden flex-shrink-0 flex-col items-center justify-end gap-4 pb-6 sm:flex">
            <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
            <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
            <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
            <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
          </div>
        </article>
      ))}
    </>
  );
}
