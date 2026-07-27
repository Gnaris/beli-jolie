"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { MarketplaceRefreshOptions } from "@/app/actions/admin/marketplace-refresh";
import { useToast } from "@/components/ui/Toast";

export type QueueItemStatus = "queued" | "in_progress" | "awaiting_callback" | "done";

/**
 * "refresh" = renouveler un produit déjà publié (recrée côté marketplace).
 * "publish" = première mise en ligne ou update incrémental.
 * "resync"  = renvoyer toutes les données sur le même id marketplace.
 */
export type QueueItemMode = "refresh" | "publish" | "resync";

export type MarketplaceTarget = "pfs" | "ankorstore" | "efashion" | "faire";

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
  efashionOutcome?: TargetOutcome;
  faireOutcome?: TargetOutcome;
  ankorsOperationId?: string;
  /** ISO date. Présent quand le job attend une heure de départ future (étalement). */
  scheduledFor?: string;
  completedAt?: string;
}

export interface MarketplaceRefreshEnqueueInput {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
  options: MarketplaceRefreshOptions;
  /** Default = "refresh". */
  mode?: QueueItemMode;
  /** Marketplace cible — défaut "pfs". */
  marketplace?: MarketplaceTarget;
  /**
   * Optionnel : actions ciblées produites par le tooltip « PFS Verify » (envoi
   * granulaire par champ). Quand présent, le worker exécute
   * `applyPfsVerifyActionsCore` au lieu de la sync marketplace standard.
   * `marketplace` doit être `"pfs"` dans ce cas.
   */
  verifyActions?: { key: string; direction: "push" | "pull" }[];
}

export interface EnqueueMeta {
  /** Étalement du lot en ms. 0 ou absent = tous les produits partent en même temps. */
  intervalMs?: number;
}

interface MarketplaceRefreshContextValue {
  items: MarketplaceRefreshItem[];
  enqueue: (inputs: MarketplaceRefreshEnqueueInput[], meta?: EnqueueMeta) => void;
  clear: () => void;
  /** Sans argument : arrête tous les queued. Avec `mode` : ne stoppe que
   *  les queued de ce mode (permet d'arrêter uniquement les rafraîchissements
   *  sans toucher aux modifications). */
  stop: (mode?: QueueItemMode) => void;
  isAllFinished: boolean;
  runningCount: number;
  queuedCount: number;
  /** productIds avec au moins un item actif (queued, in_progress, awaiting_callback). */
  inFlightProductIds: Set<string>;
}

export function isItemActive(item: MarketplaceRefreshItem): boolean {
  return (
    item.status === "queued" ||
    item.status === "in_progress" ||
    item.status === "awaiting_callback"
  );
}

export function hasError(item: MarketplaceRefreshItem): boolean {
  if (item.pfsOutcome && !item.pfsOutcome.ok) return true;
  if (item.ankorsOutcome && !item.ankorsOutcome.ok) return true;
  if (item.efashionOutcome && !item.efashionOutcome.ok) return true;
  if (item.faireOutcome && !item.faireOutcome.ok) return true;
  return false;
}

const MarketplaceRefreshContext = createContext<MarketplaceRefreshContextValue | null>(null);

export function useMarketplaceRefreshQueue(): MarketplaceRefreshContextValue {
  const ctx = useContext(MarketplaceRefreshContext);
  if (!ctx) {
    throw new Error("useMarketplaceRefreshQueue must be used within <MarketplaceRefreshProvider>");
  }
  return ctx;
}

/**
 * Cadence du polling : 2s tant qu'il reste des items actifs (queued / in_progress /
 * awaiting_callback), 10s en idle pour capter les changements venant d'un autre
 * onglet ou d'un push depuis une autre fenêtre admin.
 */
const POLL_ACTIVE_MS = 2_000;
const POLL_IDLE_MS = 10_000;

export function MarketplaceRefreshProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<MarketplaceRefreshItem[]>([]);
  const [isVisible, setIsVisible] = useState(true);
  const router = useRouter();
  const toast = useToast();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDoneCountRef = useRef<number>(0);
  const inFlightFetchRef = useRef<boolean>(false);

  // ── Poll de la file côté serveur ──────────────────────────────────
  const pollOnce = useCallback(async () => {
    if (inFlightFetchRef.current) return;
    inFlightFetchRef.current = true;
    try {
      const res = await fetch("/api/admin/marketplace-queue", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: MarketplaceRefreshItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      // Réseau coupé / serveur indisponible : prochain tick retentera
    } finally {
      inFlightFetchRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Premier poll immédiat au montage
    void pollOnce();
  }, [pollOnce]);

  // Suivi de la visibilité de l'onglet — quand l'admin change d'onglet ou
  // minimise la fenêtre, on coupe le polling pour ne pas saturer le réseau
  // ni la batterie.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  // Re-poll immédiat quand l'onglet redevient visible : capte les changements
  // survenus pendant que la page était en arrière-plan.
  useEffect(() => {
    if (isVisible) void pollOnce();
  }, [isVisible, pollOnce]);

  // Polling adaptatif : 2s si du travail tourne, 10s sinon. Coupé si caché.
  const hasActive = items.some(isItemActive);
  useEffect(() => {
    if (!isVisible) return;
    const delay = hasActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const interval = setInterval(() => {
      void pollOnce();
    }, delay);
    return () => clearInterval(interval);
  }, [hasActive, isVisible, pollOnce]);

  // ── Actions : enqueue / clear / stop ──────────────────────────────
  const enqueue = useCallback(
    (inputs: MarketplaceRefreshEnqueueInput[], meta?: EnqueueMeta) => {
      if (inputs.length === 0) return;
      const intervalMs =
        meta?.intervalMs && Number.isFinite(meta.intervalMs) && meta.intervalMs > 0
          ? meta.intervalMs
          : 0;
      void (async () => {
        try {
          const res = await fetch("/api/admin/marketplace-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: inputs, intervalMs }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              items: MarketplaceRefreshItem[];
              skipped?: number;
              skippedByMarketplace?: Record<string, number>;
            };
            // Update optimiste à partir de la réponse immédiate, puis re-poll
            if (Array.isArray(data.items) && data.items.length > 0) {
              setItems((prev) => {
                const existingIds = new Set(prev.map((i) => i.id));
                const fresh = data.items.filter((i) => !existingIds.has(i.id));
                return [...prev, ...fresh];
              });
            }
            // Feedback quand des items ont été sautés parce que le marketplace
            // est désactivé pour ce produit dans la fiche produit.
            if (typeof data.skipped === "number" && data.skipped > 0) {
              const parts: string[] = [];
              const by = data.skippedByMarketplace ?? {};
              if (by.pfs) parts.push(`${by.pfs} PFS`);
              if (by.ankorstore) parts.push(`${by.ankorstore} Ankorstore`);
              if (by.efashion) parts.push(`${by.efashion} eFashion`);
              if (by.faire) parts.push(`${by.faire} Faire`);
              const detail = parts.join(" · ");
              const accepted = data.items?.length ?? 0;
              toast.warning(
                accepted > 0
                  ? `${accepted} envoi(s) lancé(s), ${data.skipped} sauté(s)`
                  : `${data.skipped} envoi(s) sauté(s)`,
                detail
                  ? `Marketplace désactivée pour ces produits : ${detail}. Réactivez depuis la fiche produit.`
                  : "Marketplace désactivée pour ces produits.",
              );
            }
          }
        } catch {
          // ignoré — le prochain poll réconciliera
        } finally {
          void pollOnce();
        }
      })();
    },
    [pollOnce],
  );

  const clear = useCallback(() => {
    void (async () => {
      try {
        await fetch("/api/admin/marketplace-queue/clear", { method: "POST" });
      } catch {
        // ignored
      } finally {
        void pollOnce();
      }
    })();
  }, [pollOnce]);

  const stop = useCallback(
    (mode?: QueueItemMode) => {
      void (async () => {
        try {
          await fetch("/api/admin/marketplace-queue/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mode ? { mode } : {}),
          });
        } catch {
          // ignored
        } finally {
          void pollOnce();
        }
      })();
    },
    [pollOnce],
  );

  // ── Refresh RSC quand des items basculent en "done" ───────────────
  // Comme avant : on rafraîchit les données serveur (badges marketplace,
  // date du dernier rafraîchissement…) sans recharger toute la page.
  const doneCount = items.filter((i) => i.status === "done").length;
  useEffect(() => {
    if (doneCount > lastDoneCountRef.current) {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        router.refresh();
        refreshTimerRef.current = null;
      }, 800);
    }
    lastDoneCountRef.current = doneCount;
  }, [doneCount, router]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  // ── Valeurs dérivées exposées au widget et aux pages admin ────────
  const runningCount = items.filter((i) => i.status === "in_progress").length;
  const awaitingCount = items.filter((i) => i.status === "awaiting_callback").length;
  const queuedCount = items.filter((i) => i.status === "queued").length;
  const isAllFinished =
    items.length > 0 && runningCount === 0 && queuedCount === 0 && awaitingCount === 0;

  const inFlightProductIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (isItemActive(item)) set.add(item.productId);
    }
    return set;
  }, [items]);

  const value: MarketplaceRefreshContextValue = {
    items,
    enqueue,
    clear,
    stop,
    isAllFinished,
    runningCount,
    queuedCount,
    inFlightProductIds,
  };

  return (
    <MarketplaceRefreshContext.Provider value={value}>
      {children}
    </MarketplaceRefreshContext.Provider>
  );
}
