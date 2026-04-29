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

/** "refresh" = renouveler un produit déjà publié. "publish" = première mise en ligne. */
export type QueueItemMode = "refresh" | "publish";

export type TargetOutcome =
  | { ok: true; archived?: boolean; opId?: string; warning?: string }
  | { ok: false; kind: "not_found" | "error"; message: string };

export interface PfsRefreshItem {
  id: string;
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  options: MarketplaceRefreshOptions;
  mode: QueueItemMode;
  status: QueueItemStatus;
  localOutcome?: TargetOutcome;
  pfsOutcome?: TargetOutcome;
  ankorstoreOutcome?: TargetOutcome;
}

export interface PfsRefreshEnqueueInput {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
  options: MarketplaceRefreshOptions;
  /** Default = "refresh". Use "publish" pour la première mise en ligne. */
  mode?: QueueItemMode;
}

interface PfsRefreshContextValue {
  items: PfsRefreshItem[];
  enqueue: (inputs: PfsRefreshEnqueueInput[]) => void;
  clear: () => void;
  stop: () => void;
  isAllFinished: boolean;
  runningCount: number;
  queuedCount: number;
}

const PfsRefreshContext = createContext<PfsRefreshContextValue | null>(null);

export function usePfsRefreshQueue(): PfsRefreshContextValue {
  const ctx = useContext(PfsRefreshContext);
  if (!ctx) throw new Error("usePfsRefreshQueue must be used within <PfsRefreshProvider>");
  return ctx;
}

function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function hasError(item: PfsRefreshItem): boolean {
  if (item.pfsOutcome && !item.pfsOutcome.ok) return true;
  if (item.ankorstoreOutcome && !item.ankorstoreOutcome.ok) return true;
  return false;
}

function outcomesFromServer(outcome: MarketplaceRefreshOutcome): {
  localOutcome?: TargetOutcome;
  pfsOutcome?: TargetOutcome;
  ankorstoreOutcome?: TargetOutcome;
} {
  const result: ReturnType<typeof outcomesFromServer> = {};

  if (outcome.local.status === "ok") {
    result.localOutcome = { ok: true };
  }

  if (outcome.pfs) {
    if (outcome.pfs.status === "ok") {
      result.pfsOutcome = { ok: true, archived: outcome.pfs.archived };
    } else if (outcome.pfs.status === "not_found") {
      result.pfsOutcome = { ok: false, kind: "not_found", message: outcome.pfs.message };
    } else {
      result.pfsOutcome = { ok: false, kind: "error", message: outcome.pfs.message };
    }
  }

  if (outcome.ankorstore) {
    if (outcome.ankorstore.status === "ok") {
      result.ankorstoreOutcome = {
        ok: true,
        opId: outcome.ankorstore.opId,
        warning: outcome.ankorstore.warning,
      };
    } else if (outcome.ankorstore.status === "not_found") {
      result.ankorstoreOutcome = { ok: false, kind: "not_found", message: outcome.ankorstore.message };
    } else {
      result.ankorstoreOutcome = { ok: false, kind: "error", message: outcome.ankorstore.message };
    }
  }

  return result;
}

function outcomesFromPublishServer(outcome: MarketplacePublishOutcome): {
  pfsOutcome?: TargetOutcome;
  ankorstoreOutcome?: TargetOutcome;
} {
  const result: ReturnType<typeof outcomesFromPublishServer> = {};

  if (outcome.pfs) {
    if (outcome.pfs.status === "ok") {
      result.pfsOutcome = { ok: true, archived: outcome.pfs.archived };
    } else {
      result.pfsOutcome = { ok: false, kind: "error", message: outcome.pfs.message };
    }
  }

  if (outcome.ankorstore) {
    if (outcome.ankorstore.status === "ok") {
      result.ankorstoreOutcome = {
        ok: true,
        opId: outcome.ankorstore.opId,
        warning: outcome.ankorstore.warning,
      };
    } else {
      result.ankorstoreOutcome = { ok: false, kind: "error", message: outcome.ankorstore.message };
    }
  }

  return result;
}

const CONCURRENCY = 5;

export function PfsRefreshProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<PfsRefreshItem[]>([]);
  const runningIdsRef = useRef<Set<string>>(new Set());

  const enqueue = useCallback((inputs: PfsRefreshEnqueueInput[]) => {
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
  const processItem = useCallback((item: PfsRefreshItem) => {
    runningIdsRef.current.add(item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "in_progress" } : i)));

    (async () => {
      try {
        const endpoint =
          item.mode === "publish"
            ? "/api/admin/marketplace-publish"
            : "/api/admin/marketplace-refresh";
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
          item.mode === "publish"
            ? outcomesFromPublishServer(outcome as MarketplacePublishOutcome)
            : outcomesFromServer(outcome as MarketplaceRefreshOutcome);
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: "done", ...parsed } : i)),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  status: "done",
                  pfsOutcome: item.options.pfs
                    ? { ok: false, kind: "error", message }
                    : i.pfsOutcome,
                  ankorstoreOutcome: item.options.ankorstore
                    ? { ok: false, kind: "error", message }
                    : i.ankorstoreOutcome,
                }
              : i,
          ),
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

  const value: PfsRefreshContextValue = {
    items,
    enqueue,
    clear,
    stop,
    isAllFinished,
    runningCount,
    queuedCount,
  };

  return <PfsRefreshContext.Provider value={value}>{children}</PfsRefreshContext.Provider>;
}
