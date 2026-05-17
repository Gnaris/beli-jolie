"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  MarketplaceRefreshOptions,
  MarketplaceRefreshOutcome,
} from "@/app/actions/admin/marketplace-refresh";
import type { MarketplacePublishOutcome } from "@/app/actions/admin/marketplace-publish";

export type QueueItemStatus = "queued" | "in_progress" | "awaiting_callback" | "done";

/**
 * "refresh" = renouveler un produit déjà publié (recrée côté marketplace).
 * "publish" = première mise en ligne ou update incrémental.
 * "resync" = renvoyer toutes les données sur le même id marketplace.
 */
export type QueueItemMode = "refresh" | "publish" | "resync";

export type MarketplaceTarget = "pfs" | "ankorstore";

export type TargetOutcome =
  | { ok: true; archived?: boolean; opId?: string; warning?: string }
  | { ok: false; kind: "not_found" | "error"; message: string };

export interface MarketplaceRefreshItem {
  id: string;
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  options: MarketplaceRefreshOptions;
  mode: QueueItemMode;
  marketplace: MarketplaceTarget;
  status: QueueItemStatus;
  localOutcome?: TargetOutcome;
  pfsOutcome?: TargetOutcome;
  ankorsOutcome?: TargetOutcome;
  // For Ankorstore items waiting on a callback (mode callback-only)
  ankorsOperationId?: string;
}

export interface MarketplaceRefreshEnqueueInput {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
  options: MarketplaceRefreshOptions;
  /** Default = "refresh". Use "publish" pour la première mise en ligne. */
  mode?: QueueItemMode;
  /** Marketplace cible — défaut "pfs" pour ne pas casser les appels existants. */
  marketplace?: MarketplaceTarget;
}

interface MarketplaceRefreshContextValue {
  items: MarketplaceRefreshItem[];
  enqueue: (inputs: MarketplaceRefreshEnqueueInput[]) => void;
  clear: () => void;
  stop: () => void;
  isAllFinished: boolean;
  runningCount: number;
  queuedCount: number;
}

const MarketplaceRefreshContext = createContext<MarketplaceRefreshContextValue | null>(null);

export function useMarketplaceRefreshQueue(): MarketplaceRefreshContextValue {
  const ctx = useContext(MarketplaceRefreshContext);
  if (!ctx) {
    throw new Error("useMarketplaceRefreshQueue must be used within <MarketplaceRefreshProvider>");
  }
  return ctx;
}

function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function hasError(item: MarketplaceRefreshItem): boolean {
  if (item.pfsOutcome && !item.pfsOutcome.ok) return true;
  if (item.ankorsOutcome && !item.ankorsOutcome.ok) return true;
  return false;
}

function outcomesFromServer(
  outcome: MarketplaceRefreshOutcome,
  marketplace: MarketplaceTarget,
): {
  localOutcome?: TargetOutcome;
  pfsOutcome?: TargetOutcome;
  ankorsOutcome?: TargetOutcome;
} {
  const result: ReturnType<typeof outcomesFromServer> = {};

  if (outcome.local.status === "ok") {
    result.localOutcome = { ok: true };
  }

  if (marketplace === "pfs" && outcome.pfs) {
    if (outcome.pfs.status === "ok") {
      result.pfsOutcome = { ok: true, archived: outcome.pfs.archived };
    } else if (outcome.pfs.status === "not_found") {
      result.pfsOutcome = { ok: false, kind: "not_found", message: outcome.pfs.message };
    } else {
      result.pfsOutcome = { ok: false, kind: "error", message: outcome.pfs.message };
    }
  }

  if (marketplace === "ankorstore" && outcome.ankorstore) {
    if (outcome.ankorstore.status === "queued") {
      // Callback-only — webhook will provide the final outcome
      result.ankorsOutcome = { ok: true, opId: outcome.ankorstore.operationId, warning: "queued" };
    } else if (outcome.ankorstore.status === "not_found") {
      result.ankorsOutcome = {
        ok: false,
        kind: "not_found",
        message: outcome.ankorstore.message,
      };
    } else {
      result.ankorsOutcome = { ok: false, kind: "error", message: outcome.ankorstore.message };
    }
  }

  return result;
}

function outcomesFromPublishServer(
  outcome: MarketplacePublishOutcome,
  marketplace: MarketplaceTarget,
): {
  pfsOutcome?: TargetOutcome;
  ankorsOutcome?: TargetOutcome;
} {
  const result: ReturnType<typeof outcomesFromPublishServer> = {};

  if (marketplace === "pfs" && outcome.pfs) {
    if (outcome.pfs.status === "ok") {
      result.pfsOutcome = { ok: true, archived: outcome.pfs.archived };
    } else {
      result.pfsOutcome = { ok: false, kind: "error", message: outcome.pfs.message };
    }
  }

  if (marketplace === "ankorstore" && outcome.ankorstore) {
    if (outcome.ankorstore.status === "queued") {
      // Callback-only — webhook will provide the final outcome
      result.ankorsOutcome = { ok: true, opId: outcome.ankorstore.operationId, warning: "queued" };
    } else if (outcome.ankorstore.status === "ok") {
      result.ankorsOutcome = { ok: true, archived: outcome.ankorstore.archived };
    } else {
      result.ankorsOutcome = { ok: false, kind: "error", message: outcome.ankorstore.message };
    }
  }

  return result;
}

const CONCURRENCY = 5;
// Ankorstore reste sérialisé (1 à la fois, in_progress + awaiting_callback) parce
// que leur API renvoie parfois deux fois le même operationId en parallèle —
// collisions PRIMARY KEY sur AnkorstoreOperation observées en prod le 17/05/26.
// En série on garde aussi un fil log clair pour retracer un éventuel doublon.
const ANKORSTORE_CONCURRENCY = 1;

export function MarketplaceRefreshProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<MarketplaceRefreshItem[]>([]);
  const runningIdsRef = useRef<Set<string>>(new Set());

  const enqueue = useCallback((inputs: MarketplaceRefreshEnqueueInput[]) => {
    if (inputs.length === 0) return;
    setItems((prev) => [
      ...prev,
      ...inputs.map((input) => ({
        id: uid(),
        productId: input.productId,
        reference: input.reference,
        productName: input.productName,
        firstImage: input.firstImage ?? null,
        options: input.options,
        mode: (input.mode ?? "refresh") as QueueItemMode,
        marketplace: (input.marketplace ?? "pfs") as MarketplaceTarget,
        status: "queued" as QueueItemStatus,
      })),
    ]);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const stop = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.status !== "queued"));
  }, []);

  // Process a single item via API route (not server action) for true parallelism
  const processItem = useCallback((item: MarketplaceRefreshItem) => {
    runningIdsRef.current.add(item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "in_progress" } : i)));

    (async () => {
      try {
        const base = item.marketplace === "ankorstore" ? "ankorstore" : "marketplace";
        const endpoint =
          item.mode === "publish"
            ? `/api/admin/${base}-publish`
            : item.mode === "resync"
              ? `/api/admin/${base}-resync`
              : `/api/admin/${base}-refresh`;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: item.productId, options: item.options }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const outcome = await res.json();
        const parsed =
          item.mode === "publish" || item.mode === "resync"
            ? outcomesFromPublishServer(outcome as MarketplacePublishOutcome, item.marketplace)
            : outcomesFromServer(outcome as MarketplaceRefreshOutcome, item.marketplace);
        // Callback-only mode: if the Ankorstore branch returned a queued outcome,
        // keep the item in "awaiting_callback" state — a polling loop below will
        // transition it to "done" once the webhook updates the local DB row.
        const ankorsOutcome = parsed.ankorsOutcome;
        const isQueued =
          item.marketplace === "ankorstore" &&
          ankorsOutcome?.ok === true &&
          ankorsOutcome.warning === "queued";
        const queuedOpId =
          isQueued && ankorsOutcome?.ok === true ? ankorsOutcome.opId : undefined;
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  status: isQueued ? "awaiting_callback" : "done",
                  ankorsOperationId: queuedOpId ?? i.ankorsOperationId,
                  ...parsed,
                }
              : i,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setItems((prev) =>
          prev.map((i) => {
            if (i.id !== item.id) return i;
            const errorOutcome: TargetOutcome = { ok: false, kind: "error", message };
            if (item.marketplace === "ankorstore") {
              return {
                ...i,
                status: "done",
                ankorsOutcome: item.options.ankorstore ? errorOutcome : i.ankorsOutcome,
              };
            }
            return {
              ...i,
              status: "done",
              pfsOutcome: item.options.pfs ? errorOutcome : i.pfsOutcome,
            };
          }),
        );
      } finally {
        runningIdsRef.current.delete(item.id);
      }
    })();
  }, []);

  // Queue processor — fills up to CONCURRENCY parallel slots, but Ankorstore
  // items are throttled separately (ANKORSTORE_CONCURRENCY) and count their
  // awaiting_callback state too so that we never have two in flight.
  useEffect(() => {
    const freeSlots = CONCURRENCY - runningIdsRef.current.size;
    if (freeSlots <= 0) return;

    const ankorsInFlight = items.filter(
      (i) =>
        i.marketplace === "ankorstore" &&
        (i.status === "in_progress" || i.status === "awaiting_callback"),
    ).length;
    let ankorsBudget = Math.max(0, ANKORSTORE_CONCURRENCY - ankorsInFlight);

    const queued = items.filter(
      (i) => i.status === "queued" && !runningIdsRef.current.has(i.id),
    );

    const batch: MarketplaceRefreshItem[] = [];
    for (const item of queued) {
      if (batch.length >= freeSlots) break;
      if (item.marketplace === "ankorstore") {
        if (ankorsBudget <= 0) continue;
        ankorsBudget--;
      }
      batch.push(item);
    }
    for (const item of batch) {
      processItem(item);
    }
  }, [items, processItem]);

  // ── Polling loop for Ankorstore items in "awaiting_callback" state ──
  // Polls the local DB every 3s. The webhook updates the row when Ankorstore
  // confirms; this loop picks up the change and transitions the item to "done".
  useEffect(() => {
    const awaitingItems = items.filter(
      (i) => i.status === "awaiting_callback" && i.marketplace === "ankorstore",
    );
    if (awaitingItems.length === 0) return;

    let cancelled = false;
    const productIds = Array.from(new Set(awaitingItems.map((i) => i.productId)));

    const tick = async () => {
      try {
        const params = new URLSearchParams({ productIds: productIds.join(",") });
        const res = await fetch(`/api/admin/ankorstore-operations?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as Record<
          string,
          {
            latest: {
              id: string;
              type: string;
              status: string;
              errorMessage: string | null;
              completedAt: string | null;
            } | null;
          }
        >;
        if (cancelled) return;

        setItems((prev) =>
          prev.map((i) => {
            if (i.status !== "awaiting_callback" || i.marketplace !== "ankorstore") return i;
            const latest = data[i.productId]?.latest;
            if (!latest) return i;
            // Only transition when the latest op for this product is terminal.
            // (REFRESH chains DELETE_OLD → CREATE_NEW automatically server-side;
            // we wait until the LAST phase resolves.)
            if (latest.status === "PENDING") return i;
            if (latest.status === "SUCCEEDED" || latest.status === "PARTIALLY_FAILED") {
              return {
                ...i,
                status: "done",
                ankorsOutcome: {
                  ok: true,
                  archived: false,
                  warning:
                    latest.status === "PARTIALLY_FAILED"
                      ? "Succès partiel — vérifiez le tableau de bord Ankorstore."
                      : undefined,
                },
              };
            }
            if (latest.status === "FAILED") {
              return {
                ...i,
                status: "done",
                ankorsOutcome: {
                  ok: false,
                  kind: "error",
                  message: latest.errorMessage ?? "Opération échouée sur Ankorstore",
                },
              };
            }
            return i;
          }),
        );
      } catch {
        /* Silent — next tick will retry. */
      }
    };

    // First tick immediately, then every 3s
    void tick();
    const interval = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [items]);

  const runningCount = items.filter((i) => i.status === "in_progress").length;
  const awaitingCount = items.filter((i) => i.status === "awaiting_callback").length;
  const queuedCount = items.filter((i) => i.status === "queued").length;
  const isAllFinished =
    items.length > 0 && runningCount === 0 && queuedCount === 0 && awaitingCount === 0;

  const value: MarketplaceRefreshContextValue = {
    items,
    enqueue,
    clear,
    stop,
    isAllFinished,
    runningCount,
    queuedCount,
  };

  return (
    <MarketplaceRefreshContext.Provider value={value}>
      {children}
    </MarketplaceRefreshContext.Provider>
  );
}
