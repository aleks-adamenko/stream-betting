/**
 * Renders a third-party social video (Instagram reel, TikTok) inside an
 * iframe sized to the parent. The iframe is offset to hide the post
 * header, scaled so the video portion matches the container height,
 * and a solid black mask covers anything left over at the bottom.
 *
 * Returns null if the URL can't be mapped to a known embed pattern so the
 * caller can fall back to its default player.
 */
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Platform = "instagram" | "tiktok";

interface EmbedConfig {
  platform: Platform;
  embedUrl: string;
  /** Pixels (in *unscaled* iframe coords) the post header occupies. */
  headerPx: number;
  /** Visual zoom applied to the iframe so the inner video fills the container. */
  scale: number;
  /** Solid black overlay at the wrapper bottom; hides any footer left after scaling. */
  bottomMask: number;
}

function instagramEmbed(url: string): EmbedConfig | null {
  const m = url.match(/instagram\.com\/(reels?|p|tv)\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const [, kind, id] = m;
  const path = kind.startsWith("reel") ? "reel" : kind;
  return {
    platform: "instagram",
    embedUrl: `https://www.instagram.com/${path}/${id}/embed/`,
    headerPx: 54,
    scale: 1.0,
    bottomMask: 0,
  };
}

function tiktokEmbed(url: string): EmbedConfig | null {
  const m = url.match(/tiktok\.com\/.*\/video\/(\d+)/);
  if (!m) return null;
  return {
    platform: "tiktok",
    embedUrl: `https://www.tiktok.com/embed/v2/${m[1]}`,
    headerPx: 60,
    scale: 1.15,
    bottomMask: 80,
  };
}

export function resolveSocialEmbedUrl(url: string): string | null {
  return (instagramEmbed(url) ?? tiktokEmbed(url))?.embedUrl ?? null;
}

interface SocialVideoEmbedProps {
  url: string;
  title?: string;
  /** When true (mobile fullscreen), the IG embed scale is bumped to fill the
   *  viewport instead of the compact 0.45 used in the inline player. */
  fullscreen?: boolean;
  /**
   * "cover" (default) crops the 9:16 video to fill the container — used on
   * the event page where the container is already roughly 9:16.
   * "contain" shrinks the 9:16 video uniformly so the full clip fits inside
   * the container by height (with letterbox on the sides when the container
   * is wider). Used by the home page where the featured slot is 16:9 / wider.
   */
  fit?: "cover" | "contain";
}

export function SocialVideoEmbed({
  url,
  title,
  fullscreen,
  fit = "cover",
}: SocialVideoEmbedProps) {
  const cfg = instagramEmbed(url) ?? tiktokEmbed(url);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (fit !== "contain") return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ w: rect.width, h: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);
  // Mobile/tablet container is half-height vs desktop, so the IG embed
  // is scaled down to match — keeps the visible video portion sized
  // to the container's height instead of overflowing.
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(max-width: 1023px)").matches
      : false,
  );
  // Lazy-initialize from window so first render already uses the correct
  // viewport ratio — otherwise the iframe loads at scale=1.0 (where IG chrome
  // is visible) before useEffect catches up.
  const [viewport, setViewport] = useState(() =>
    typeof window === "undefined"
      ? { w: 0, h: 0 }
      : { w: window.innerWidth, h: window.innerHeight },
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1023px)");
    setIsCompactViewport(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsCompactViewport(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  if (!cfg) return null;
  const isFullscreenIg = !!fullscreen && cfg.platform === "instagram";
  const isContain = fit === "contain";

  // Fullscreen IG: scale the 9:16 video to *cover* the viewport (whichever of
  // width/height edge is reached last drives the scale). Capped at 1.4 so we
  // don't crop more than ~14% off each side on ultra-tall phones.
  const coverScale =
    viewport.w > 0 ? (9 * viewport.h) / (16 * viewport.w) : 1.0;
  const fullscreenIgScale = Math.min(1.4, Math.max(1.0, coverScale));

  // Contain mode: shrink the 9:16 video so the *video portion* of the IG
  // embed (not the chrome around it) matches the container height. The
  // 0.7 factor accounts for IG's horizontal padding around the reel — the
  // actual video is roughly 70% of the iframe width, so a naive
  // 9·H / (16·W) formula would oversize the iframe and undersize the
  // video. Capped at 1 so containers taller than 9:16 don't blow the
  // video up past natural size.
  const IG_VIDEO_TO_IFRAME = 0.7;
  const containScale =
    isContain && containerSize.w > 0 && containerSize.h > 0
      ? Math.min(
          1,
          (9 * containerSize.h) / (16 * containerSize.w * IG_VIDEO_TO_IFRAME),
        )
      : null;

  const scale = isContain
    ? containScale ?? cfg.scale
    : cfg.platform === "instagram" && isCompactViewport
      ? fullscreen
        ? fullscreenIgScale
        : 0.45
      : cfg.scale;

  // Push the iframe up by the scaled header height so the post header
  // sits just above the visible area after scaling.
  const topOffset = Math.round(cfg.headerPx * scale);

  // Iframe CSS height — for fullscreen we need a literal viewport-derived
  // height; for everything else (including contain) the percentage-based
  // formula keeps the IG embed responsive to the iframe size so it adapts
  // its layout to the room we give it.
  const heightPct = Math.round(100 / scale);
  const iframeHeight = isFullscreenIg
    ? `calc(${cfg.headerPx}px + 100vw * 16 / 9)`
    : `calc(${heightPct}% + ${cfg.headerPx}px)`;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-black">
      <iframe
        src={cfg.embedUrl}
        title={title ?? "Embedded video"}
        className="absolute left-0 w-full border-0"
        style={{
          top: `-${topOffset}px`,
          height: iframeHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top center",
        }}
        allow="autoplay; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
        scrolling="no"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      {/* Mask the residual footer / caption / action row. Skipped in contain
          mode because the video is sized to fit and the container clips
          anything that would otherwise overflow. */}
      {!isContain && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-x-0 bottom-0 bg-black",
            // In fullscreen, the mask also has to swallow taps so the IG chrome
            // (caption / actions / "View on Instagram") behind it doesn't react
            // to user interaction. The native play button sits in the upper
            // portion of the iframe, so this doesn't interfere with it.
            isFullscreenIg ? "pointer-events-auto" : "pointer-events-none",
          )}
          style={
            isFullscreenIg
              ? // Gap between visual video bottom (= 100vw * 16/9 * scale) and
                // viewport bottom. Zero when scale exactly fills the viewport;
                // positive when scale is capped below cover-scale.
                {
                  height: `max(0px, calc(100dvh - 100vw * 16 * ${scale} / 9))`,
                }
              : { height: `${cfg.bottomMask}px` }
          }
        />
      )}
    </div>
  );
}
