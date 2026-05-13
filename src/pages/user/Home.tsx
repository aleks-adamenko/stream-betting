import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { StreamCard } from "@/components/feed/StreamCard";
import { FeedSkeleton } from "@/components/feed/FeedSkeleton";
import { FeedArrows } from "@/components/feed/FeedArrows";
import { useEvents } from "@/hooks/useEvents";

type Tab = "for-you" | "live" | "trending" | "following";

const pathToTab: Record<string, Tab> = {
  "/": "for-you",
  "/live": "live",
  "/trending": "trending",
  "/following": "following",
};

function tabFromPath(pathname: string): Tab {
  return pathToTab[pathname] ?? "for-you";
}

export default function Home() {
  const { pathname } = useLocation();
  const tab = tabFromPath(pathname);
  const { data: allEvents, isLoading } = useEvents();

  const events = useMemo(() => {
    if (!allEvents) return [];
    const all = [...allEvents];
    switch (tab) {
      case "live":
        return all.filter((e) => e.status === "live");
      case "trending":
        return all
          .filter((e) => e.status !== "finished")
          .sort((a, b) => b.viewersCount + b.totalPool - (a.viewersCount + a.totalPool));
      case "following":
        return all.filter(
          (e) =>
            e.influencer.id === "inf_vibe" ||
            e.influencer.id === "inf_smily" ||
            e.influencer.id === "inf_mochi",
        );
      case "for-you":
      default:
        return [
          ...all.filter((e) => e.status === "live"),
          ...all.filter((e) => e.status === "scheduled"),
          ...all.filter((e) => e.status === "finished"),
        ];
    }
  }, [allEvents, tab]);

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-4 sm:px-4 sm:py-6">
      <FeedArrows />
      <div className="flex flex-col gap-5 sm:gap-6">
        {isLoading && <FeedSkeleton count={2} />}
        {!isLoading &&
          events.map((event) => <StreamCard key={event.id} event={event} />)}
        {!isLoading && events.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
            <p className="font-heading text-base font-semibold">Nothing here yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a different tab or check back soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
