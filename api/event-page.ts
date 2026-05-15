import type { VercelRequest, VercelResponse } from "@vercel/node";
import fs from "fs";
import path from "path";
import { imageSize } from "image-size";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const SITE_URL = process.env.VITE_SITE_URL ?? "https://liverush.vercel.app";

interface EventRow {
  title: string;
  description: string | null;
  cover_url: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function inferMime(url: string): string {
  const u = url.split("?")[0].toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function replaceOrAppendAfter(
  html: string,
  matcher: RegExp,
  replacement: string,
  anchor: RegExp,
): string {
  if (matcher.test(html)) return html.replace(matcher, replacement);
  return html.replace(anchor, (m) => `${m}\n    ${replacement}`);
}

async function fetchEvent(id: string): Promise<EventRow | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/events?id=eq.${encodeURIComponent(id)}&select=title,description,cover_url&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as EventRow[];
    return rows[0] ?? null;
  } catch (e) {
    console.warn("[event-page] fetch failed", e);
    return null;
  }
}

function readImageDimensions(coverUrl: string): { width: number; height: number } | null {
  if (!coverUrl.startsWith("/")) return null;
  try {
    const filePath = path.join(process.cwd(), "public", coverUrl.replace(/^\//, ""));
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    const dim = imageSize(buf);
    if (!dim?.width || !dim?.height) return null;
    return { width: dim.width, height: dim.height };
  } catch (e) {
    console.warn("[event-page] image-size failed", e);
    return null;
  }
}

function injectMeta(html: string, event: EventRow): string {
  const title = `${event.title} | LiveRush`;
  const description = event.description ?? "";
  const rawCover = event.cover_url ?? "";
  const imageUrl = rawCover.startsWith("http")
    ? rawCover
    : `${SITE_URL}${rawCover.startsWith("/") ? rawCover : `/${rawCover}`}`;
  const mime = inferMime(imageUrl);
  const dims = readImageDimensions(rawCover);

  let out = html;
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  out = out.replace(
    /<meta\s+name="description"[^>]*>/,
    `<meta name="description" content="${escapeAttr(description)}" />`,
  );
  out = out.replace(
    /<meta\s+property="og:title"[^>]*>/,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
  );
  out = out.replace(
    /<meta\s+property="og:description"[^>]*>/,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
  );
  out = out.replace(
    /<meta\s+property="og:image"\s+[^>]*>/,
    `<meta property="og:image" content="${escapeAttr(imageUrl)}" />`,
  );
  if (dims) {
    out = out.replace(
      /<meta\s+property="og:image:width"[^>]*>/,
      `<meta property="og:image:width" content="${dims.width}" />`,
    );
    out = out.replace(
      /<meta\s+property="og:image:height"[^>]*>/,
      `<meta property="og:image:height" content="${dims.height}" />`,
    );
  }
  // og:image:type isn't in the base template — insert right after og:description.
  out = replaceOrAppendAfter(
    out,
    /<meta\s+property="og:image:type"[^>]*>/,
    `<meta property="og:image:type" content="${mime}" />`,
    /<meta\s+property="og:description"[^>]*>/,
  );
  out = out.replace(
    /<meta\s+name="twitter:title"[^>]*>/,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
  );
  out = out.replace(
    /<meta\s+name="twitter:description"[^>]*>/,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
  );
  out = out.replace(
    /<meta\s+name="twitter:image"[^>]*>/,
    `<meta name="twitter:image" content="${escapeAttr(imageUrl)}" />`,
  );

  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = typeof req.query.id === "string" ? req.query.id : "";
  const indexPath = path.join(process.cwd(), "dist", "index.html");
  let html: string;
  try {
    html = fs.readFileSync(indexPath, "utf8");
  } catch (e) {
    console.error("[event-page] missing dist/index.html", e);
    res.status(500).send("Build artifact missing");
    return;
  }

  const event = id ? await fetchEvent(id) : null;
  if (event) html = injectMeta(html, event);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400");
  res.status(200).send(html);
}
