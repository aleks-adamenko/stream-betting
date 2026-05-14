import { useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";

import { SideNav } from "./SideNav";
import { MobileTopBar } from "./MobileTopBar";
import { EventMobileTopBar } from "./EventMobileTopBar";
import { MobileFooter } from "./MobileFooter";
import { cn } from "@/lib/utils";
import bgUrl from "@/assets/live-rush-bg.jpg";

const FEED_PATHS = new Set(["/", "/live", "/trending"]);

export function AppLayout() {
  const { pathname } = useLocation();
  const isFeedRoute = FEED_PATHS.has(pathname);
  const isEventRoute = pathname.startsWith("/event/");

  return (
    <div className="relative flex h-[100dvh] overflow-hidden bg-background">
      {/* Doodle-pattern background image at 80% opacity */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          backgroundImage: `url(${bgUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      <SideNav />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {isEventRoute ? <EventMobileTopBar /> : <MobileTopBar />}
        <main
          className={cn(
            "flex-1 overflow-y-auto",
            isFeedRoute && "snap-y snap-mandatory scroll-pt-4 scroll-pb-4",
          )}
        >
          <Outlet />
          <MobileFooter />
        </main>
      </div>
    </div>
  );
}
