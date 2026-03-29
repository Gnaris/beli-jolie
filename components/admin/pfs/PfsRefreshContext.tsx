"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PfsRefreshItem {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

interface PfsRefreshContextValue {
  queue: PfsRefreshItem[];
  enqueue: (productId: string, productName: string, reference: string) => void;
  enqueueBulk: (items: { productId: string; productName: string; reference: string }[]) => void;
  isRefreshing: (productId: string) => boolean;
  clearCompleted: () => void;
}

const PfsRefreshContext = createContext<PfsRefreshContextValue | null>(null);

export function usePfsRefresh(): PfsRefreshContextValue | null {
  return useContext(PfsRefreshContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const MAX_CONCURRENT = 3;

export function PfsRefreshProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<PfsRefreshItem[]>([]);
  const activeCountRef = useRef(0);
  const queueRef = useRef<PfsRefreshItem[]>([]);

  // Keep queueRef in sync
  queueRef.current = queue;

  const processOne = useCallback(async (item: PfsRefreshItem) => {
    // Mark as in_progress
    setQueue((prev) =>
      prev.map((q) =>
        q.productId === item.productId
          ? { ...q, status: "in_progress" as const, step: "Initialisation..." }
          : q,
      ),
    );

    try {
      const res = await fetch("/api/admin/pfs-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: item.productId }),
      });

      const data = await res.json();

      setQueue((prev) =>
        prev.map((q) =>
          q.productId === item.productId
            ? {
                ...q,
                status: data.success ? ("success" as const) : ("error" as const),
                step: data.success ? "Terminé" : undefined,
                error: data.error,
              }
            : q,
        ),
      );
    } catch (err) {
      setQueue((prev) =>
        prev.map((q) =>
          q.productId === item.productId
            ? {
                ...q,
                status: "error" as const,
                error: err instanceof Error ? err.message : "Erreur inconnue",
              }
            : q,
        ),
      );
    }
  }, []);

  const processQueue = useCallback(async () => {
    while (true) {
      if (activeCountRef.current >= MAX_CONCURRENT) return;

      const next = queueRef.current.find((item) => item.status === "queued");
      if (!next) return;

      // Optimistically mark as in_progress so the next loop iteration skips it
      setQueue((prev) =>
        prev.map((q) =>
          q.productId === next.productId
            ? { ...q, status: "in_progress" as const, step: "Initialisation..." }
            : q,
        ),
      );
      // Update ref immediately to avoid double-pickup
      queueRef.current = queueRef.current.map((q) =>
        q.productId === next.productId ? { ...q, status: "in_progress" as const } : q,
      );

      activeCountRef.current++;
      processOne(next).finally(() => {
        activeCountRef.current--;
        setTimeout(() => processQueue(), 200);
      });
    }
  }, [processOne]);

  const enqueue = useCallback(
    (productId: string, productName: string, reference: string) => {
      // Don't add if already in queue and not completed
      const existing = queueRef.current.find(
        (item) => item.productId === productId && (item.status === "queued" || item.status === "in_progress"),
      );
      if (existing) return;

      const newItem: PfsRefreshItem = {
        productId,
        productName,
        reference,
        status: "queued",
      };

      setQueue((prev) => {
        const filtered = prev.filter(
          (item) => item.productId !== productId || (item.status !== "success" && item.status !== "error"),
        );
        return [...filtered, newItem];
      });

      setTimeout(() => processQueue(), 100);
    },
    [processQueue],
  );

  const enqueueBulk = useCallback(
    (items: { productId: string; productName: string; reference: string }[]) => {
      setQueue((prev) => {
        let updated = [...prev];
        for (const item of items) {
          const alreadyActive = updated.some(
            (q) => q.productId === item.productId && (q.status === "queued" || q.status === "in_progress"),
          );
          if (alreadyActive) continue;

          // Remove previous completed entry
          updated = updated.filter(
            (q) => q.productId !== item.productId || (q.status !== "success" && q.status !== "error"),
          );
          updated.push({ ...item, status: "queued" });
        }
        return updated;
      });

      setTimeout(() => processQueue(), 100);
    },
    [processQueue],
  );

  const isRefreshing = useCallback(
    (productId: string) => {
      return queue.some(
        (item) => item.productId === productId && (item.status === "queued" || item.status === "in_progress"),
      );
    },
    [queue],
  );

  const clearCompleted = useCallback(() => {
    setQueue((prev) => prev.filter((item) => item.status === "queued" || item.status === "in_progress"));
  }, []);

  return (
    <PfsRefreshContext.Provider value={{ queue, enqueue, enqueueBulk, isRefreshing, clearCompleted }}>
      {children}
    </PfsRefreshContext.Provider>
  );
}
