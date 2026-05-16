/**
 * Renders a third-party social video (Instagram reel, TikTok) inside an
 * iframe sized to the parent. The iframe is offset to hide the post
 * header, scaled so the video portion matches the container height,
 * and a solid black mask covers anything left over at the bottom.
 *
 * Returns null if the URL can't be mapped to a known embed pattern so the
 * caller can fall back to its default player.
 */
import { useEffect, useState } from "react";

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
}

export function SocialVideoEmbed({ url, title, fullscreen }: SocialVideoEmbedProps) {
  const cfg = instagramEmbed(url) ?? tiktokEmbed(url);
  // Mobile/tablet container is half-height vs desktop, so the IG embed
  // is scaled down to match — keeps the visible video portion sized
  // to the container's height instead of overflowing.
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
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
  // Fullscreen IG: scale the 9:16 video to *cover* the viewport (whichever of
  // width/height edge is reached last drives the scale). Capped at 1.4 so we
  // don't crop more than ~14% off each side on ultra-tall phones.
  const coverScale =
    viewport.w > 0 ? (9 * viewport.h) / (16 * viewport.w) : 1.0;
  const fullscreenIgScale = Math.min(1.4, Math.max(1.0, coverScale));
  const scale =
    cfg.platform === "instagram" && isCompactViewport
      ? fullscreen
        ? fullscreenIgScale
        : 0.45
      : cfg.scale;
  // Push the iframe up by the scaled header height so the post header
  // sits just above the visible area after scaling.
  const topOffset = Math.round(cfg.headerPx * scale);
  // For most cases: visual content reaches the container bottom when CSS
  // height ≈ container/scale. For fullscreen IG specifically, the iframe
  // also needs to be tall enough to render the FULL 9:16 video region
  // (54px header + 16/9 * iframe-css-width). Use CSS max() to satisfy both.
  const heightPct = Math.round(100 / scale);
  const iframeHeight = isFullscreenIg
    ? `max(${heightPct}% + ${cfg.headerPx}px, calc(${cfg.headerPx}px + 100vw * 16 / 9))`
    : `calc(${heightPct}% + ${cfg.headerPx}px)`;
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
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
      {/* Mask the residual footer / caption / action row */}
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
    </div>
  );
}
