"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnkorstoreRefreshItem {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

interface AnkorstoreRefreshContextValue {
  queue: AnkorstoreRefreshItem[];
  enqueue: (productId: string, productName: string, reference: string) => void;
  isRefreshing: (productId: string) => boolean;
  clearCompleted: () => void;
  cancelQueued: () => void;
}

const AnkorstoreRefreshContext = createContext<AnkorstoreRefreshContextValue | null>(null);

export function useAnkorstoreRefresh(): AnkorstoreRefreshContextValue | null {
  return useContext(AnkorstoreRefreshContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const MAX_CONCURRENT = 1; // Ankorstore ops are slower (polling), limit to 1

export function AnkorstoreRefreshProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<AnkorstoreRefreshItem[]>([]);
  const activeCountRef = useRef(0);
  const queueRef = useRef<AnkorstoreRefreshItem[]>([]);

  // Keep queueRef in sync
  queueRef.current = queue;

  const processOne = useCallback(async (item: AnkorstoreRefreshItem) => {
    setQueue((prev) =>
      prev.map((q) =>
        q.productId === item.productId
          ? { ...q, status: "in_progress" as const, step: "Initialisation..." }
          : q,
      ),
    );

    try {
      const res = await fetch("/api/admin/ankorstore-refresh", {
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

      setQueue((prev) =>
        prev.map((q) =>
          q.productId === next.productId
            ? { ...q, status: "in_progress" as const, step: "Initialisation..." }
            : q,
        ),
      );
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
      const existing = queueRef.current.find(
        (item) => item.productId === productId && (item.status === "queued" || item.status === "in_progress"),
      );
      if (existing) return;

      const newItem: AnkorstoreRefreshItem = {
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

  const cancelQueued = useCallback(() => {
    setQueue((prev) => prev.filter((item) => item.status !== "queued"));
  }, []);

  return (
    <AnkorstoreRefreshContext.Provider value={{ queue, enqueue, isRefreshing, clearCompleted, cancelQueued }}>
      {children}
    </AnkorstoreRefreshContext.Provider>
  );
}
