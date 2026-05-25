import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  ListChecks,
  Plus,
  ShieldAlert,
  Users,
} from "lucide-react";

import { Button } from "@liverush/ui";
import { cn } from "@liverush/lib";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export default function Dashboard() {
  const { creator } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ["studio", "dashboard-stats", creator?.id],
    enabled: !!creator,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, status")
        .eq("creator_id", creator!.id);
      if (error) throw error;
      const counts = {
        total: data.length,
        draft: data.filter((e) => e.status === "draft").length,
        published: data.filter((e) =>
          ["scheduled", "live", "finished"].includes(e.status),
        ).length,
      };
      return counts;
    },
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold sm:text-3xl">
            Welcome back, {creator?.display_name ?? "creator"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Manage your live events and creator profile from here.
          </p>
        </div>
        <Button asChild variant="accent" size="lg">
          <Link to="/events/new">
            <Plus className="h-4 w-4" />
            New event
          </Link>
        </Button>
      </div>

      {creator?.status === "pending" && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div>
            <p className="font-heading text-sm font-semibold text-amber-700">
              Your account is under review
            </p>
            <p className="mt-1 text-sm text-amber-800/80">
              You can already draft events and add outcomes. Publishing unlocks
              once a moderator verifies your account.
            </p>
          </div>
        </div>
      )}

      {creator?.status === "rejected" && (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
          <div>
            <p className="font-heading text-sm font-semibold text-destructive">
              Account not approved
            </p>
            <p className="mt-1 text-sm text-destructive/80">
              Your application wasn't approved. Reach out to the team if you
              think this was a mistake.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={ListChecks}
          label="Total events"
          value={stats?.total ?? 0}
        />
        <StatCard
          icon={Clock}
          label="Drafts"
          value={stats?.draft ?? 0}
          accent="text-primary"
        />
        <StatCard
          icon={CheckCircle2}
          label="Published"
          value={stats?.published ?? 0}
          accent="text-success"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Link
          to="/events"
          className="group rounded-2xl border border-border/40 bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            <h2 className="font-heading text-base font-semibold">Manage events</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            See your drafts, edit outcomes, and publish when you're ready.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:underline">
            Open events <ArrowRight className="h-4 w-4" />
          </span>
        </Link>
        <div className="rounded-2xl border border-dashed border-border/40 p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-5 w-5" />
            <h2 className="font-heading text-base font-semibold">Followers</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Your audience metrics will appear here once your account is
            verified and your first event has gone live.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-border/40 p-5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 text-foreground">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h2 className="font-heading text-base font-semibold">Schedule view</h2>
        </div>
        <p className="mt-2">
          Scheduled stream calendar lands in the next phase.
        </p>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn("h-4 w-4", accent)} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-2 font-heading text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
