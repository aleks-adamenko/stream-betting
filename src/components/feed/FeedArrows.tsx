import { useEffect, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Floating up/down arrows for desktop feed pages.
 * Click navigates to the previous / next event card via scroll-snap.
 */
export function FeedArrows() {
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    function update() {
      const top = main.scrollTop;
      const max = main.scrollHeight - main.clientHeight;
      setCanPrev(top > 8);
      setCanNext(top < max - 8);
    }

    update();
    main.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(main);
    return () => {
      main.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  function step(direction: "next" | "prev") {
    const main = document.querySelector<HTMLElement>("main");
    if (!main) return;

    const articles = Array.from(main.querySelectorAll<HTMLElement>("article"));
    if (articles.length === 0) return;

    const mainRect = main.getBoundingClientRect();
    const tolerance = 24;

    let currentIdx = 0;
    for (let i = 0; i < articles.length; i++) {
      const top = articles[i].getBoundingClientRect().top - mainRect.top;
      if (top > -tolerance) {
        currentIdx = i;
        break;
      }
      currentIdx = i;
    }

    const targetIdx =
      direction === "next"
        ? Math.min(currentIdx + 1, articles.length - 1)
        : Math.max(currentIdx - 1, 0);

    const target = articles[targetIdx];
    const targetScroll =
      target.getBoundingClientRect().top - mainRect.top + main.scrollTop;
    smoothScrollTo(main, targetScroll, 380);
  }

  return (
    <div className="pointer-events-none fixed bottom-1/2 right-6 z-30 hidden translate-y-1/2 flex-col gap-3 lg:flex">
      <ArrowButton
        ariaLabel="Previous event"
        disabled={!canPrev}
        onClick={() => step("prev")}
      >
        <ChevronUp className="h-5 w-5" />
      </ArrowButton>
      <ArrowButton
        ariaLabel="Next event"
        disabled={!canNext}
        onClick={() => step("next")}
      >
        <ChevronDown className="h-5 w-5" />
      </ArrowButton>
    </div>
  );
}

function smoothScrollTo(el: HTMLElement, target: number, durationMs: number) {
  const startScroll = el.scrollTop;
  const distance = target - startScroll;
  if (Math.abs(distance) < 1) return;
  // scroll-snap: mandatory prevents programmatic non-snap-point scrolling — turn it
  // off for the duration of the animation, then restore so CSS snaps the final landing.
  el.style.scrollSnapType = "none";

  const startTime = performance.now();
  function easeOutCubic(t: number) {
    return 1 - Math.pow(1 - t, 3);
  }

  function finalize() {
    el.scrollTop = target;
    el.style.scrollSnapType = "";
    // Programmatic sync scroll doesn't always fire native scroll event — nudge it.
    el.dispatchEvent(new Event("scroll"));
  }

  // Use CSS scroll-behavior as primary path; fall back to rAF, then setTimeout, then sync.
  if (typeof requestAnimationFrame === "function") {
    let lastFrame = startTime;
    function tick(now: number) {
      const t = Math.min((now - startTime) / durationMs, 1);
      el.scrollTop = startScroll + distance * easeOutCubic(t);
      lastFrame = now;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        finalize();
      }
    }
    requestAnimationFrame(tick);
    // Safety net: if rAF is throttled and never completes, force final state.
    window.setTimeout(() => {
      if (performance.now() - lastFrame > 100) finalize();
    }, durationMs + 200);
  } else {
    finalize();
  }
}

interface ArrowButtonProps {
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ArrowButton({ ariaLabel, disabled, onClick, children }: ArrowButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-border/50 bg-card shadow-lg transition-all",
        disabled
          ? "cursor-not-allowed text-muted-foreground/50 opacity-60"
          : "text-foreground hover:-translate-y-0.5 hover:shadow-xl hover:bg-secondary/70",
      )}
    >
      {children}
    </button>
  );
}
