import { useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";

import { SideNav } from "./SideNav";
import { MobileTopBar } from "./MobileTopBar";
import { cn } from "@/lib/utils";

const FEED_PATHS = new Set(["/", "/live", "/trending"]);

export function AppLayout() {
  const { pathname } = useLocation();
  const isFeedRoute = FEED_PATHS.has(pathname);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <SideNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main
          className={cn(
            "flex-1 overflow-y-auto",
            isFeedRoute && "snap-y snap-mandatory scroll-pt-4 scroll-pb-4",
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
