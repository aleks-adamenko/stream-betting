import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, LogIn, Send, Zap } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useEventChat, type ChatMessage } from "@/hooks/useEventChat";
import type { EventStatus } from "@/domain/types";
import { cn } from "@/lib/utils";

interface ChatPanelProps {
  eventId: string;
  /** Drives the composer visibility — once the event ends (finished /
   *  settled / pending_moderation / cancelled) we hide the input bar
   *  entirely. The messages list itself stays readable so viewers can
   *  catch up on the conversation post-stream. */
  eventStatus: EventStatus;
}

const MAX_BODY = 280;

// Username colour palette — 50 distinct hues at fixed saturation +
// lightness so every shade reads cleanly on both light and dark card
// backgrounds. Hue is the only axis that changes between slots.
//
// `usernameColor(eventId, userId)` deterministically hashes the
// (event_id, user_id) pair into one of the 50 slots — so:
//   • The same user always shows the same colour inside one event's
//     chat (their name doesn't flicker on every realtime insert).
//   • Different chats can map the same user to a different colour,
//     which is what gives each thread its own "random" palette
//     fingerprint.
//   • Different users in the same chat fan out across the palette
//     by hash, so you almost never see two adjacent names sharing
//     a colour.
const COLOR_SLOTS = 50;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    // Classic multiply-by-31 string hash. `| 0` keeps the result in
    // 32-bit signed range so we don't accidentally hit JS's bigint
    // overflow boundary on long ids.
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function usernameColor(eventId: string, seed: string): string {
  const slot = hashString(`${eventId}:${seed}`) % COLOR_SLOTS;
  // 360 / 50 = 7.2° between slots — enough that adjacent hues read
  // as visibly different. Saturation 65% + lightness 50% lands on
  // colours that contrast well against both `bg-card` (light) and
  // its dark-mode counterpart without needing a theme branch.
  const hue = (slot * 360) / COLOR_SLOTS;
  return `hsl(${hue}, 65%, 50%)`;
}

// Terminal lifecycle states where the chat composer should disappear.
// pending_moderation rides this set too because betting / streaming is
// already over — the chat composer would lure viewers into typing into
// a thread that nobody on the producer side is listening to.
const ENDED_STATUSES: ReadonlySet<EventStatus> = new Set([
  "finished",
  "settled",
  "pending_moderation",
  "cancelled",
]);

/**
 * Per-event live chat panel.
 *
 * - Reads chat from `event_chat_messages` (RLS public-read) so anon
 *   visitors can follow along.
 * - The composer is functional only when the visitor is signed in
 *   AND the event is still live; ended events hide the composer
 *   entirely so the panel reads as an archive.
 * - Real-time updates flow through `useEventChat`'s Postgres-changes
 *   subscription; new messages auto-scroll the list to the bottom.
 * - The header is collapsible — a chevron in the top-right toggles
 *   the message list + composer. The viewer-count chip that used to
 *   live here is gone (the same number lives on the player overlay)
 *   so the header is a single collapse affordance.
 */
export function ChatPanel({ eventId, eventStatus }: ChatPanelProps) {
  const { user } = useAuth();
  const { messages, sendMessage, sending } = useEventChat(eventId);

  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  // Ref on the composer input so we can re-focus it after a successful
  // send. The submit handler doesn't naturally preserve focus (the
  // <button type="submit"> grabs it on the implicit form submission
  // path), which made the cursor "fall out" of the input on every
  // send — viewers had to tap back into it to fire off another line.
  // On mobile that meant the soft keyboard collapsed mid-conversation.
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to the latest line on every new message. Skipped
  // while collapsed because the list isn't in the DOM then; on
  // expand we re-run via the dependency on `collapsed`.
  useEffect(() => {
    if (collapsed) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, collapsed]);

  const composerHidden = ENDED_STATUSES.has(eventStatus);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    try {
      await sendMessage(trimmed);
      setDraft("");
      // Re-focus the composer so the next message can be typed
      // immediately. Deferred to the next frame so React has time
      // to re-render with `sending=false` (the input was disabled
      // during the send) before we call focus() on it — otherwise
      // the focus() call lands on a still-disabled element and is
      // a no-op on iOS Safari.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } catch (err) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't send the message";
      toast.error(message);
    }
  };

  return (
    // On desktop the panel sits in a sticky right-rail slot
    // (EventDetails wraps the chat in `lg:flex-1 lg:min-h-0`). We
    // become a flex column with h-full so the message list inside
    // can flex-fill the available height — i.e. the bottom of the
    // chat card pins to the bottom of the viewport, no matter the
    // window size or how many messages we've received.
    //
    // When collapsed, we drop `lg:h-full` so the card shrinks to
    // just its header — without that, the wrapper's `lg:flex-1`
    // would force the empty card to keep filling the rail while
    // only the gradient bar at the top has content.
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border/30 bg-card shadow-lg",
        !collapsed && "lg:flex lg:h-full lg:flex-col",
      )}
    >
      {/* Header — title on the left, collapse chevron on the right.
          The viewer-count chip used to live in the top-right but the
          player overlay already surfaces that number; doubling it up
          here is just noise. */}
      {/* Compact header — matches the half-height treatment on the
          bet-side panels (BetPanel / UpcomingPanel / FinishedPanel)
          so all four right-rail headers line up visually. */}
      <div className="flex items-center justify-between bg-gradient-to-r from-[#1973FF] to-[#5048FF] px-4 py-1.5 text-white">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 fill-[#FED448] text-[#FED448]" />
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide">
            Live chat
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand chat" : "Collapse chat"}
          aria-expanded={!collapsed}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
        >
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Messages — oldest at the top, newest at the bottom, with
              auto-scroll to follow new lines on insert. No avatar
              column — the body gets the full width so longer messages
              don't wrap as aggressively. */}
          <ul
            ref={listRef}
            // Mobile keeps the fixed `max-h / min-h` caps so the
            // chat sits as a card in the document flow without
            // gobbling the whole screen. Desktop drops both caps
            // and flips to `flex-1 min-h-0` so the list fills the
            // remaining space inside the sticky aside; the bottom
            // of the card lines up with the viewport's bottom edge.
            className="max-h-[480px] min-h-[200px] space-y-1.5 overflow-y-auto px-4 py-4 lg:max-h-none lg:min-h-0 lg:flex-1"
          >
            {messages.length === 0 ? (
              <li className="py-8 text-center text-sm text-muted-foreground">
                Be the first to say something.
              </li>
            ) : (
              messages.map((m) => (
                <ChatRow
                  key={m.id}
                  message={m}
                  eventId={eventId}
                  isMe={!!user && m.user_id === user.id}
                />
              ))
            )}
          </ul>

          {/* Composer — hidden once the event is ended (no more chat
              activity expected) and replaced with a sign-in CTA when
              the visitor is anonymous on a live event. */}
          {!composerHidden &&
            (user ? (
              <form
                onSubmit={handleSubmit}
                className="flex items-center gap-2 border-t border-border/30 bg-muted/40 px-3 py-3"
              >
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Say something…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY))}
                  maxLength={MAX_BODY}
                  disabled={sending}
                  // Mobile font-size MUST be ≥ 16px or iOS Safari
                  // auto-zooms the viewport on focus (the bug the
                  // user hit: tapping the chat input made the entire
                  // event page snap-zoom). `text-base` is 16px;
                  // `sm:text-sm` drops back to 14px on tablet+ so the
                  // composer doesn't look chunky in the desktop right
                  // rail. Same trick the EventEditor uses for its
                  // mobile inputs (task #107).
                  className="flex-1 rounded-full border border-border/40 bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 sm:text-sm"
                />
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={sending || draft.trim().length === 0}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1973FF] to-[#5048FF] text-white shadow-md transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3 border-t border-border/30 bg-muted/40 px-4 py-3 text-sm">
                <p className="text-muted-foreground">Sign in to chat.</p>
                <Link
                  to="/auth/sign-in"
                  className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[#1973FF] to-[#5048FF] px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-transform hover:scale-105"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Sign in
                </Link>
              </div>
            ))}
        </>
      )}
    </section>
  );
}

function ChatRow({
  message,
  eventId,
  isMe,
}: {
  message: ChatMessage;
  eventId: string;
  isMe: boolean;
}) {
  // One-line layout — "username: message body" — instead of the
  // earlier two-row structure with author/timestamp on top and body
  // wrapped underneath. The timestamp is gone entirely (the chat
  // is live and tightly scoped to a single event, so absolute clock
  // times mostly noise). The body wraps naturally on the same
  // paragraph as the bold username, IM-style.
  //
  // Username colour is hashed off (eventId, user_id) so each viewer
  // gets their own stable shade inside this thread. Falls back to
  // display_name when user_id is null (legacy / anon messages) so
  // we still get *some* hash variety instead of every fallback
  // collapsing to the same colour.
  const name = message.display_name ?? "Viewer";
  const colorSeed = message.user_id ?? `name:${name}`;
  const nameColor = usernameColor(eventId, colorSeed);
  return (
    <li className="break-words text-sm leading-snug text-foreground">
      <span className="font-heading font-bold" style={{ color: nameColor }}>
        {name}
      </span>
      {isMe && (
        <span className="ml-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground align-middle">
          You
        </span>
      )}
      <span className="font-bold" style={{ color: nameColor }}>
        :{" "}
      </span>
      {message.body}
    </li>
  );
}
