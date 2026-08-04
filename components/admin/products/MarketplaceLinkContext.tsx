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
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

// Fenêtre de grâce (ms) pendant laquelle on garde le badge en "linking" APRÈS
// la fin réelle de la liaison. Sans ça, le badge repasse "hors ligne" (rouge)
// pendant 1-3 s le temps que router.refresh rapatrie le nouveau pfsProductId /
// ankorsProductId / faireProductId / efashionLinked côté RSC — flash rouge
// bien visible et déroutant pour la cliente.
const LINK_POST_DONE_GRACE_MS = 15_000;

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
  const router = useRouter();
  // Force un re-render à l'expiration de la fenêtre de grâce post-done, sinon
  // `hasActiveJobForProduct` continue à renvoyer true dans les composants
  // memoisés jusqu'à la prochaine mutation de `jobs` (qui peut ne jamais venir
  // si l'admin ne clique nulle part). Sans re-render, le badge reste bloqué
  // en "loading" jusqu'à un refresh manuel.
  const [, forceTick] = useState(0);
  const graceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const t of graceTimersRef.current.values()) clearTimeout(t);
      graceTimersRef.current.clear();
    };
  }, []);

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
        if (res.success) {
          // Rapatrie le nouveau *ProductId marketplace côté RSC au plus vite —
          // sans ça, le badge repasse "hors ligne" à l'expiration de la
          // fenêtre de grâce et flashe rouge avant de devenir vert.
          router.refresh();
          const timer = setTimeout(() => {
            graceTimersRef.current.delete(id);
            forceTick((n) => n + 1);
          }, LINK_POST_DONE_GRACE_MS);
          graceTimersRef.current.set(id, timer);
        }
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
  }, [router]);

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
    (productId: string, marketplace: LinkJob["marketplace"]) => {
      const now = Date.now();
      return jobs.some((j) => {
        if (j.productId !== productId || j.marketplace !== marketplace) return false;
        if (j.status === "in_progress") return true;
        // Fenêtre de grâce post-succès : le badge reste "linking" le temps
        // que router.refresh rapatrie serverProductId côté RSC. Sans ça, le
        // badge repasse rouge 1-3 s avant de devenir vert.
        if (
          j.status === "done" &&
          j.doneAt !== undefined &&
          !j.error &&
          now - j.doneAt < LINK_POST_DONE_GRACE_MS
        ) {
          return true;
        }
        return false;
      });
    },
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
