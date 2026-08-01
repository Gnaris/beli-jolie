"use client";

/**
 * File de jobs de liaison marketplace, client-side.
 * Permet à l'admin de continuer à naviguer pendant qu'une liaison marketplace
 * (PFS/Ankorstore/eFashion/Faire) tourne en arrière-plan — le résultat s'affiche
 * dans le widget flottant `MarketplaceLinkWidget`.
 *
 * Le state est purement client (pas de persistance BDD) : un refresh page
 * enlève les jobs du widget, mais la server action côté serveur continue
 * jusqu'à son terme.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type LinkJobStatus = "in_progress" | "done" | "error";

export interface LinkJob {
  id: string;
  marketplace: "pfs" | "ankorstore" | "efashion" | "faire";
  productId: string;
  productName: string;
  reference: string;
  productImage: string | null;
  status: LinkJobStatus;
  error?: string;
  linkedCount?: number;
  /** Couleurs BJ créées côté marketplace pendant la liaison. */
  createdCount?: number;
  /** Variantes orphelines supprimées côté marketplace pendant la liaison. */
  deletedCount?: number;
  /** Variantes marketplace importées en ProductColor BJ pendant la liaison. */
  importedCount?: number;
  startedAt: number;
  doneAt?: number;
}

export interface EnqueueLinkJobInput {
  marketplace: LinkJob["marketplace"];
  productId: string;
  productName: string;
  reference: string;
  productImage: string | null;
}

export type LinkJobExecutor = () => Promise<{
  success: boolean;
  error?: string;
  linked?: number;
  autoCreatedOnMarketplace?: number;
  deletedOnMarketplace?: number;
  importedFromMarketplace?: number;
}>;

interface Value {
  jobs: LinkJob[];
  activeCount: number;
  hasActiveJobForProduct: (productId: string, marketplace: LinkJob["marketplace"]) => boolean;
  enqueueLinkJob: (input: EnqueueLinkJobInput, executor: LinkJobExecutor) => string;
  dismissJob: (id: string) => void;
  clearFinished: () => void;
}

const Ctx = createContext<Value | null>(null);

export function MarketplaceLinkProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<LinkJob[]>([]);

  const enqueueLinkJob = useCallback((input: EnqueueLinkJobInput, executor: LinkJobExecutor) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const startedAt = Date.now();
    setJobs((prev) => [...prev, { ...input, id, status: "in_progress", startedAt }]);

    (async () => {
      try {
        const res = await executor();
        setJobs((prev) =>
          prev.map((j) =>
            j.id === id
              ? {
                  ...j,
                  status: res.success ? "done" : "error",
                  error: res.success ? undefined : res.error ?? "Erreur inconnue.",
                  linkedCount: res.linked,
                  createdCount: res.autoCreatedOnMarketplace,
                  deletedCount: res.deletedOnMarketplace,
                  importedCount: res.importedFromMarketplace,
                  doneAt: Date.now(),
                }
              : j,
          ),
        );
      } catch (err) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === id
              ? {
                  ...j,
                  status: "error",
                  error: err instanceof Error ? err.message : "Erreur inconnue.",
                  doneAt: Date.now(),
                }
              : j,
          ),
        );
      }
    })();

    return id;
  }, []);

  const dismissJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    // Garde les liaisons en vol ET les erreurs (visibles pour retry).
    // Retire uniquement les ✓ terminées.
    setJobs((prev) => prev.filter((j) => j.status !== "done"));
  }, []);

  const activeCount = jobs.filter((j) => j.status === "in_progress").length;

  const hasActiveJobForProduct = useCallback(
    (productId: string, marketplace: LinkJob["marketplace"]) =>
      jobs.some(
        (j) =>
          j.status === "in_progress" &&
          j.productId === productId &&
          j.marketplace === marketplace,
      ),
    [jobs],
  );

  return (
    <Ctx.Provider
      value={{
        jobs,
        activeCount,
        hasActiveJobForProduct,
        enqueueLinkJob,
        dismissJob,
        clearFinished,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useMarketplaceLinkJobs(): Value {
  const v = useContext(Ctx);
  if (!v)
    throw new Error(
      "useMarketplaceLinkJobs doit être appelé dans un <MarketplaceLinkProvider>.",
    );
  return v;
}
