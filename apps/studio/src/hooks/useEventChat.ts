import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ChatMessage =
  Database["public"]["Tables"]["event_chat_messages"]["Row"];

const HISTORY_LIMIT = 100;

/**
 * Read-only chat subscription for the studio's LiveStream view. Same
 * channel + filter the user-app uses — the creator just doesn't post.
 */
export function useEventChat(eventId: string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!eventId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

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
      });

    // Defer channel setup so React Strict Mode's mount → cleanup →
    // remount sequence doesn't trip Supabase's "after subscribe()"
    // guard on `.on()`.
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

  return messages;
}
