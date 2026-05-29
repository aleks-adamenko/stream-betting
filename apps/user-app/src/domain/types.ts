export type EventStatus =
  | "scheduled"
  | "live"
  | "pending_moderation"
  | "settled"
  | "finished"
  | "cancelled";
export type RoundFormat = "time" | "event";

export interface Influencer {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  followers: number;
  socials: {
    instagram?: string;
    tiktok?: string;
    youtube?: string;
    x?: string;
  };
}

export interface BetOutcome {
  id: string;
  label: string;
  odds: number;
}

export interface StreamEvent {
  id: string;
  title: string;
  description: string;
  coverUrl: string;
  videoUrl?: string | null;
  /** HLS manifest URL for the live stream. Populated when the creator
   *  has hit Publish and we've provisioned a Cloudflare Stream live
   *  input. Fed straight to HlsPlayer; legacy `videoUrl` is the
   *  fallback for events imported from social embeds. */
  playbackUrl?: string | null;
  status: EventStatus;
  category: string;
  rules: string;
  roundFormat: RoundFormat;
  roundDurationSec?: number;
  scheduledAt: string;
  startedAt?: string;
  /** Hard betting cutoff stamped server-side by `start_event` when
   *  the event flips to `live`. Used by the countdown overlay so the
   *  timer is absolute (same value on every client). Null on events
   *  that haven't gone live yet. */
  bettingClosesAt?: string | null;
  /** Outcome ids the streamer declared as winning. Set by
   *  declare_winner; one for a clean win, many for dead heat. Null
   *  until declared (live + pending_moderation pre-declare). */
  winningOutcomeIds?: string[] | null;
  viewersCount: number;
  influencer: Influencer;
  outcomes: BetOutcome[];
  totalPool: number;
}
