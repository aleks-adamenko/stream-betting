import { Zap, Users, Smile, Send, Crown } from "lucide-react";

interface ChatMessage {
  name: string;
  text: string;
  time: string;
  avatarUrl: string;
  crown?: boolean;
  isMe?: boolean;
}

const MESSAGES: ChatMessage[] = [
  {
    name: "RushFanatic",
    text: "Go Mango! 💪",
    time: "9:41 PM",
    avatarUrl:
      "https://images.unsplash.com/photo-1531427186611-ecfd6d936c79?auto=format&fit=crop&w=80&h=80&q=80",
  },
  {
    name: "QueenBee",
    text: "This is intense! 😱😱",
    time: "9:41 PM",
    avatarUrl:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=80&h=80&q=80",
    crown: true,
  },
  {
    name: "SpeedyG",
    text: "They got this!!!",
    time: "9:41 PM",
    avatarUrl:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=80&h=80&q=80",
  },
  {
    name: "GoodVibesOnly",
    text: "Such a close one lol",
    time: "9:41 PM",
    avatarUrl:
      "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=80&h=80&q=80",
  },
  {
    name: "kookaburra666",
    text: "My money's on the draw 👀 👀",
    time: "9:41 PM",
    avatarUrl:
      "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=80&h=80&q=80",
    crown: true,
    isMe: true,
  },
];

export function ChatPanel() {
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
          <span>1.2K</span>
        </div>
      </div>

      {/* Messages */}
      <ul className="max-h-[480px] space-y-4 overflow-y-auto px-4 py-4">
        {MESSAGES.map((m, i) => (
          <li key={i} className="flex items-start gap-3">
            <img
              src={m.avatarUrl}
              alt=""
              className="h-9 w-9 flex-shrink-0 rounded-full object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-heading text-sm font-bold text-primary">
                  {m.name}
                </span>
                {m.crown && (
                  <Crown className="h-3.5 w-3.5 flex-shrink-0 fill-[#FED448] text-[#FED448]" />
                )}
                {m.isMe && (
                  <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                    You
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm leading-snug text-foreground">{m.text}</p>
            </div>
            <span className="flex-shrink-0 text-[11px] text-muted-foreground">
              {m.time}
            </span>
          </li>
        ))}
      </ul>

      {/* Composer */}
      <div className="flex items-center gap-2 border-t border-border/30 bg-muted/40 px-3 py-3">
        <button
          type="button"
          aria-label="Emoji"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <Smile className="h-5 w-5" />
        </button>
        <input
          type="text"
          placeholder="Say something…"
          readOnly
          className="flex-1 rounded-full border border-border/40 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="button"
          aria-label="Send"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1973FF] to-[#5048FF] text-white shadow-md transition-transform hover:scale-105"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
