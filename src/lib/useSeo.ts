import { useEffect } from "react";

interface SeoConfig {
  /** Full document title — e.g. "Event title | LiveRush" */
  title: string;
  /** Meta description (also fed to og:description / twitter:description) */
  description?: string;
  /** Cover image — absolute URL or "/path/to/img.jpg" (resolved against origin) */
  image?: string;
}

function absoluteUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
}

function inferMime(url: string): string {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

interface MetaSnapshot {
  el: Element;
  previousContent: string | null;
  created: boolean;
}

function setOrCreateMeta(
  attrKey: "property" | "name",
  attrValue: string,
  content: string,
  insertAfterSelector?: string,
): MetaSnapshot {
  const selector = `meta[${attrKey}="${attrValue}"]`;
  let el = document.querySelector(selector);
  let created = false;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attrKey, attrValue);
    const ref = insertAfterSelector
      ? document.querySelector(insertAfterSelector)
      : null;
    if (ref?.parentNode) {
      ref.parentNode.insertBefore(el, ref.nextSibling);
    } else {
      document.head.appendChild(el);
    }
    created = true;
  }
  const previousContent = el.getAttribute("content");
  el.setAttribute("content", content);
  return { el, previousContent, created };
}

function restore(snapshots: MetaSnapshot[]) {
  snapshots.forEach(({ el, previousContent, created }) => {
    if (created) {
      el.remove();
    } else if (previousContent !== null) {
      el.setAttribute("content", previousContent);
    }
  });
}

/**
 * Updates document.title and the social-card meta tags while the caller
 * component is mounted, then restores the previous DOM on unmount. The
 * og:image block (image, width, height, type) is updated in place when the
 * tags exist, otherwise the missing ones are inserted right after og:description.
 *
 * For og:image:width / og:image:height we load the image off-screen and
 * read its naturalWidth / naturalHeight, so the values reflect the actual
 * file dimensions.
 */
export function useSeo(config: SeoConfig | null | undefined) {
  useEffect(() => {
    if (!config) return;

    const snapshots: MetaSnapshot[] = [];
    const prevTitle = document.title;
    let cancelled = false;

    document.title = config.title;
    snapshots.push(
      setOrCreateMeta("property", "og:title", config.title),
      setOrCreateMeta("name", "twitter:title", config.title),
    );

    if (config.description) {
      snapshots.push(
        setOrCreateMeta("name", "description", config.description),
        setOrCreateMeta("property", "og:description", config.description),
        setOrCreateMeta("name", "twitter:description", config.description),
      );
    }

    if (config.image) {
      const imageUrl = absoluteUrl(config.image);
      const mime = inferMime(imageUrl);

      // Update / create the og:image block. Missing entries are inserted
      // right after og:description (per spec).
      snapshots.push(
        setOrCreateMeta(
          "property",
          "og:image",
          imageUrl,
          'meta[property="og:description"]',
        ),
        setOrCreateMeta(
          "property",
          "og:image:type",
          mime,
          'meta[property="og:description"]',
        ),
        setOrCreateMeta("name", "twitter:image", imageUrl),
      );

      // Width/height require the file to load — set them async, but only
      // commit if this effect is still active.
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        snapshots.push(
          setOrCreateMeta(
            "property",
            "og:image:width",
            String(img.naturalWidth),
            'meta[property="og:description"]',
          ),
          setOrCreateMeta(
            "property",
            "og:image:height",
            String(img.naturalHeight),
            'meta[property="og:description"]',
          ),
        );
      };
      img.src = imageUrl;
    }

    return () => {
      cancelled = true;
      document.title = prevTitle;
      restore(snapshots);
    };
  }, [config?.title, config?.description, config?.image]);
}
