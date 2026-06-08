// Inline-HTML email templates for the notification system.
//
// Each template returns { subject, html, text }. Plain inline HTML
// instead of React-Email / MJML because:
//   • the design surface is tiny (3 templates),
//   • Edge Functions deploy cleaner without an MJML build step,
//   • the layout is one column with a button — no need for grid magic.
//
// All templates share the same visual frame: brand-coloured header,
// cover image, title, short blurb, big CTA button, footer with the
// "manage your notifications" link. Style is inline so Gmail / Outlook
// don't strip a <style> block.

import { APP_URL, STUDIO_URL } from "./resend.ts";

/** Format an integer cent amount as the visible coin number — no
 *  currency symbol. Strips trailing `.00` for round amounts so we
 *  read "12" instead of "12.00" in tight contexts (subject lines,
 *  preheaders). The "$" sign is gone everywhere; we mark the unit
 *  with either the rush-coin glyph (HTML) or the 🪙 emoji
 *  (subject / plain-text fallback) via the helpers below.
 *
 *  Note: `balance_cents` divided by 100 IS the coin count — the
 *  IAP flow credits N×100 balance_cents per N coins, so the same
 *  "/100" maths reads correctly for both top-up and bet-settle
 *  amounts. */
function formatCoinValue(cents: number): string {
  const v = cents / 100;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

/** Base64-encoded rush-coin SVG. Inlined as a data URI in every
 *  HTML email so we don't need to host the icon on a CDN. Major
 *  webmail clients (Gmail, Apple Mail, Outlook.com, mobile) render
 *  SVG data URIs reliably; legacy Outlook desktop is the usual
 *  weak link — if we hit issues there we can swap to a hosted PNG
 *  by changing only this constant. */
const COIN_SVG_DATA_URI =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI0MCIgY3k9IjQwIiByPSIzOS41IiBmaWxsPSIjRkZEQzJBIiBzdHJva2U9IiNFMUEwMDQiLz48ZyBmaWx0ZXI9InVybCgjZmlsdGVyMF9pXzIwNF8yMikiPjxjaXJjbGUgY3g9IjQwIiBjeT0iNDAiIHI9IjMxIiBmaWxsPSIjRkZCNjA5Ii8+PC9nPjxnIGZpbHRlcj0idXJsKCNmaWx0ZXIxX2RfMjA0XzIyKSI+PHBhdGggZD0iTTM2LjM2MzggNDMuMTk2MkgyNi42Nzc0QzI1LjkyIDQzLjE5NjIgMjUuNDM3NSA0Mi4zODY5IDI1Ljc5NzcgNDEuNzIwN0wzNi43MTY1IDIxLjUyNDRDMzYuODkxMiAyMS4yMDEzIDM3LjIyODkgMjEgMzcuNTk2MiAyMUg0Ny44Mjg1QzQ4LjU5NDkgMjEgNDkuMDc2NSAyMS44MjY4IDQ4LjY5ODMgMjIuNDkzNEw0Mi4wNjcxIDM0LjE4MzRDNDEuNjg4OSAzNC44NTAxIDQyLjE3MDUgMzUuNjc2OCA0Mi45MzY5IDM1LjY3NjhINTIuNjg5NkM1My41NjU0IDM1LjY3NjggNTQuMDE4MSAzNi43MjI4IDUzLjQxODcgMzcuMzYxM0wzMi41ODQzIDU5LjU1MzlDMzEuODA5MiA2MC4zNzk2IDMwLjQ3NDkgNTkuNDgzNyAzMC45NDU4IDU4LjQ1MzdMMzcuMjczMyA0NC42MTJDMzcuNTc2MSA0My45NDk3IDM3LjA5MjEgNDMuMTk2MiAzNi4zNjM4IDQzLjE5NjJaIiBmaWxsPSJ3aGl0ZSIvPjxwYXRoIGQ9Ik0zNi4zNjM4IDQzLjE5NjJIMjYuNjc3NEMyNS45MiA0My4xOTYyIDI1LjQzNzUgNDIuMzg2OSAyNS43OTc3IDQxLjcyMDdMMzYuNzE2NSAyMS41MjQ0QzM2Ljg5MTIgMjEuMjAxMyAzNy4yMjg5IDIxIDM3LjU5NjIgMjFINDcuODI4NUM0OC41OTQ5IDIxIDQ5LjA3NjUgMjEuODI2OCA0OC42OTgzIDIyLjQ5MzRMNDIuMDY3MSAzNC4xODM0QzQxLjY4ODkgMzQuODUwMSA0Mi4xNzA1IDM1LjY3NjggNDIuOTM2OSAzNS42NzY4SDUyLjY4OTZDNTMuNTY1NCAzNS42NzY4IDU0LjAxODEgMzYuNzIyOCA1My40MTg3IDM3LjM2MTNMMzIuNTg0MyA1OS41NTM5QzMxLjgwOTIgNjAuMzc5NiAzMC40NzQ5IDU5LjQ4MzcgMzAuOTQ1OCA1OC40NTM3TDM3LjI3MzMgNDQuNjEyQzM3LjU3NjEgNDMuOTQ5NyAzNy4wOTIxIDQzLjE5NjIgMzYuMzYzOCA0My4xOTYyWiIgc3Ryb2tlPSIjRUJBMjA0IiBzdHJva2Utd2lkdGg9IjIiLz48L2c+PGRlZnM+PGZpbHRlciBpZD0iZmlsdGVyMF9pXzIwNF8yMiIgeD0iOSIgeT0iOSIgd2lkdGg9IjYyIiBoZWlnaHQ9IjYyIiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+PGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz48ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJzaGFwZSIvPjxmZUNvbG9yTWF0cml4IGluPSJTb3VyY2VBbHBoYSIgdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDEyNyAwIiByZXN1bHQ9ImhhcmRBbHBoYSIvPjxmZU9mZnNldCBkeT0iNCIvPjxmZUNvbXBvc2l0ZSBpbjI9ImhhcmRBbHBoYSIgb3BlcmF0b3I9ImFyaXRobWV0aWMiIGsyPSItMSIgazM9IjEiLz48ZmVDb2xvck1hdHJpeCB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMCAwIDAgMCAwLjg4MzMwMSAwIDAgMCAwIDAuNjI2MjI5IDAgMCAwIDAgMC4wMTcwMDMxIDAgMCAwIDEgMCIvPjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW4yPSJzaGFwZSIgcmVzdWx0PSJlZmZlY3QxX2lubmVyU2hhZG93XzIwNF8yMiIvPjwvZmlsdGVyPjxmaWx0ZXIgaWQ9ImZpbHRlcjFfZF8yMDRfMjIiIHg9IjI0LjY3NDYiIHk9IjIwIiB3aWR0aD0iMzAuMDE4OSIgaGVpZ2h0PSI0Mi44ODU2IiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+PGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz48ZmVDb2xvck1hdHJpeCBpbj0iU291cmNlQWxwaGEiIHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAxMjcgMCIgcmVzdWx0PSJoYXJkQWxwaGEiLz48ZmVPZmZzZXQgZHk9IjIiLz48ZmVDb21wb3NpdGUgaW4yPSJoYXJkQWxwaGEiIG9wZXJhdG9yPSJvdXQiLz48ZmVDb2xvck1hdHJpeCB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMCAwIDAgMCAwLjkyMTU2OSAwIDAgMCAwIDAuNjM1Mjk0IDAgMCAwIDAgMC4wMTU2ODYzIDAgMCAwIDEgMCIvPjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW4yPSJCYWNrZ3JvdW5kSW1hZ2VGaXgiIHJlc3VsdD0iZWZmZWN0MV9kcm9wU2hhZG93XzIwNF8yMiIvPjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW49IlNvdXJjZUdyYXBoaWMiIGluMj0iZWZmZWN0MV9kcm9wU2hhZG93XzIwNF8yMiIgcmVzdWx0PSJzaGFwZSIvPjwvZmlsdGVyPjwvZGVmcz48L3N2Zz4=";

/** Inline HTML for a coin amount: image + bare number. `size` is
 *  the icon dimensions in pixels and should roughly match the
 *  surrounding font-size — 16 for body copy, 20–22 for h1
 *  hero amounts. `vertical-align: middle` keeps the icon centre
 *  on the digit x-height middle across email clients. */
function coinHtml(cents: number, size: number): string {
  const value = formatCoinValue(cents);
  return `<img src="${COIN_SVG_DATA_URI}" alt="" width="${size}" height="${size}" style="display:inline-block;width:${size}px;height:${size}px;vertical-align:middle;margin-right:4px;" />${value}`;
}

/** Plain-text variant for subject lines, preheaders, and the
 *  text body — those contexts don't support HTML so we use the
 *  Unicode coin emoji 🪙 as a textual analog. */
function coinText(cents: number): string {
  return `🪙 ${formatCoinValue(cents)}`;
}

/** Map machine-readable cancel reasons (cancel_event sets these) to
 *  short viewer-readable explanations for the refund email body. */
function cancelReasonLabel(reason: string | null): string {
  if (!reason) return "the event was cancelled";
  if (reason.includes("streamer did not declare")) {
    return "the streamer didn't declare a result in time";
  }
  if (reason.includes("MIN_POOL") || reason.includes("min_pool")) {
    return "the betting pool was too small to settle fairly";
  }
  if (reason.includes("not enough unique bettors")) {
    return "there weren't enough bettors to settle fairly";
  }
  if (reason.includes("no bets on winner")) {
    return "no bets landed on the winning outcome";
  }
  return "the event was cancelled";
}

interface EventCtx {
  /** Human-readable event title — already URL-decoded. */
  eventTitle: string;
  /** Slug-style event id, e.g. `evt_xxx`. Used in deep links. */
  eventId: string;
  /** Cover image URL (absolute). Optional; templates handle the
   *  missing case by skipping the <img>. */
  coverUrl: string | null;
  /** Display name shown as "X is live now" / "X scheduled…". */
  creatorName: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// =========================================================================
// Shared frame
// =========================================================================

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function eventUrl(eventId: string): string {
  return `${APP_URL}/event/${eventId}`;
}

function unsubscribeUrl(): string {
  // Deep link to the user-app's profile / notifications settings.
  // Auth-walled — viewer signs in (or is already in) then can flip
  // the global toggle off. This is also the URL the
  // List-Unsubscribe header points to.
  return `${APP_URL}/profile?notifications=off`;
}

/** Brand-coloured frame around any body content. Keeps the visual
 *  language consistent across the three transactional templates. */
function frame(
  innerHtml: string,
  opts: { preheader?: string } = {},
): string {
  const preheader = opts.preheader ?? "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LiveRush</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0e0f12;">
    <span style="display:none;visibility:hidden;opacity:0;max-height:0;max-width:0;overflow:hidden;">${escape(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa;">
      <tr>
        <td align="center" style="padding:24px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <tr>
              <td style="background:linear-gradient(90deg,#498AFF 0%,#584CFC 50%,#7B3CFD 100%);padding:18px 24px;color:#ffffff;font-weight:800;letter-spacing:0.4px;font-size:14px;">
                LIVERUSH
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">${innerHtml}</td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px;font-size:12px;color:#6b7280;line-height:1.5;">
                You're getting this because you subscribed to event notifications on LiveRush.
                <a href="${unsubscribeUrl()}" style="color:#498AFF;text-decoration:underline;">Manage your notifications</a> or unsubscribe.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function ctaButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
    <tr>
      <td style="border-radius:12px;background:#FED448;">
        <a href="${url}" style="display:inline-block;padding:14px 22px;font-weight:700;color:#0e0f12;text-decoration:none;font-size:15px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function coverBlock(coverUrl: string | null): string {
  if (!coverUrl) return "";
  return `<div style="margin:0 0 18px;">
    <img src="${escape(coverUrl)}" alt="" width="512" style="display:block;width:100%;max-width:512px;height:auto;border-radius:12px;" />
  </div>`;
}

// =========================================================================
// Templates
// =========================================================================

/** 1) Subscription confirmation — sent right after the viewer hits
 *  "Notify me when live". Low-key tone, the real action is the
 *  later live email. */
export function renderSubscriptionConfirmation(ctx: EventCtx): RenderedEmail {
  const subject = `You're set: we'll ping you when "${ctx.eventTitle}" goes live`;
  const text = `You're subscribed to "${ctx.eventTitle}" by ${ctx.creatorName}.
We'll email you the moment it goes live, plus when ${ctx.creatorName} schedules new events.

View the event: ${eventUrl(ctx.eventId)}

Manage notifications: ${unsubscribeUrl()}`;
  const html = frame(
    `${coverBlock(ctx.coverUrl)}
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;line-height:1.25;">You're on the list</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#1f2937;">
      We'll email you the moment <strong>${escape(ctx.eventTitle)}</strong> goes live, plus when ${escape(ctx.creatorName)} schedules another event.
    </p>
    ${ctaButton(eventUrl(ctx.eventId), "View the event")}
    `,
    { preheader: `Subscribed to ${ctx.eventTitle}` },
  );
  return { subject, html, text };
}

/** 2) Event is live now — sent the moment status flips to 'live'. */
export function renderEventLive(ctx: EventCtx): RenderedEmail {
  const subject = `🔴 ${ctx.creatorName} is LIVE: ${ctx.eventTitle}`;
  const text = `${ctx.creatorName} just went live with "${ctx.eventTitle}".
Watch + place bets now: ${eventUrl(ctx.eventId)}

Manage notifications: ${unsubscribeUrl()}`;
  const html = frame(
    `${coverBlock(ctx.coverUrl)}
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#F61527;color:#ffffff;font-size:11px;font-weight:800;letter-spacing:0.6px;margin-bottom:12px;">LIVE NOW</div>
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;line-height:1.25;">${escape(ctx.creatorName)} is live</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#1f2937;">
      <strong>${escape(ctx.eventTitle)}</strong> just started. Hop in to watch and place your bet.
    </p>
    ${ctaButton(eventUrl(ctx.eventId), "Watch now →")}
    `,
    { preheader: `${ctx.creatorName} is live with ${ctx.eventTitle}` },
  );
  return { subject, html, text };
}

/** 3) New scheduled event from a creator the viewer follows. */
export function renderNewScheduled(
  ctx: EventCtx & { scheduledAt: string /* ISO */ },
): RenderedEmail {
  // IMPORTANT: Supabase Edge Functions run in UTC. `toLocaleString`
  // with no `timeZone` option silently formats in the runtime's TZ
  // (UTC), so an event scheduled at 13:00 UTC+3 (stored as 10:00Z)
  // rendered as "10:00 AM" with no suffix — recipients read it as
  // local time and showed up three hours early. Force UTC + emit
  // the abbreviation so the time is unambiguous; recipients in
  // different zones can convert reliably.
  const dateLabel = new Date(ctx.scheduledAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
  const subject = `📅 ${ctx.creatorName} scheduled: ${ctx.eventTitle}`;
  const text = `${ctx.creatorName} just scheduled a new event: "${ctx.eventTitle}".
Starts ${dateLabel}.

We'll email you again when it goes live.

View the event: ${eventUrl(ctx.eventId)}

Manage notifications: ${unsubscribeUrl()}`;
  const html = frame(
    `${coverBlock(ctx.coverUrl)}
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;line-height:1.25;">${escape(ctx.creatorName)} scheduled a new event</h1>
    <p style="margin:0 0 6px;font-size:15px;line-height:1.5;color:#1f2937;">
      <strong>${escape(ctx.eventTitle)}</strong>
    </p>
    <p style="margin:0 0 18px;font-size:14px;color:#6b7280;">Starts ${escape(dateLabel)}</p>
    ${ctaButton(eventUrl(ctx.eventId), "View the event")}
    <p style="margin:18px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">
      We'll send another email the moment it goes live.
    </p>
    `,
    { preheader: `${ctx.creatorName} scheduled ${ctx.eventTitle}` },
  );
  return { subject, html, text };
}

// =========================================================================
// Phase 2 — betting/settlement transactional templates
// =========================================================================
//
// These fire from the payouts_notify_dispatch + events_cancel_notify_dispatch
// triggers added in 20260530_000001_betting_emails.sql. Same visual frame
// as the v1 templates above; only the body content + CTA destination differ.

/** 4) Payout credited — a viewer's winning bet was approved and the
 *  money landed in their balance. Big amount, link back to the event. */
export function renderPayoutCredited(
  ctx: EventCtx & { amountCents: number },
): RenderedEmail {
  const txt = coinText(ctx.amountCents);
  const subject = `💰 You won ${txt} on "${ctx.eventTitle}"`;
  const text = `Your bet on "${ctx.eventTitle}" by ${ctx.creatorName} won.
${txt} has been credited to your LiveRush balance.

View the event: ${eventUrl(ctx.eventId)}

Manage notifications: ${unsubscribeUrl()}`;
  const html = frame(
    `${coverBlock(ctx.coverUrl)}
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#16a34a;color:#ffffff;font-size:11px;font-weight:800;letter-spacing:0.6px;margin-bottom:12px;">YOU WON</div>
    <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;line-height:1.2;">${coinHtml(ctx.amountCents, 28)}</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#1f2937;">
      Your bet on <strong>${escape(ctx.eventTitle)}</strong> by ${escape(ctx.creatorName)} won. The payout is in your LiveRush balance.
    </p>
    ${ctaButton(eventUrl(ctx.eventId), "View the event")}
    `,
    { preheader: `You won ${txt} on ${ctx.eventTitle}` },
  );
  return { subject, html, text };
}

/** 5) Refund issued — the event was cancelled (auto or manually) and a
 *  viewer's bet has been refunded. Sent one-per-bet via Resend batch. */
export function renderRefundIssued(
  ctx: EventCtx & { amountCents: number; reason: string | null },
): RenderedEmail {
  const txt = coinText(ctx.amountCents);
  const reasonLabel = cancelReasonLabel(ctx.reason);
  const subject = `↩️ Your ${txt} bet was refunded — "${ctx.eventTitle}" was cancelled`;
  const text = `Heads up: "${ctx.eventTitle}" by ${ctx.creatorName} was cancelled because ${reasonLabel}.
Your ${txt} bet has been refunded in full to your LiveRush balance.

View the event: ${eventUrl(ctx.eventId)}

Manage notifications: ${unsubscribeUrl()}`;
  const html = frame(
    `${coverBlock(ctx.coverUrl)}
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#6b7280;color:#ffffff;font-size:11px;font-weight:800;letter-spacing:0.6px;margin-bottom:12px;">REFUNDED</div>
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;line-height:1.25;">Your ${coinHtml(ctx.amountCents, 22)} bet was refunded</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#1f2937;">
      <strong>${escape(ctx.eventTitle)}</strong> by ${escape(ctx.creatorName)} was cancelled because ${escape(reasonLabel)}.
    </p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#1f2937;">
      Your full stake is back in your LiveRush balance.
    </p>
    ${ctaButton(eventUrl(ctx.eventId), "View the event")}
    `,
    { preheader: `${txt} refunded — ${ctx.eventTitle} cancelled` },
  );
  return { subject, html, text };
}

/** 6) Creator rake credited — the streamer's share of the pool after
 *  settlement landed in their creator balance. CTA points at studio. */
export function renderCreatorRakeCredited(
  ctx: EventCtx & { amountCents: number },
): RenderedEmail {
  const txt = coinText(ctx.amountCents);
  const subject = `💵 ${txt} streamer earnings credited from "${ctx.eventTitle}"`;
  const text = `Your event "${ctx.eventTitle}" is settled.
${txt} in streamer earnings has been credited to your LiveRush balance.

View your balance: ${STUDIO_URL}/balance

Manage notifications: ${unsubscribeUrl()}`;
  const html = frame(
    `${coverBlock(ctx.coverUrl)}
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#FED448;color:#0e0f12;font-size:11px;font-weight:800;letter-spacing:0.6px;margin-bottom:12px;">EARNINGS CREDITED</div>
    <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;line-height:1.2;">${coinHtml(ctx.amountCents, 28)}</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#1f2937;">
      Your event <strong>${escape(ctx.eventTitle)}</strong> is settled. ${coinHtml(ctx.amountCents, 16)} in streamer earnings is now in your LiveRush balance.
    </p>
    ${ctaButton(`${STUDIO_URL}/balance`, "View your balance")}
    `,
    { preheader: `${txt} streamer earnings credited` },
  );
  return { subject, html, text };
}

/** 7) Payout rejected — a moderator put a payout on hold. Notifies
 *  whoever the money was destined for: the viewer (winner payout) or
 *  the creator (rake payout). One template, role-aware wording. */
export function renderPayoutRejected(
  ctx: EventCtx & {
    amountCents: number;
    reason: string | null;
    notes: string | null;
    recipientRole: "viewer" | "streamer";
  },
): RenderedEmail {
  const txt = coinText(ctx.amountCents);
  const isViewer = ctx.recipientRole === "viewer";
  const what = isViewer ? "winning payout" : "streamer earnings payout";
  const ctaUrl = isViewer ? eventUrl(ctx.eventId) : `${STUDIO_URL}/balance`;
  const ctaLabel = isViewer ? "View the event" : "View your balance";
  const reasonLine = ctx.reason
    ? `Reason: ${ctx.reason}${ctx.notes ? ` — ${ctx.notes}` : ""}`
    : "A moderator is reviewing this payout.";

  const subject = `⚠️ Your ${what} on "${ctx.eventTitle}" is on hold`;
  const text = `Your ${what} of ${txt} on "${ctx.eventTitle}" is on hold pending moderator review.

${reasonLine}

We'll update you as soon as the review is complete. No action needed from you right now.

${ctaUrl}

Manage notifications: ${unsubscribeUrl()}`;
  const html = frame(
    `${coverBlock(ctx.coverUrl)}
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#f59e0b;color:#ffffff;font-size:11px;font-weight:800;letter-spacing:0.6px;margin-bottom:12px;">ON HOLD</div>
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;line-height:1.25;">Your ${escape(what)} is on hold</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#1f2937;">
      ${coinHtml(ctx.amountCents, 16)} on <strong>${escape(ctx.eventTitle)}</strong> is pending moderator review.
    </p>
    <p style="margin:0 0 18px;font-size:14px;color:#6b7280;line-height:1.5;">
      ${escape(reasonLine)}
    </p>
    <p style="margin:0 0 18px;font-size:14px;color:#6b7280;line-height:1.5;">
      We'll update you as soon as the review is complete. No action needed from you right now.
    </p>
    ${ctaButton(ctaUrl, ctaLabel)}
    `,
    { preheader: `${txt} ${what} on hold pending review` },
  );
  return { subject, html, text };
}
