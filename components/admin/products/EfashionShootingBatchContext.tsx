"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type EfashionShootingMode = "PUBLISH" | "REFRESH";

export interface EfashionShootingItemView {
  id: string;
  productId: string;
  mode: EfashionShootingMode;
  addedAt: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  missing: string[];
  noEligibleVariants: boolean;
  productDeleted: boolean;
}

interface EfashionShootingBatchState {
  items: EfashionShootingItemView[];
  hasBlockingIssue: boolean;
}

interface ContextValue {
  items: EfashionShootingItemView[];
  hasBlockingIssue: boolean;
  isCommitting: boolean;
  addProduct: (productId: string, mode: EfashionShootingMode) => Promise<void>;
  removeProduct: (productId: string) => Promise<void>;
  commit: () => Promise<{ ok: boolean; message: string }>;
  refresh: () => Promise<void>;
}

const EfashionShootingBatchContext = createContext<ContextValue | null>(null);

export function useEfashionShootingBatch(): ContextValue {
  const ctx = useContext(EfashionShootingBatchContext);
  if (!ctx) {
    throw new Error(
      "useEfashionShootingBatch must be used within <EfashionShootingBatchProvider>",
    );
  }
  return ctx;
}

const POLL_MS = 5_000;

export function EfashionShootingBatchProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EfashionShootingBatchState>({
    items: [],
    hasBlockingIssue: false,
  });
  const [isCommitting, setIsCommitting] = useState(false);
  const inFlightRef = useRef<boolean>(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/admin/efashion-shooting-batch", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as EfashionShootingBatchState;
      setState({
        items: Array.isArray(data.items) ? data.items : [],
        hasBlockingIssue: Boolean(data.hasBlockingIssue),
      });
    } catch {
      // ignored — next tick retries
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const addProduct = useCallback(
    async (productId: string, mode: EfashionShootingMode) => {
      try {
        await fetch("/api/admin/efashion-shooting-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId, mode }),
        });
      } finally {
        void refresh();
      }
    },
    [refresh],
  );

  const removeProduct = useCallback(
    async (productId: string) => {
      try {
        await fetch("/api/admin/efashion-shooting-batch", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        });
      } finally {
        void refresh();
      }
    },
    [refresh],
  );

  const commit = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    setIsCommitting(true);
    try {
      const res = await fetch("/api/admin/efashion-shooting-batch/commit", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        publishCount?: number;
        refreshCount?: number;
      };
      if (!res.ok || !data.success) {
        return { ok: false, message: data.error ?? "Erreur inconnue." };
      }
      const parts: string[] = [];
      if ((data.publishCount ?? 0) > 0) parts.push(`${data.publishCount} publication(s)`);
      if ((data.refreshCount ?? 0) > 0) parts.push(`${data.refreshCount} rafraîchissement(s)`);
      return {
        ok: true,
        message: `Shooting envoyé à eFashion — ${parts.join(" + ")} en cours.`,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    } finally {
      setIsCommitting(false);
      void refresh();
    }
  }, [refresh]);

  const value: ContextValue = {
    items: state.items,
    hasBlockingIssue: state.hasBlockingIssue,
    isCommitting,
    addProduct,
    removeProduct,
    commit,
    refresh,
  };

  return (
    <EfashionShootingBatchContext.Provider value={value}>
      {children}
    </EfashionShootingBatchContext.Provider>
  );
}
