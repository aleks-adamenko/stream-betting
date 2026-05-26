import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LogIn, Send, Users, Zap } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useEventChat, type ChatMessage } from "@/hooks/useEventChat";
import { useEventViewers } from "@/hooks/useEventViewers";

interface ChatPanelProps {
  eventId: string;
}

const MAX_BODY = 280;

/**
 * Per-event live chat panel.
 *
 * - Reads chat from `event_chat_messages` (RLS public-read) so anon
 *   visitors can follow along.
 * - The composer is functional only when the visitor is signed in.
 *   Anon users see a "Sign in to chat" CTA instead.
 * - Real-time updates flow through `useEventChat`'s Postgres-changes
 *   subscription; new messages auto-scroll the list to the bottom.
 * - Viewer count in the header is the same real-time presence count
 *   that drives the player chip on EventDetails.
 */
export function ChatPanel({ eventId }: ChatPanelProps) {
  const { user } = useAuth();
  const { messages, sendMessage, sending } = useEventChat(eventId);
  const viewerCount = useEventViewers(eventId, { track: false });

  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  // Auto-scroll to the latest line on every new message.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    try {
      await sendMessage(trimmed);
      setDraft("");
    } catch (err) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't send the message";
      toast.error(message);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border/30 bg-card shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-[#1973FF] to-[#5048FF] px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 fill-[#FED448] text-[#FED448]" />
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide">
            Live chat
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-bold tabular-nums">
          <Users className="h-4 w-4" />
          <span>{viewerCount}</span>
        </div>
      </div>

      {/* Messages — list is reverse-chronological in render: oldest at
          the top, newest at the bottom, with auto-scroll to follow new
          lines on insert. */}
      <ul
        ref={listRef}
        className="max-h-[480px] min-h-[200px] space-y-4 overflow-y-auto px-4 py-4"
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
              isMe={!!user && m.user_id === user.id}
            />
          ))
        )}
      </ul>

      {/* Composer — only functional when signed in. */}
      {user ? (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 border-t border-border/30 bg-muted/40 px-3 py-3"
        >
          <input
            type="text"
            placeholder="Say something…"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY))}
            maxLength={MAX_BODY}
            disabled={sending}
            className="flex-1 rounded-full border border-border/40 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
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
      )}
    </section>
  );
}

function ChatRow({
  message,
  isMe,
}: {
  message: ChatMessage;
  isMe: boolean;
}) {
  const name = message.display_name ?? "Viewer";
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <li className="flex items-start gap-3">
      {message.avatar_url ? (
        <img
          src={message.avatar_url}
          alt=""
          className="h-9 w-9 flex-shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
          {initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-heading text-sm font-bold text-primary">
            {name}
          </span>
          {isMe && (
            <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
              You
            </span>
          )}
        </div>
        <p className="mt-0.5 break-words text-sm leading-snug text-foreground">
          {message.body}
        </p>
      </div>
      <span className="flex-shrink-0 text-[11px] text-muted-foreground">
        {formatTime(message.created_at)}
      </span>
    </li>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
