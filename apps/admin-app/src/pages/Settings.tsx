import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button, Input } from "@liverush/ui";
import { cn } from "@liverush/lib";

import {
  listCoinPacks,
  upsertCoinPack,
  deleteCoinPack,
  type AdminCoinPack,
} from "@/services/coinPacksService";

/**
 * Admin Settings — coin-pack catalogue.
 *
 * The IAP options the user-app shows on `/coins` are stored in the
 * `coin_packs` table (see migration `20260604_000001_ledger_rebuild.sql`).
 * Operators add / edit / delete / reorder them here. Save batches dirty
 * rows + new rows through `upsert_coin_pack` (one RPC per row, sequential)
 * and queued deletes through `delete_coin_pack`. Realtime on `coin_packs`
 * propagates the change to the user-app Coins page without a refresh.
 */

// Local working-copy row shape. `id` is null for newly-added rows
// (client-side draft id stashed in `draftId` for React keys); after
// Save the RPC returns the real UUID and the next refetch supplies
// it. `dirty` tracks whether the row needs an upsert call.
interface Draft {
  draftId: string;
  id: string | null;
  coins: string;
  priceDollars: string;
  sortOrder: number;
  isActive: boolean;
  dirty: boolean;
}

function packToDraft(p: AdminCoinPack): Draft {
  return {
    draftId: p.id,
    id: p.id,
    coins: String(p.coins),
    priceDollars: (p.priceDollarCents / 100).toFixed(2),
    sortOrder: p.sortOrder,
    isActive: p.isActive,
    dirty: false,
  };
}

function newDraft(sortOrder: number): Draft {
  return {
    draftId: `draft-${crypto.randomUUID()}`,
    id: null,
    coins: "",
    priceDollars: "",
    sortOrder,
    isActive: true,
    dirty: true,
  };
}

interface ValidationError {
  coins?: string;
  priceDollars?: string;
}

function validateDraft(d: Draft): ValidationError {
  const errors: ValidationError = {};
  const coins = Number.parseInt(d.coins, 10);
  if (!Number.isFinite(coins) || coins <= 0) {
    errors.coins = "Must be a positive integer";
  }
  const price = Number.parseFloat(d.priceDollars);
  if (!Number.isFinite(price) || price <= 0) {
    errors.priceDollars = "Must be > $0";
  }
  return errors;
}

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: packs, isLoading } = useQuery({
    queryKey: ["admin-coin-packs"],
    queryFn: listCoinPacks,
  });

  // Working copy — initialised from the server data on first load,
  // then mutated freely until Save. Discard restores from server.
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  useEffect(() => {
    if (packs && drafts.length === 0 && deletedIds.length === 0) {
      setDrafts(packs.map(packToDraft));
    }
    // Only auto-populate on first load — once the operator starts
    // editing we don't want server refetches to clobber their work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packs]);

  const dirty = useMemo(
    () => drafts.some((d) => d.dirty) || deletedIds.length > 0,
    [drafts, deletedIds],
  );

  const validation = useMemo(
    () => drafts.map((d) => validateDraft(d)),
    [drafts],
  );
  const hasErrors = useMemo(
    () => validation.some((v) => Object.keys(v).length > 0),
    [validation],
  );

  const patch = (draftId: string, fields: Partial<Draft>) => {
    setDrafts((rows) =>
      rows.map((r) =>
        r.draftId === draftId ? { ...r, ...fields, dirty: true } : r,
      ),
    );
  };

  const move = (draftId: string, dir: -1 | 1) => {
    setDrafts((rows) => {
      const idx = rows.findIndex((r) => r.draftId === draftId);
      if (idx < 0) return rows;
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= rows.length) return rows;
      const next = [...rows];
      const tmp = next[idx]!;
      next[idx] = next[targetIdx]!;
      next[targetIdx] = tmp;
      // Renumber sort_order across the table so the change persists
      // on Save; mark both swapped rows dirty.
      return next.map((r, i) => ({
        ...r,
        sortOrder: i + 1,
        dirty: r.dirty || i === idx || i === targetIdx,
      }));
    });
  };

  const addRow = () => {
    setDrafts((rows) => [
      ...rows,
      newDraft(rows.length + 1),
    ]);
  };

  const removeRow = (draftId: string) => {
    setDrafts((rows) => {
      const r = rows.find((row) => row.draftId === draftId);
      if (r?.id) setDeletedIds((ids) => [...ids, r.id!]);
      return rows
        .filter((row) => row.draftId !== draftId)
        .map((row, i) => ({ ...row, sortOrder: i + 1 }));
    });
  };

  const discard = () => {
    if (packs) setDrafts(packs.map(packToDraft));
    setDeletedIds([]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const upserts = drafts.filter((d) => d.dirty);
      for (const d of upserts) {
        await upsertCoinPack({
          id: d.id,
          coins: Number.parseInt(d.coins, 10),
          priceDollarCents: Math.round(
            Number.parseFloat(d.priceDollars) * 100,
          ),
          sortOrder: d.sortOrder,
          isActive: d.isActive,
        });
      }
      for (const id of deletedIds) {
        await deleteCoinPack(id);
      }
    },
    onSuccess: async () => {
      const upserts = drafts.filter((d) => d.dirty).length;
      const deletes = deletedIds.length;
      const total = upserts + deletes;
      toast.success(
        `${total} ${total === 1 ? "change" : "changes"} saved — live in user app.`,
      );
      setDeletedIds([]);
      // Refetch + re-seed drafts from server.
      await queryClient.invalidateQueries({ queryKey: ["admin-coin-packs"] });
      const fresh = await listCoinPacks();
      setDrafts(fresh.map(packToDraft));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Save failed");
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Coin-pack catalogue and other operator configuration.
        </p>
      </div>

      <section className="rounded-2xl border border-border/40 bg-card shadow-sm">
        <header className="border-b border-border/40 px-4 py-4 sm:px-6">
          <h2 className="font-heading text-lg font-semibold">Coin packs</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Top-up options shown on the user-app Get coins screen.
            Changes save instantly to all apps.
          </p>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {drafts.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                No coin packs yet. Add one to start.
              </p>
            ) : (
              drafts.map((d, idx) => {
                const errors = validation[idx] ?? {};
                const coinsNum = Number.parseInt(d.coins, 10);
                const priceNum = Number.parseFloat(d.priceDollars);
                const rate =
                  Number.isFinite(coinsNum) && coinsNum > 0
                    && Number.isFinite(priceNum) && priceNum > 0
                    ? priceNum / coinsNum
                    : null;
                return (
                  <div
                    key={d.draftId}
                    className={cn(
                      // items-start so every column lines up by its top edge
                      // even when one (Price) has the live "$0.X / coin" rate
                      // caption hanging below — with items-end that caption
                      // made the price column taller and pushed its label /
                      // input up out of line with Coins.
                      "grid gap-3 px-4 py-4 sm:grid-cols-[auto_1fr_1fr_auto_auto] sm:items-start sm:gap-4 sm:px-6",
                      !d.isActive && "opacity-60",
                    )}
                  >
                    {/* Reorder — up/down on every viewport. Drag-handle
                        deferred; up/down works on mobile too. */}
                    <div className="flex flex-row gap-1 sm:flex-col">
                      <button
                        type="button"
                        onClick={() => move(d.draftId, -1)}
                        disabled={idx === 0}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/40 hover:text-foreground disabled:opacity-30"
                        aria-label="Move up"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(d.draftId, 1)}
                        disabled={idx === drafts.length - 1}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/40 hover:text-foreground disabled:opacity-30"
                        aria-label="Move down"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Coins */}
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Coins
                      </span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={d.coins}
                        onChange={(e) =>
                          patch(d.draftId, { coins: e.target.value })
                        }
                        className="h-10 font-mono tabular-nums"
                        placeholder="100"
                      />
                      {errors.coins && (
                        <span className="text-[11px] text-destructive">
                          {errors.coins}
                        </span>
                      )}
                    </label>

                    {/* Price */}
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Price ($)
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.01}
                        value={d.priceDollars}
                        onChange={(e) =>
                          patch(d.draftId, { priceDollars: e.target.value })
                        }
                        className="h-10 font-mono tabular-nums"
                        placeholder="10.00"
                      />
                      {errors.priceDollars && (
                        <span className="text-[11px] text-destructive">
                          {errors.priceDollars}
                        </span>
                      )}
                      {rate != null && (
                        <span className="text-[11px] text-muted-foreground">
                          ${rate.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}
                          {" / coin"}
                        </span>
                      )}
                    </label>

                    {/* Active toggle — wrapped in the same label-spacer
                        column as the inputs so it lines up with the input
                        row under items-start (otherwise it'd hug the row
                        top, above the inputs). The spacer span carries
                        a non-breaking placeholder so its height matches
                        the real label spans next door. */}
                    <label className="flex flex-col gap-1 items-center justify-self-center text-muted-foreground sm:pb-0">
                      <span
                        aria-hidden="true"
                        className="hidden text-[11px] font-medium uppercase tracking-wide sm:inline"
                      >
                        &nbsp;
                      </span>
                      <span className="inline-flex h-10 items-center gap-2 text-xs font-medium">
                        <input
                          type="checkbox"
                          checked={d.isActive}
                          onChange={(e) =>
                            patch(d.draftId, { isActive: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-input"
                        />
                        Active
                      </span>
                    </label>

                    {/* Delete — same spacer pattern so the trash icon sits
                        on the input row, not above it. */}
                    <div className="flex flex-col gap-1 justify-self-end">
                      <span
                        aria-hidden="true"
                        className="hidden text-[11px] font-medium uppercase tracking-wide sm:inline"
                      >
                        &nbsp;
                      </span>
                      <button
                        type="button"
                        onClick={() => removeRow(d.draftId)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Delete pack"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        <footer className="flex flex-col gap-3 border-t border-border/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addRow}
            disabled={isLoading}
          >
            <Plus className="h-4 w-4" />
            Add pack
          </Button>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
          </div>
        </footer>
      </section>
    </div>
  );
}
