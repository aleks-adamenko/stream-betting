import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { EventStatus, Influencer, StreamEvent } from "@/domain/types";

// Statuses user-app surfaces. `draft` is creator-only (hidden by RLS too)
// and `cancelled` is filtered out client-side too. `pending_moderation`
// and `settled` both surface as "Finished" cards in the feed — the UX
// difference (winner declared vs. payouts released) lives in the bet
// panel on the detail page, not the listing.
const PUBLIC_STATUSES = [
  "scheduled",
  "live",
  "pending_moderation",
  "settled",
  "finished",
] as const;

type EventRow = Database["public"]["Tables"]["events"]["Row"] & {
  influencer: Database["public"]["Tables"]["influencers"]["Row"] | null;
  creator: Pick<
    Database["public"]["Tables"]["creator_profiles"]["Row"],
    "id" | "handle" | "display_name" | "avatar_url" | "followers_count" | "social_links"
  > | null;
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
  betting_closes_at,
  viewers_count,
  total_pool,
  playback_url,
  influencer:influencers!events_influencer_id_fkey (
    id, handle, display_name, avatar_url, followers, socials
  ),
  creator:creator_profiles!events_creator_id_fkey (
    id, handle, display_name, avatar_url, followers_count, social_links
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

/** Studio-created creators land here through the events.creator_id FK and
 *  get adapted into the same Influencer shape that the user-app UI
 *  components already render. The DB columns differ a touch
 *  (followers_count vs followers, social_links vs socials) so this
 *  mapper bridges them. */
function mapCreator(
  row: NonNullable<EventRow["creator"]>,
): Influencer {
  const socials = (row.social_links ?? {}) as Record<string, string | undefined>;
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? "",
    followers: row.followers_count,
    socials: {
      instagram: socials.instagram,
      tiktok: socials.tiktok,
      youtube: socials.youtube,
      x: socials.x,
    },
  };
}

function mapEvent(row: EventRow): StreamEvent {
  // Studio-published events populate `creator_id` (→ creator_profiles);
  // legacy seeded events populate `influencer_id` (→ influencers). Each
  // event has exactly one of the two — prefer the creator side when
  // present so studio events surface with the verified creator's data.
  let influencer: Influencer | null = null;
  if (row.creator) {
    influencer = mapCreator(row.creator);
  } else if (row.influencer) {
    influencer = mapInfluencer(row.influencer);
  }
  if (!influencer) {
    throw new Error(`Event ${row.id} has neither a creator nor an influencer`);
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    coverUrl: row.cover_url ?? "",
    videoUrl: row.video_url ?? null,
    playbackUrl: row.playback_url ?? null,
    category: row.category,
    rules: row.rules ?? "",
    roundFormat: row.round_format,
    roundDurationSec: row.round_duration_sec ?? undefined,
    // The DB enum now includes 'draft' + 'cancelled' but both are filtered
    // out at the query level before reaching this mapper.
    status: row.status as EventStatus,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at ?? undefined,
    bettingClosesAt: row.betting_closes_at ?? null,
    viewersCount: row.viewers_count,
    totalPool: Number(row.total_pool),
    influencer,
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
  // `created_at` desc puts freshly-published events at the top of every
  // status group. Studio creators expect their newly published event
  // to surface first in the Home "Upcoming" rail and at the start of
  // the Discover grid; this is the simplest proxy for "newest first"
  // without adding a dedicated published_at column.
  // `scheduled_at` asc is kept as a tiebreaker so two events created
  // in the same instant fall back to "earliest start first" order.
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .in("status", PUBLIC_STATUSES as unknown as string[])
    // Archived events disappear from the public feed but stay
    // reachable by id (see getEvent below) so viewers can still open
    // their settled bets from My Bets.
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .order("scheduled_at", { ascending: true });

  if (error) throw error;
  return (data as unknown as EventRow[]).map(mapEvent);
}

export async function getEvent(id: string): Promise<StreamEvent | null> {
  // No archived filter here on purpose: a viewer with a payout on a
  // newly-archived event must still be able to open /event/:id from
  // My Bets and see the post-settlement detail page (winner, payout
  // amount, rules). Archive is a creator-side visibility flag, not a
  // historical wipe.
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", id)
    .in("status", PUBLIC_STATUSES as unknown as string[])
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapEvent(data as unknown as EventRow);
}
