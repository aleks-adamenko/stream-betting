import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ChatMessage =
  Database["public"]["Tables"]["event_chat_messages"]["Row"];

const HISTORY_LIMIT = 100;

/**
 * Live per-event chat backed by `public.event_chat_messages`.
 *
 * - Fetches the most recent {@link HISTORY_LIMIT} messages on mount,
 *   returned oldest-first so the consumer can render top-to-bottom
 *   with auto-scroll-to-bottom for new lines.
 * - Subscribes to Postgres INSERT events on the table (filtered to
 *   this event_id) so new messages appear instantly without polling.
 * - `sendMessage(body)` calls the `send_chat_message` RPC — the RPC
 *   gates on the event being in scheduled/live and stamps display_name
 *   + avatar_url so historical chat survives later profile edits.
 */
export function useEventChat(eventId: string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    setLoading(true);

    // Initial fetch — newest-first from the index, then reverse so the
    // returned array is chronological (oldest at [0], newest at last).
    void supabase
      .from("event_chat_messages")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("Failed to load chat history", error);
          setMessages([]);
        } else {
          setMessages(((data ?? []) as ChatMessage[]).slice().reverse());
        }
        setLoading(false);
      });

    // Defer channel setup to a microtask so React Strict Mode's
    // sync mount → cleanup → remount sequence resolves cleanly. Calling
    // `.on()` on a channel that's already transitioned to "joined" from
    // a previous mount throws inside Supabase.
    const setupId = setTimeout(() => {
      if (cancelled) return;

      channel = supabase
        .channel(`event_chat:${eventId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "event_chat_messages",
            filter: `event_id=eq.${eventId}`,
          },
          (payload) => {
            const incoming = payload.new as ChatMessage;
            setMessages((prev) => {
              if (prev.some((m) => m.id === incoming.id)) return prev;
              const next = [...prev, incoming];
              return next.length > HISTORY_LIMIT * 2
                ? next.slice(-HISTORY_LIMIT)
                : next;
            });
          },
        )
        .subscribe();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(setupId);
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [eventId]);

  const sendMessage = useCallback(
    async (body: string) => {
      if (!eventId) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      setSending(true);
      try {
        // The RPC returns the freshly-inserted row. We append it
        // immediately so the sender sees their own message without
        // waiting for the Realtime echo (~100-500ms round-trip).
        // The dedupe-by-id in the postgres_changes handler skips
        // the broadcast when it eventually arrives.
        const { data, error } = await supabase.rpc("send_chat_message", {
          p_event_id: eventId,
          p_body: trimmed,
        });
        if (error) throw error;
        if (data) {
          const inserted = data as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === inserted.id)) return prev;
            const next = [...prev, inserted];
            return next.length > HISTORY_LIMIT * 2
              ? next.slice(-HISTORY_LIMIT)
              : next;
          });
        }
      } finally {
        setSending(false);
      }
    },
    [eventId],
  );

  return { messages, sendMessage, sending, loading };
}
