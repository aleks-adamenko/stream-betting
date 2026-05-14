import { Fragment, useMemo } from "react";
import { useLocation } from "react-router-dom";

import { StreamCard } from "@/components/feed/StreamCard";
import { FeedSkeleton } from "@/components/feed/FeedSkeleton";
import { FeedArrows } from "@/components/feed/FeedArrows";
import { useEvents } from "@/hooks/useEvents";
import rewardsBannerImg from "@/assets/rewards-banner-1.jpg";

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
          events.map((event, i) => (
            <Fragment key={event.id}>
              <StreamCard event={event} />
              {tab === "for-you" && i === 0 && <RewardsBannerCard />}
            </Fragment>
          ))}
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

function RewardsBannerCard() {
  return (
    <article className="relative mx-auto w-full max-w-[520px] snap-start scroll-mt-4">
      <button
        type="button"
        aria-label="Rewards"
        className="block w-full overflow-hidden rounded-2xl border border-border/40 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <img
          src={rewardsBannerImg}
          alt=""
          className="block h-auto w-full"
        />
      </button>
    </article>
  );
}
