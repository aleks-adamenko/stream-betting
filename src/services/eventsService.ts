import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Influencer, StreamEvent } from "@/domain/types";

type EventRow = Database["public"]["Tables"]["events"]["Row"] & {
  influencer: Database["public"]["Tables"]["influencers"]["Row"] | null;
  outcomes: Database["public"]["Tables"]["event_outcomes"]["Row"][];
};

const EVENT_SELECT = `
  id,
  title,
  description,
  cover_url,
  video_url,
  category,
  rules,
  round_format,
  round_duration_sec,
  status,
  scheduled_at,
  started_at,
  viewers_count,
  total_pool,
  influencer:influencers!events_influencer_id_fkey (
    id, handle, display_name, avatar_url, followers, socials
  ),
  outcomes:event_outcomes!event_outcomes_event_id_fkey (
    id, label, odds, sort_order
  )
` as const;

function mapInfluencer(
  row: Database["public"]["Tables"]["influencers"]["Row"],
): Influencer {
  const socials = (row.socials ?? {}) as Record<string, string | undefined>;
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? "",
    followers: row.followers,
    socials: {
      instagram: socials.instagram,
      tiktok: socials.tiktok,
      youtube: socials.youtube,
      x: socials.x,
    },
  };
}

function mapEvent(row: EventRow): StreamEvent {
  if (!row.influencer) {
    throw new Error(`Event ${row.id} is missing its influencer relation`);
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    coverUrl: row.cover_url ?? "",
    videoUrl: row.video_url ?? null,
    category: row.category,
    rules: row.rules ?? "",
    roundFormat: row.round_format,
    roundDurationSec: row.round_duration_sec ?? undefined,
    status: row.status,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at ?? undefined,
    viewersCount: row.viewers_count,
    totalPool: Number(row.total_pool),
    influencer: mapInfluencer(row.influencer),
    outcomes: [...row.outcomes]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({
        id: o.id,
        label: o.label,
        odds: Number(o.odds),
      })),
  };
}

export async function listEvents(): Promise<StreamEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .order("status", { ascending: true })
    .order("scheduled_at", { ascending: true });

  if (error) throw error;
  return (data as unknown as EventRow[]).map(mapEvent);
}

export async function getEvent(id: string): Promise<StreamEvent | null> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapEvent(data as unknown as EventRow);
}
