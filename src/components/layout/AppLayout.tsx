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
const BAR_HEIGHT = 56; // EventMobileTopBar (h-14)

export function AppLayout() {
  const { pathname } = useLocation();
  const isFeedRoute = FEED_PATHS.has(pathname);
  const isEventRoute = pathname.startsWith("/event/");
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  // Mobile event reveal-on-scroll: top bar starts hidden, content sits
  // flush with the top of the screen; first 56px of scroll slide the
  // bar in (content shifts down in sync). Beyond 56px, normal scroll.
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

  // Swipe-down to reveal: at scrollTop === 0, a downward swipe gesture
  // triggers the top bar to animate in. Finger up / regular scroll is
  // left untouched. Once revealed, stays revealed.
  useEffect(() => {
    if (!revealActive) return;
    const main = mainRef.current;
    if (!main) return;

    const SWIPE_THRESHOLD_PX = 40;
    let startY: number | null = null;
    let triggered = false;

    const onTouchStart = (e: TouchEvent) => {
      if (main.scrollTop > 0) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
      triggered = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY === null || triggered) return;
      if (main.scrollTop > 0) {
        startY = null;
        return;
      }
      const dy = e.touches[0].clientY - startY;
      if (dy >= SWIPE_THRESHOLD_PX) {
        triggered = true;
        setAnimateReveal(true);
        setRevealedPx(BAR_HEIGHT);
      }
    };

    const onTouchEnd = () => {
      startY = null;
      triggered = false;
    };

    main.addEventListener("touchstart", onTouchStart, { passive: true });
    main.addEventListener("touchmove", onTouchMove, { passive: true });
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
  const transitionStyle = animateReveal
    ? "transform 200ms ease-out, margin-bottom 200ms ease-out"
    : undefined;
  const topBarStyle = applyReveal
    ? {
        transform: `translateY(-${hideDelta}px)`,
        marginBottom: `-${hideDelta}px`,
        transition: transitionStyle,
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
        {isEventRoute ? (
          <EventMobileTopBar style={topBarStyle} />
        ) : (
          <MobileTopBar />
        )}
        <main
          ref={mainRef}
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
