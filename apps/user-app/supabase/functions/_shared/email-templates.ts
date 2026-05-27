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

import { APP_URL } from "./resend.ts";

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
  const dateLabel = new Date(ctx.scheduledAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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
