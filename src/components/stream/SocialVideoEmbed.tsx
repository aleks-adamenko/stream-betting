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
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1023px)");
    setIsCompactViewport(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsCompactViewport(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  if (!cfg) return null;
  const scale =
    cfg.platform === "instagram" && isCompactViewport
      ? fullscreen
        ? 1
        : 0.45
      : cfg.scale;
  // Push the iframe up by the scaled header height so the post header
  // sits just above the visible area after scaling.
  const topOffset = Math.round(cfg.headerPx * scale);
  // After CSS transform: scale, the visual height is iframe_css_height * scale.
  // To make the visual content reach the container bottom (i.e. the crop line
  // sits at the very bottom of the container), the CSS height must be
  // container/scale so that height*scale === container.
  const heightPct = Math.round(100 / scale);
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <iframe
        src={cfg.embedUrl}
        title={title ?? "Embedded video"}
        className="absolute left-0 w-full border-0"
        style={{
          top: `-${topOffset}px`,
          height: `calc(${heightPct}% + ${cfg.headerPx}px)`,
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
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-black"
        style={
          fullscreen && cfg.platform === "instagram"
            ? // In fullscreen, the IG reel renders the video at 9:16 of iframe
              // width starting at the top, then IG chrome (caption, actions,
              // likes) below. Mask everything below the natural video bottom
              // so only the video frame is visible.
              { height: `calc(100dvh - 100vw * 16 / 9)` }
            : { height: `${cfg.bottomMask}px` }
        }
      />
    </div>
  );
}
