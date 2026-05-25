import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Plus, Sparkles } from "lucide-react";

import { Button } from "@liverush/ui";
import { cn } from "@liverush/lib";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  finished: "Finished",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-primary/10 text-primary",
  live: "bg-destructive/15 text-destructive",
  finished: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

export default function EventList() {
  const { creator } = useAuth();

  const { data: events, isLoading } = useQuery({
    queryKey: ["studio", "events", creator?.id],
    enabled: !!creator,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, status, scheduled_at, cover_url, category, created_at")
        .eq("creator_id", creator!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold sm:text-3xl">My events</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Every event you've drafted or published lives here.
          </p>
        </div>
        <Button asChild variant="accent" size="lg">
          <Link to="/events/new">
            <Plus className="h-4 w-4" />
            New event
          </Link>
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-border/40 bg-card"
            />
          ))}
        </div>
      )}

      {!isLoading && events && events.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 p-12 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-4 font-heading text-lg font-semibold">
            No events yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Spin up your first betting event in a couple of minutes.
          </p>
          <Button asChild variant="accent" size="lg" className="mt-5">
            <Link to="/events/new">
              <Plus className="h-4 w-4" />
              Create your first event
            </Link>
          </Button>
        </div>
      )}

      {!isLoading && events && events.length > 0 && (
        <ul className="space-y-3">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5"
            >
              <Link
                to={`/events/${event.id}`}
                className="flex items-center gap-4"
              >
                {event.cover_url ? (
                  <img
                    src={event.cover_url}
                    alt=""
                    className="h-16 w-16 flex-shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <CalendarClock className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-heading text-base font-semibold text-foreground sm:text-lg">
                    {event.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                    {event.category} ·{" "}
                    {new Date(event.scheduled_at).toLocaleString()}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                    STATUS_CLASS[event.status] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {STATUS_LABEL[event.status] ?? event.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
