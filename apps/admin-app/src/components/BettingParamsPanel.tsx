import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button, Input } from "@liverush/ui";
import { type BettingConfig, cn } from "@liverush/lib";

import {
  type AdminBettingConfig,
  getBettingConfig,
  updateBettingConfig,
} from "@/services/bettingConfigService";

/**
 * Admin Settings — betting parameters.
 *
 * Every betting limit, minimum, rake split, odds cap and window bound
 * lives in the singleton `betting_config` row (migration
 * `20260611_000003_betting_config_table.sql`). `get_betting_constants()`
 * reads from it, so saving here changes what new events are created
 * with. Live events keep the snapshot frozen onto
 * `events.betting_constants` at go-live — so a Save here affects NEW
 * events only.
 *
 * Validation is defence-in-depth: the table CHECK constraints are the
 * hard backstop, `update_betting_config` re-validates with friendly
 * messages, and this panel mirrors the same guardrails inline so Save
 * is blocked before the RPC is even called.
 *
 * Display conventions: cents fields edited in dollars (÷100), basis
 * points edited as a percentage (÷100), window bounds edited in
 * seconds with a humanised caption.
 */

// String-keyed working copy — one entry per editable input, in the
// natural unit the operator types (dollars / percent / seconds /
// counts). Converted to/from the canonical `BettingConfig` (cents /
// bps / seconds) at the seams.
interface ConfigDraft {
  minBetDollars: string;
  maxBetDollars: string;
  maxRoundStakeDollars: string;
  minUniqueBettors: string;
  minOutcomesWithBets: string;
  minPoolMaxBetMultiplier: string;
  minPoolFloorDollars: string;
  maxOddsCap: string;
  rakePct: string;
  rakePlatformPct: string;
  rakeStreamerPct: string;
  bettingWindowMinSec: string;
  bettingWindowDefaultSec: string;
  bettingWindowMaxSec: string;
  dailyCapDollars: string;
  minPayoutCoins: string;
  staleResultGraceMinutes: string;
}

type FieldKey = keyof ConfigDraft;

const dollarStr = (cents: number) => (cents / 100).toFixed(2);
const pctStr = (bps: number) => String(bps / 100);

function configToDraft(c: AdminBettingConfig): ConfigDraft {
  return {
    minBetDollars: dollarStr(c.minBetCents),
    maxBetDollars: dollarStr(c.maxBetCents),
    maxRoundStakeDollars: dollarStr(c.maxRoundStakeCents),
    minUniqueBettors: String(c.minUniqueBettors),
    minOutcomesWithBets: String(c.minOutcomesWithBets),
    minPoolMaxBetMultiplier: String(c.minPoolMaxBetMultiplier),
    minPoolFloorDollars: dollarStr(c.minPoolFloorCents),
    maxOddsCap: String(c.maxOddsCap),
    rakePct: pctStr(c.rakeBps),
    rakePlatformPct: pctStr(c.rakePlatformBps),
    rakeStreamerPct: pctStr(c.rakeStreamerBps),
    bettingWindowMinSec: String(c.bettingWindowMinSec),
    bettingWindowDefaultSec: String(c.bettingWindowDefaultSec),
    bettingWindowMaxSec: String(c.bettingWindowMaxSec),
    dailyCapDollars: dollarStr(c.dailyCapCents),
    minPayoutCoins: String(c.minPayoutCoins),
    staleResultGraceMinutes: String(c.staleResultGraceMinutes),
  };
}

function draftToConfig(d: ConfigDraft): BettingConfig {
  const cents = (s: string) => Math.round(Number(s) * 100);
  const bps = (s: string) => Math.round(Number(s) * 100);
  const int = (s: string) => Math.round(Number(s));
  return {
    minBetCents: cents(d.minBetDollars),
    maxBetCents: cents(d.maxBetDollars),
    maxRoundStakeCents: cents(d.maxRoundStakeDollars),
    minUniqueBettors: int(d.minUniqueBettors),
    minOutcomesWithBets: int(d.minOutcomesWithBets),
    minPoolMaxBetMultiplier: int(d.minPoolMaxBetMultiplier),
    minPoolFloorCents: cents(d.minPoolFloorDollars),
    maxOddsCap: Number(d.maxOddsCap),
    rakeBps: bps(d.rakePct),
    rakePlatformBps: bps(d.rakePlatformPct),
    rakeStreamerBps: bps(d.rakeStreamerPct),
    bettingWindowMinSec: int(d.bettingWindowMinSec),
    bettingWindowMaxSec: int(d.bettingWindowMaxSec),
    bettingWindowDefaultSec: int(d.bettingWindowDefaultSec),
    dailyCapCents: cents(d.dailyCapDollars),
    minPayoutCoins: int(d.minPayoutCoins),
    staleResultGraceMinutes: int(d.staleResultGraceMinutes),
  };
}

function humanizeSeconds(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return "";
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m && s) return `${m} min ${s} sec`;
  if (m) return `${m} min`;
  return `${s} sec`;
}

// Mirror of the server-side guardrails (update_betting_config) + the
// table CHECK constraints. Returns a per-field message map; Save is
// disabled while any entry exists. `??=` so a cross-field rule never
// clobbers a more specific presence/positivity error.
function validate(d: ConfigDraft): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const cents = (s: string) => Math.round(num(s) * 100);
  const bps = (s: string) => Math.round(num(s) * 100);

  const minBet = cents(d.minBetDollars);
  const maxBet = cents(d.maxBetDollars);
  const maxRound = cents(d.maxRoundStakeDollars);
  const minBettors = num(d.minUniqueBettors);
  const minOutcomes = num(d.minOutcomesWithBets);
  const poolMult = num(d.minPoolMaxBetMultiplier);
  const poolFloor = cents(d.minPoolFloorDollars);
  const oddsCap = num(d.maxOddsCap);
  const rake = bps(d.rakePct);
  const rakePlat = bps(d.rakePlatformPct);
  const rakeStream = bps(d.rakeStreamerPct);
  const winMin = num(d.bettingWindowMinSec);
  const winDef = num(d.bettingWindowDefaultSec);
  const winMax = num(d.bettingWindowMaxSec);
  const dailyCap = cents(d.dailyCapDollars);
  const payout = num(d.minPayoutCoins);
  const grace = num(d.staleResultGraceMinutes);

  // Positivity / presence.
  if (!(minBet > 0)) e.minBetDollars = "Must be > $0";
  if (!(maxBet > 0)) e.maxBetDollars = "Must be > $0";
  if (!(maxRound > 0)) e.maxRoundStakeDollars = "Must be > $0";
  if (!(minBettors >= 1)) e.minUniqueBettors = "Must be ≥ 1";
  if (!(minOutcomes >= 2)) e.minOutcomesWithBets = "Must be ≥ 2";
  if (!(poolMult >= 1)) e.minPoolMaxBetMultiplier = "Must be ≥ 1";
  if (!(poolFloor >= 0)) e.minPoolFloorDollars = "Cannot be negative";
  if (!(oddsCap > 1)) e.maxOddsCap = "Must be > 1";
  if (!(rake >= 0 && rake <= 10000)) e.rakePct = "Must be 0–100%";
  if (!(rakePlat >= 0)) e.rakePlatformPct = "Cannot be negative";
  if (!(rakeStream >= 0)) e.rakeStreamerPct = "Cannot be negative";
  if (!(winMin >= 1)) e.bettingWindowMinSec = "Must be ≥ 1 sec";
  if (!(winDef >= 1)) e.bettingWindowDefaultSec = "Must be ≥ 1 sec";
  if (!(winMax >= 1)) e.bettingWindowMaxSec = "Must be ≥ 1 sec";
  else if (winMax > 1800) e.bettingWindowMaxSec = "Must be ≤ 1800 sec";
  if (!(dailyCap > 0)) e.dailyCapDollars = "Must be > $0";
  if (!(payout >= 1)) e.minPayoutCoins = "Must be ≥ 1";
  if (!(grace >= 1)) e.staleResultGraceMinutes = "Must be ≥ 1 min";

  // Cross-field invariants.
  if (minBet > 0 && maxBet > 0 && minBet > maxBet) {
    e.minBetDollars ??= "Min bet must be ≤ max bet";
  }
  if (maxBet > 0 && maxRound > 0 && maxBet > maxRound) {
    e.maxBetDollars ??= "Max bet must be ≤ max round stake";
  }
  if (
    Number.isFinite(rake)
    && Number.isFinite(rakePlat)
    && Number.isFinite(rakeStream)
    && rakePlat + rakeStream !== rake
  ) {
    e.rakePct ??= "Platform + streamer must equal total";
    e.rakePlatformPct ??= "Split must sum to total rake";
    e.rakeStreamerPct ??= "Split must sum to total rake";
  }
  if (winMin >= 1 && winDef >= 1 && winMin > winDef) {
    e.bettingWindowMinSec ??= "Min must be ≤ default";
  }
  if (winDef >= 1 && winMax >= 1 && winDef > winMax) {
    e.bettingWindowDefaultSec ??= "Default must be ≤ max";
  }
  if (dailyCap > 0 && maxRound > 0 && dailyCap < maxRound) {
    e.dailyCapDollars ??= "Must be ≥ max round stake";
  }
  return e;
}

interface FieldDef {
  key: FieldKey;
  label: string;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  hint?: string;
  caption?: (d: ConfigDraft) => string;
}

interface FieldGroup {
  title: string;
  note?: string;
  fields: FieldDef[];
}

const windowCaption = (key: FieldKey) => (d: ConfigDraft) =>
  humanizeSeconds(Number(d[key]));

const GROUPS: FieldGroup[] = [
  {
    title: "Stake limits",
    note: "Min bet ≤ max bet ≤ max round stake.",
    fields: [
      { key: "minBetDollars", label: "Min bet", prefix: "$", step: 0.01, min: 0 },
      { key: "maxBetDollars", label: "Max bet", prefix: "$", step: 0.01, min: 0 },
      {
        key: "maxRoundStakeDollars",
        label: "Max round stake",
        prefix: "$",
        step: 0.01,
        min: 0,
      },
    ],
  },
  {
    title: "Minimums",
    note: "Settlement guards — an event won't pay out below these.",
    fields: [
      {
        key: "minUniqueBettors",
        label: "Min unique bettors",
        suffix: "bettors",
        step: 1,
        min: 1,
        hint: "≥ 1",
      },
      {
        key: "minOutcomesWithBets",
        label: "Min outcomes with bets",
        suffix: "outcomes",
        step: 1,
        min: 2,
        hint: "≥ 2",
      },
      {
        key: "minPoolMaxBetMultiplier",
        label: "Min-pool max-bet ×",
        suffix: "×",
        step: 1,
        min: 1,
        hint: "≥ 1",
      },
      {
        key: "minPoolFloorDollars",
        label: "Min-pool floor",
        prefix: "$",
        step: 0.01,
        min: 0,
      },
    ],
  },
  {
    title: "Odds & rake",
    note: "Platform + streamer rake must equal total rake.",
    fields: [
      {
        key: "maxOddsCap",
        label: "Max odds cap",
        suffix: "×",
        step: 0.1,
        min: 1,
        hint: "> 1",
      },
      { key: "rakePct", label: "Total rake", suffix: "%", step: 0.01, min: 0 },
      {
        key: "rakePlatformPct",
        label: "Platform rake",
        suffix: "%",
        step: 0.01,
        min: 0,
      },
      {
        key: "rakeStreamerPct",
        label: "Streamer rake",
        suffix: "%",
        step: 0.01,
        min: 0,
      },
    ],
  },
  {
    title: "Betting window",
    note: "Default applies to new events; min ≤ default ≤ max (≤ 30 min).",
    fields: [
      {
        key: "bettingWindowMinSec",
        label: "Window min",
        suffix: "sec",
        step: 1,
        min: 1,
        caption: windowCaption("bettingWindowMinSec"),
      },
      {
        key: "bettingWindowDefaultSec",
        label: "Window default",
        suffix: "sec",
        step: 1,
        min: 1,
        caption: windowCaption("bettingWindowDefaultSec"),
      },
      {
        key: "bettingWindowMaxSec",
        label: "Window max",
        suffix: "sec",
        step: 1,
        min: 1,
        caption: windowCaption("bettingWindowMaxSec"),
      },
    ],
  },
  {
    title: "Daily & payout",
    fields: [
      {
        key: "dailyCapDollars",
        label: "Daily cap (per user)",
        prefix: "$",
        step: 0.01,
        min: 0,
      },
      {
        key: "minPayoutCoins",
        label: "Min payout",
        suffix: "coins",
        step: 1,
        min: 1,
      },
      {
        key: "staleResultGraceMinutes",
        label: "Stale-result grace",
        suffix: "min",
        step: 1,
        min: 1,
      },
    ],
  },
];

function NumberField({
  label,
  value,
  onChange,
  error,
  prefix,
  suffix,
  step,
  min,
  hint,
  caption,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  hint?: string;
  caption?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {prefix}
          </span>
        )}
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "h-10 font-mono tabular-nums",
            prefix && "pl-7",
            suffix && "pr-14",
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {error ? (
        <span className="text-[11px] text-destructive">{error}</span>
      ) : caption ? (
        <span className="text-[11px] text-muted-foreground">{caption}</span>
      ) : hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function BettingParamsPanel() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ["admin-betting-config"],
    queryFn: getBettingConfig,
  });

  // Working copy — seeded from the server row on first load, then
  // mutated freely until Save. Discard restores from server.
  const [draft, setDraft] = useState<ConfigDraft | null>(null);

  useEffect(() => {
    if (config && !draft) setDraft(configToDraft(config));
    // Only auto-seed on first load — server refetches must not clobber
    // an operator's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const baseline = useMemo(
    () => (config ? configToDraft(config) : null),
    [config],
  );

  const dirty = useMemo(() => {
    if (!draft || !baseline) return false;
    return (Object.keys(draft) as FieldKey[]).some(
      (k) => draft[k] !== baseline[k],
    );
  }, [draft, baseline]);

  const errors = useMemo(
    () => (draft ? validate(draft) : {}),
    [draft],
  );
  const hasErrors = Object.keys(errors).length > 0;

  const patch = (key: FieldKey, value: string) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  const discard = () => {
    if (config) setDraft(configToDraft(config));
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Nothing to save");
      return updateBettingConfig(draftToConfig(draft));
    },
    onSuccess: async (fresh) => {
      toast.success("Saved — live for new events.");
      setDraft(configToDraft(fresh));
      await queryClient.invalidateQueries({
        queryKey: ["admin-betting-config"],
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Save failed");
    },
  });

  const updatedLabel = config?.updatedAt
    ? new Date(config.updatedAt).toLocaleString()
    : null;

  return (
    <section className="rounded-2xl border border-border/40 bg-card shadow-sm">
      <header className="border-b border-border/40 px-4 py-4 sm:px-6">
        <h2 className="font-heading text-lg font-semibold">
          Betting parameters
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Stake limits, settlement minimums, rake split, odds cap and
          betting-window bounds. Saving here applies to{" "}
          <span className="font-medium text-foreground">new events only</span>{" "}
          — live events keep the rules they started with.
        </p>
        {updatedLabel ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Last updated {updatedLabel}
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Using platform defaults — not yet edited.
          </p>
        )}
      </header>

      {isLoading || !draft ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6 px-4 py-5 sm:px-6">
          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </h3>
                {group.note && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                    {group.note}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.fields.map((f) => (
                  <NumberField
                    key={f.key}
                    label={f.label}
                    value={draft[f.key]}
                    onChange={(v) => patch(f.key, v)}
                    error={errors[f.key]}
                    prefix={f.prefix}
                    suffix={f.suffix}
                    step={f.step}
                    min={f.min}
                    hint={f.hint}
                    caption={f.caption ? f.caption(draft) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <footer className="flex flex-col gap-3 border-t border-border/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={discard}
            disabled={saveMutation.isPending}
          >
            Discard changes
          </Button>
        )}
        <Button
          type="button"
          size="default"
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || hasErrors || saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </footer>
    </section>
  );
}
