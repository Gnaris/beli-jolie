"use client";

/**
 * ImageProcessingContext
 *
 * Provider + hook qui poll `/api/admin/products/images/progress` toutes les
 * 2 s pour suivre l'état des jobs de traitement d'images en arrière-plan.
 * Le polling se met automatiquement en veille (10 s) quand aucun job
 * n'est en cours, pour ne pas martyriser le serveur quand rien ne se passe.
 *
 * Le widget `ImageProcessingWidget` consomme ce hook. Les fiches produit
 * peuvent aussi appeler `useProductImageJobsCount(productId)` pour afficher
 * un mini-indicateur « X images en cours de finition » localisé.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ImageJobStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

export interface ImageJobRow {
  id: string;
  productId: string | null;
  status: ImageJobStatus;
  error: string | null;
  createdAt: string; // ISO
  completedAt: string | null;
}

interface ImageProcessingContextValue {
  jobs: ImageJobRow[];
  /** Tous statuts confondus, jobs des 6 dernières heures. */
  counts: {
    pending: number;
    processing: number;
    done: number;
    failed: number;
    total: number;
  };
  /** True s'il reste des jobs en attente ou en traitement. */
  hasActiveWork: boolean;
  /** Force un refresh immédiat (utilisé après enqueue depuis ProductForm). */
  refresh: () => void;
  retry: (jobId: string) => Promise<void>;
}

const Ctx = createContext<ImageProcessingContextValue | null>(null);

const ACTIVE_POLL_MS = 2000;
const IDLE_POLL_MS = 10_000;

export function ImageProcessingProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<ImageJobRow[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchJobs = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/admin/products/images/progress", {
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { jobs: ImageJobRow[] };
      if (!mountedRef.current) return;
      setJobs(json.jobs ?? []);
    } catch {
      /* abort or network blip — ignore, will retry on next tick */
    }
  }, []);

  // Boucle de polling adaptatif (active si du travail en cours, idle sinon)
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await fetchJobs();
      if (cancelled) return;
      const hasActive = jobsHaveActiveWork(latestJobsRef.current);
      const delay = hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
      timerRef.current = setTimeout(() => void tick(), delay);
    };
    void tick();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
    // fetchJobs est stable
  }, [fetchJobs]);

  // Maintient la dernière liste dans une ref pour que la closure du tick
  // puisse décider du délai sans dépendance React (évite de relancer le
  // timer à chaque update).
  const latestJobsRef = useRef<ImageJobRow[]>([]);
  useEffect(() => {
    latestJobsRef.current = jobs;
  }, [jobs]);

  const counts = useMemo(() => {
    let pending = 0, processing = 0, done = 0, failed = 0;
    for (const j of jobs) {
      if (j.status === "PENDING") pending++;
      else if (j.status === "PROCESSING") processing++;
      else if (j.status === "DONE") done++;
      else if (j.status === "FAILED") failed++;
    }
    return { pending, processing, done, failed, total: jobs.length };
  }, [jobs]);

  const hasActiveWork = counts.pending + counts.processing > 0;

  const retry = useCallback(async (jobId: string) => {
    await fetch("/api/admin/products/images/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry", jobId }),
    });
    await fetchJobs();
  }, [fetchJobs]);

  const value = useMemo<ImageProcessingContextValue>(
    () => ({ jobs, counts, hasActiveWork, refresh: fetchJobs, retry }),
    [jobs, counts, hasActiveWork, fetchJobs, retry],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useImageProcessing(): ImageProcessingContextValue {
  const v = useContext(Ctx);
  if (!v) {
    // Hors provider : renvoie un état neutre plutôt que de crasher (utile
    // pour les composants qui peuvent être montés ailleurs que sous
    // l'admin layout, ex preview Storybook).
    return {
      jobs: [],
      counts: { pending: 0, processing: 0, done: 0, failed: 0, total: 0 },
      hasActiveWork: false,
      refresh: () => {},
      retry: async () => {},
    };
  }
  return v;
}

/**
 * Hook utilitaire pour la fiche produit : « combien de jobs sont encore en
 * cours pour CE produit ? ». Filtre côté client à partir du state global.
 */
export function useProductImageJobsCount(productId: string | null | undefined): {
  pending: number;
  processing: number;
  failed: number;
  active: number;
} {
  const { jobs } = useImageProcessing();
  return useMemo(() => {
    if (!productId) return { pending: 0, processing: 0, failed: 0, active: 0 };
    let pending = 0, processing = 0, failed = 0;
    for (const j of jobs) {
      if (j.productId !== productId) continue;
      if (j.status === "PENDING") pending++;
      else if (j.status === "PROCESSING") processing++;
      else if (j.status === "FAILED") failed++;
    }
    return { pending, processing, failed, active: pending + processing };
  }, [jobs, productId]);
}

function jobsHaveActiveWork(jobs: ImageJobRow[]): boolean {
  for (const j of jobs) {
    if (j.status === "PENDING" || j.status === "PROCESSING") return true;
  }
  return false;
}
