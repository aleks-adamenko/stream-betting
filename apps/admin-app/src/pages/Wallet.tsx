import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, TrendingUp } from "lucide-react";

import { formatCents } from "@liverush/lib";
import { supabase } from "@/integrations/supabase/client";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

type DayBucket = { day: string; amount_cents: number };

/**
 * /wallet — platform earnings dashboard. Three sections:
 *   - Lifetime total rake + residual sum
 *   - Last-30-day breakdown (simple flex bar chart, no chart lib)
 *   - Recent ledger entries on account='platform' for the audit feel
 *
 * All data comes from the get_platform_earnings RPC + a thin direct
 * SELECT on ledger_entries (admin RLS lets us read all rows).
 */
export default function Wallet() {
  const { data: earnings, isLoading: earningsLoading, error: earningsError } =
    useQuery({
      queryKey: ["admin", "wallet", "earnings"],
      queryFn: async () => {
        const { data, error } = await supabase.rpc("get_platform_earnings");
        if (error) throw error;
        return data as {
          lifetime_cents: number;
          breakdown_30d: DayBucket[];
        };
      },
    });

  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ["admin", "wallet", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ledger_entries")
        .select("id, account, type, amount_cents, reference_id, created_at")
        .eq("account", "platform")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const maxBar = useMemo(() => {
    if (!earnings?.breakdown_30d) return 0;
    return Math.max(...earnings.breakdown_30d.map((d) => d.amount_cents), 0);
  }, [earnings]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Wallet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform rake + rounding residual accumulated to date.
        </p>
      </header>

      {earningsError && <ErrorBanner error={earningsError as Error} />}

      {/* Lifetime total card */}
      <section className="rounded-2xl border border-border/40 bg-gradient-to-br from-primary/10 to-primary/5 p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5" />
          Platform earnings — lifetime
        </div>
        {earningsLoading ? (
          <Loader2 className="mt-3 h-6 w-6 animate-spin text-muted-foreground" />
        ) : (
          <p className="mt-2 font-heading text-4xl font-bold tabular-nums text-foreground sm:text-5xl">
            {formatCents(earnings?.lifetime_cents ?? 0)}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Sum of rake + residual rows on the
          {" "}<code className="font-mono">platform</code> account.
        </p>
      </section>

      {/* 30-day breakdown */}
      <section className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Last 30 days
        </h2>
        {earningsLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !earnings?.breakdown_30d?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No data yet.
          </p>
        ) : (
          <div className="mt-3 flex items-end gap-1 h-32">
            {earnings.breakdown_30d.map((bucket) => {
              const heightPct =
                maxBar > 0 ? (bucket.amount_cents / maxBar) * 100 : 0;
              const dateLabel = dayLabelFormatter.format(new Date(bucket.day));
              const tooltipLabel = `${dateLabel}: ${formatCents(bucket.amount_cents)}`;
              return (
                <div
                  key={bucket.day}
                  className="group relative flex flex-1 flex-col justify-end"
                  title={tooltipLabel}
                >
                  <div
                    className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary"
                    style={{ height: `${Math.max(heightPct, 2)}%` }}
                  />
                </div>
              );
            })}
          </div>
        )}
        {earnings?.breakdown_30d?.length ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Hover a bar for the daily total. Empty days render as a thin
            placeholder.
          </p>
        ) : null}
      </section>

      {/* Recent platform ledger entries */}
      <section className="rounded-2xl border border-border/40 bg-card shadow-sm">
        <header className="border-b border-border/40 px-4 py-3 sm:px-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Recent platform entries
          </h2>
        </header>
        {recentLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !recent?.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No platform ledger entries yet.
          </p>
        ) : (
          <div className="divide-y divide-border/40">
            {recent.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-4 px-4 py-3 sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px]">
                      {row.type}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {dateFormatter.format(new Date(row.created_at))}
                    {row.reference_id && (
                      <>
                        {" · "}
                        <span className="font-mono">
                          {row.reference_id.slice(0, 8)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <p className="font-heading text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{formatCents(row.amount_cents)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ErrorBanner({ error }: { error: Error }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p>{error.message}</p>
    </div>
  );
}
