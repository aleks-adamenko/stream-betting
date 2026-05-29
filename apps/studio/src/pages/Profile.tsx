import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheck,
  Clock,
  Instagram,
  Music2,
  Pencil,
  Twitter,
  Youtube,
} from "lucide-react";

import { Button } from "@liverush/ui";
import { cn } from "@liverush/lib";

import { StudioPageTabs } from "@/components/StudioPageTabs";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { compactNumber } from "@/lib/balance";

/**
 * Creator profile page — read-only summary of what the creator looks
 * like on the user-app side, plus their core stats: handle, verified
 * status, follower count, default commission percentage. The
 * onboarding wizard at /onboarding still owns initial profile setup;
 * "Edit profile" is a stub for the eventual in-app edit flow.
 */

type SocialLinks = {
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  x?: string;
};

// Same RPC the studio sidebar identity strip + the user-app event
// page read — single source of truth so the number is consistent
// everywhere it appears.
function useCreatorFollowerCount(creatorId: string | undefined) {
  return useQuery({
    queryKey: ["creator-follower-count", creatorId],
    enabled: !!creatorId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!creatorId) return 0;
      const { data, error } = await supabase.rpc(
        "get_creator_follower_count",
        { p_creator_id: creatorId },
      );
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
}

export default function Profile() {
  const { creator } = useAuth();
  const { data: followers } = useCreatorFollowerCount(creator?.id);
  // social_links is a JSONB column on creator_profiles — narrow it
  // here so per-network lookups stay typed.
  const socials = (creator?.social_links ?? {}) as SocialLinks;

  const onEditProfile = () =>
    toast.info("Edit profile coming soon", {
      description: "For now, the onboarding wizard covers setup changes.",
    });

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          How your creator card looks across LiveRush.
        </p>
      </div>

      <StudioPageTabs />

      {/* Identity card — avatar, display name, handle, status pill */}
      <section className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start gap-5">
          <div className="relative flex-shrink-0">
            {creator?.avatar_url ? (
              <img
                src={creator.avatar_url}
                alt={creator.display_name ?? ""}
                className="h-20 w-20 rounded-full object-cover ring-2 ring-primary/20"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 font-heading text-2xl font-bold text-primary ring-2 ring-primary/20">
                {(creator?.display_name ?? "C").slice(0, 2).toUpperCase()}
              </div>
            )}
            {/* Tiny green dot mirrors the sidebar identity strip. */}
            <span className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-card bg-success" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-xl font-bold leading-tight">
                {creator?.display_name ?? "Creator"}
              </h2>
              {creator?.status === "verified" && (
                <BadgeCheck className="h-5 w-5 fill-primary text-white" />
              )}
              {creator?.status === "pending" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  <Clock className="h-3 w-3" />
                  Pending review
                </span>
              )}
            </div>
            {creator?.handle && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                @{creator.handle}
              </p>
            )}
            {creator?.bio && (
              <p className="mt-3 text-sm leading-relaxed text-foreground/90 sm:text-base">
                {creator.bio}
              </p>
            )}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="default"
            onClick={onEditProfile}
            className="flex-shrink-0"
          >
            <Pencil className="h-4 w-4" />
            Edit profile
          </Button>
        </div>
      </section>

      {/* Stats row — followers + commission. Renders as two cards on
          desktop, one stacked column on phone. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Followers"
          value={compactNumber.format(followers ?? 0)}
          hint="Includes direct follows + event subscribers."
        />
        <StatCard
          label="Commission rate"
          value={`${(creator?.commission_pct ?? 10).toFixed(2)}%`}
          hint="Your share of each event's settled pool."
        />
      </section>

      {/* Social links — only render the row if at least one is set. */}
      {(socials.instagram || socials.tiktok || socials.youtube || socials.x) && (
        <section className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h3 className="font-heading text-sm font-semibold text-foreground">
            Socials
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {socials.instagram && (
              <SocialChip
                icon={Instagram}
                label={socials.instagram}
                href={`https://instagram.com/${socials.instagram.replace(/^@/, "")}`}
              />
            )}
            {socials.tiktok && (
              <SocialChip
                icon={Music2}
                label={socials.tiktok}
                href={`https://www.tiktok.com/@${socials.tiktok.replace(/^@/, "")}`}
              />
            )}
            {socials.youtube && (
              <SocialChip
                icon={Youtube}
                label={socials.youtube}
                href={socials.youtube}
              />
            )}
            {socials.x && (
              <SocialChip
                icon={Twitter}
                label={socials.x}
                href={`https://x.com/${socials.x.replace(/^@/, "")}`}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 font-heading text-3xl font-bold tabular-nums",
          accent,
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function SocialChip({
  icon: Icon,
  label,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
    >
      <Icon className="h-4 w-4" />
      <span className="truncate max-w-[180px]">{label}</span>
    </a>
  );
}
