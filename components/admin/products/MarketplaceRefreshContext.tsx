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

export type QueueItemStatus = "queued" | "in_progress" | "done";

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
    if (outcome.ankorstore.status === "ok") {
      result.ankorsOutcome = { ok: true, archived: outcome.ankorstore.archived };
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
    if (outcome.ankorstore.status === "ok") {
      result.ankorsOutcome = { ok: true, archived: outcome.ankorstore.archived };
    } else {
      result.ankorsOutcome = { ok: false, kind: "error", message: outcome.ankorstore.message };
    }
  }

  return result;
}

const CONCURRENCY = 5;

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
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: "done", ...parsed } : i)),
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

  // Queue processor — fills up to CONCURRENCY parallel slots
  useEffect(() => {
    const freeSlots = CONCURRENCY - runningIdsRef.current.size;
    if (freeSlots <= 0) return;

    const queued = items.filter(
      (i) => i.status === "queued" && !runningIdsRef.current.has(i.id),
    );
    const batch = queued.slice(0, freeSlots);
    for (const item of batch) {
      processItem(item);
    }
  }, [items, processItem]);

  const runningCount = items.filter((i) => i.status === "in_progress").length;
  const queuedCount = items.filter((i) => i.status === "queued").length;
  const isAllFinished = items.length > 0 && runningCount === 0 && queuedCount === 0;

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
