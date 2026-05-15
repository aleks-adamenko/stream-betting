import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";

import { SideNav } from "./SideNav";
import { MobileTopBar } from "./MobileTopBar";
import { EventMobileTopBar } from "./EventMobileTopBar";
import { MobileFooter } from "./MobileFooter";
import { cn } from "@/lib/utils";
import bgUrl from "@/assets/live-rush-bg.jpg";

const FEED_PATHS = new Set(["/", "/live", "/trending"]);
const BAR_HEIGHT = 56;
const PULL_TAP_TOLERANCE = 6;

export function AppLayout() {
  const { pathname } = useLocation();
  const isFeedRoute = FEED_PATHS.has(pathname);
  const isEventRoute = pathname.startsWith("/event/");
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  // Mobile event reveal-on-pull: top bar is rendered INSIDE main so it
  // scrolls away with the content. Initially hidden (transform + negative
  // margin collapse its slot). Swipe down at scrollTop === 0 drags the
  // bar in 1:1 with the finger; release snaps to 0 or 56.
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1023px)");
    setIsMobileViewport(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const revealActive = isMobileViewport && isEventRoute;
  const [revealedPx, setRevealedPx] = useState(BAR_HEIGHT);
  const [animateReveal, setAnimateReveal] = useState(false);

  useEffect(() => {
    setRevealedPx(revealActive ? 0 : BAR_HEIGHT);
    setAnimateReveal(false);
  }, [revealActive, pathname]);

  useEffect(() => {
    if (!revealActive) return;
    const main = mainRef.current;
    if (!main) return;

    let startY: number | null = null;
    let pulling = false;
    let lastDelta = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (main.scrollTop > 0) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
      pulling = false;
      lastDelta = 0;
      setAnimateReveal(false);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY === null) return;
      if (main.scrollTop > 0) {
        startY = null;
        pulling = false;
        return;
      }
      const dy = e.touches[0].clientY - startY;
      // Tap tolerance: small movement isn't a pull; let click events flow.
      if (!pulling && dy < PULL_TAP_TOLERANCE) return;
      if (dy <= 0) {
        // Finger moved up — let the browser scroll.
        startY = null;
        pulling = false;
        return;
      }
      pulling = true;
      lastDelta = dy;
      if (e.cancelable) e.preventDefault();
      setRevealedPx(Math.min(BAR_HEIGHT, dy));
    };

    const onTouchEnd = () => {
      if (!pulling) {
        startY = null;
        return;
      }
      setAnimateReveal(true);
      setRevealedPx(lastDelta >= BAR_HEIGHT / 2 ? BAR_HEIGHT : 0);
      startY = null;
      pulling = false;
    };

    main.addEventListener("touchstart", onTouchStart, { passive: true });
    main.addEventListener("touchmove", onTouchMove, { passive: false });
    main.addEventListener("touchend", onTouchEnd, { passive: true });
    main.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      main.removeEventListener("touchstart", onTouchStart);
      main.removeEventListener("touchmove", onTouchMove);
      main.removeEventListener("touchend", onTouchEnd);
      main.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [revealActive]);

  const hideDelta = BAR_HEIGHT - revealedPx;
  const applyReveal = revealActive && hideDelta > 0;
  const topBarStyle = revealActive
    ? {
        transform: `translateY(-${hideDelta}px)`,
        marginBottom: `-${hideDelta}px`,
        transition: animateReveal
          ? "transform 200ms ease-out, margin-bottom 200ms ease-out"
          : "none",
      }
    : undefined;

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
        {/* Non-event routes: standard mobile top bar above main */}
        {!isEventRoute && <MobileTopBar />}
        <main
          ref={mainRef}
          className={cn(
            "flex-1 overflow-y-auto",
            isFeedRoute && "snap-y snap-mandatory scroll-pt-4 scroll-pb-4",
          )}
        >
          {/* Event route: top bar is inside main so it scrolls with content */}
          {isEventRoute && <EventMobileTopBar style={topBarStyle} />}
          <Outlet />
          <MobileFooter />
        </main>
      </div>
    </div>
  );
}
