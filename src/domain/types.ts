export type EventStatus = "scheduled" | "live" | "finished";
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
  status: EventStatus;
  category: string;
  rules: string;
  roundFormat: RoundFormat;
  roundDurationSec?: number;
  scheduledAt: string;
  startedAt?: string;
  viewersCount: number;
  influencer: Influencer;
  outcomes: BetOutcome[];
  totalPool: number;
}
