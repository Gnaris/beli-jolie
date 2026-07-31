"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMarketplaceRefreshQueue } from "./MarketplaceRefreshContext";

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
  clearAll: () => Promise<{ ok: boolean; removedCount: number }>;
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

const POLL_ACTIVE_MS = 5_000;
const POLL_IDLE_MS = 20_000;

export function EfashionShootingBatchProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EfashionShootingBatchState>({
    items: [],
    hasBlockingIssue: false,
  });
  const [isCommitting, setIsCommitting] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const inFlightRef = useRef<boolean>(false);
  // Le context marketplace est monté PLUS HAUT (voir app/(admin)/layout.tsx) —
  // on l'utilise pour forcer un poll immédiat de la file après un commit.
  // Sans ça, les MarketplaceRefreshJob EFASHION créés par le server action
  // ne remontent qu'au prochain tick (2 s en actif, 10 s en idle) et pendant
  // cet intervalle : (1) le badge marketplace repasse en rouge « hors ligne »
  // parce que le context ne voit aucun job en cours ; (2) sur un produit pas
  // encore lié (PUBLISH), le bouton « Publier » redevient cliquable et un
  // double clic déclenche un second push concurrent.
  const marketplaceQueue = useMarketplaceRefreshQueue();

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
    if (typeof document === "undefined") return;
    const update = () => setIsVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (isVisible) void refresh();
  }, [isVisible, refresh]);

  useEffect(() => {
    if (!isVisible) return;
    const delay = state.items.length > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const interval = setInterval(() => void refresh(), delay);
    return () => clearInterval(interval);
  }, [state.items.length, isVisible, refresh]);

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

  const clearAll = useCallback(async (): Promise<{ ok: boolean; removedCount: number }> => {
    try {
      const res = await fetch("/api/admin/efashion-shooting-batch/clear", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        removedCount?: number;
      };
      if (!res.ok || !data.success) {
        return { ok: false, removedCount: 0 };
      }
      return { ok: true, removedCount: data.removedCount ?? 0 };
    } catch {
      return { ok: false, removedCount: 0 };
    } finally {
      void refresh();
    }
  }, [refresh]);

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
      // Force le context marketplace à re-sonder tout de suite : les jobs
      // EFASHION IN_PROGRESS viennent d'être créés côté serveur, on veut
      // qu'ils apparaissent immédiatement dans le widget pour verrouiller
      // les badges et bloquer un éventuel double-clic sur « Publier ».
      void marketplaceQueue.refetch();
    }
  }, [refresh, marketplaceQueue]);

  const value: ContextValue = {
    items: state.items,
    hasBlockingIssue: state.hasBlockingIssue,
    isCommitting,
    addProduct,
    removeProduct,
    clearAll,
    commit,
    refresh,
  };

  return (
    <EfashionShootingBatchContext.Provider value={value}>
      {children}
    </EfashionShootingBatchContext.Provider>
  );
}
