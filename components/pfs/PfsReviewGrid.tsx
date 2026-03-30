"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import PfsStagedProductCard from "./PfsStagedProductCard";
import PfsValidationPanel from "./PfsValidationPanel";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { StagedProduct, ColorMapEntry } from "./PfsStagedProductCard";

export type { StagedProduct };

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface PfsReviewGridProps {
  jobId: string;
  onBack?: () => void;
  onProductCountChange?: (counts: {
    ready: number;
    approved: number;
    rejected: number;
    preparing: number;
    error: number;
  }) => void;
}

interface JobData {
  id: string;
  status: "PENDING" | "ANALYZING" | "NEEDS_VALIDATION" | "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";
  totalProducts: number;
  processedProducts: number;
  readyProducts: number;
  errorProducts: number;
  approvedProducts: number;
  rejectedProducts: number;
  lastPage: number;
  errorMessage: string | null;
  analyzeResult: Record<string, unknown> | null;
  logs: {
    productLogs?: string[];
    imageLogs?: string[];
    analyzeLogs?: string[];
    imageStats?: {
      total: number;
      completed: number;
      failed: number;
      active: number;
      pending: number;
    };
  } | null;
}

interface FetchResponse {
  products: StagedProduct[];
  total: number;
  counts: {
    ready: number;
    approved: number;
    rejected: number;
    preparing: number;
    error: number;
  };
}

type StatusFilter = "ALL" | "READY" | "APPROVED" | "REJECTED" | "PREPARING" | "ERROR";

const STATUS_FILTERS: { value: StatusFilter; label: string; badgeClass: string }[] = [
  { value: "ALL", label: "Tous", badgeClass: "badge-neutral" },
  { value: "READY", label: "Prêts", badgeClass: "badge-info" },
  { value: "APPROVED", label: "Approuvés", badgeClass: "badge-success" },
  { value: "REJECTED", label: "Refusés", badgeClass: "badge-error" },
  { value: "PREPARING", label: "Préparation", badgeClass: "badge-warning" },
  { value: "ERROR", label: "Erreurs", badgeClass: "badge-error" },
];

const LIMIT = 20;

// ─────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Log color helper
// ─────────────────────────────────────────────

function logColor(line: string): string {
  if (line.includes("\u274C") || line.includes("\uD83D\uDCA5")) return "text-red-400";
  if (line.includes("\u2705") || line.includes("\uD83C\uDFC1")) return "text-green-400";
  if (line.includes("\u26A0\uFE0F") || line.includes("\u23ED")) return "text-yellow-400";
  if (line.includes("\u25B6") || line.includes("\u2500\u2500")) return "text-blue-300";
  if (line.includes("\uD83D\uDE80") || line.includes("\uD83D\uDCCA") || line.includes("\uD83D\uDCC4")) return "text-cyan-300";
  if (line.includes("\u2B07\uFE0F")) return "text-blue-300";
  if (line.includes("\uD83D\uDCE5")) return "text-[#888]";
  if (line.includes("\u23F3")) return "text-yellow-400";
  return "";
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function PfsReviewGrid({ jobId, onBack, onProductCountChange }: PfsReviewGridProps) {
  const { confirm } = useConfirm();
  const toast = useToast();

  // ── State ──
  const [products, setProducts] = useState<StagedProduct[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<StatusFilter>("READY");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({
    ready: 0,
    approved: 0,
    rejected: 0,
    preparing: 0,
    error: 0,
  });
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [colorMap, setColorMap] = useState<Map<string, ColorMapEntry>>(new Map());

  // ── Job status state (live sync tracking) ──
  const [job, setJob] = useState<JobData | null>(null);
  const [showProductLogs, setShowProductLogs] = useState(false);
  const [showImageLogs, setShowImageLogs] = useState(false);
  const productLogsContainerRef = useRef<HTMLDivElement>(null);
  const imageLogsContainerRef = useRef<HTMLDivElement>(null);
  // Track previously known product IDs to detect new arrivals (only during active sync)
  const prevProductIdsRef = useRef<Set<string>>(new Set());
  const [newProductIds, setNewProductIds] = useState<Set<string>>(new Set());
  const newProductTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isJobRunning = job?.status === "RUNNING" || job?.status === "PENDING" || job?.status === "ANALYZING";
  const isJobRunningRef = useRef(isJobRunning);
  isJobRunningRef.current = isJobRunning;

  // ── Fetch job status ──
  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/pfs-sync/prepare?id=${jobId}`);
      const data = await res.json();
      if (data.job) setJob(data.job);
    } catch {
      // silent
    }
  }, [jobId]);

  // Initial job fetch
  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Fetch color map for swatches
  useEffect(() => {
    fetch("/api/admin/pfs-sync/entities")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.colors) return;
        const map = new Map<string, ColorMapEntry>();
        for (const c of data.colors) map.set(c.id, { hex: c.hex, patternImage: c.patternImage });
        setColorMap(map);
      })
      .catch(() => {});
  }, []);

  // ── Stop job ──
  const [stopping, setStopping] = useState(false);

  const stopJob = async () => {
    const ok = await confirm({
      title: "Arrêter l'importation",
      message: "Les produits déjà importés seront conservés. Voulez-vous arrêter l'importation en cours ?",
      confirmLabel: "Arrêter",
      cancelLabel: "Continuer",
      type: "danger",
    });
    if (!ok) return;

    setStopping(true);
    try {
      await fetch(`/api/admin/pfs-sync/prepare?id=${jobId}`, { method: "DELETE" });
      await fetchJob();
    } catch {
      // silent
    } finally {
      setStopping(false);
    }
  };

  // Poll job status while running (every 3s)
  useEffect(() => {
    if (!isJobRunning) return;
    const interval = setInterval(fetchJob, 3000);
    return () => clearInterval(interval);
  }, [isJobRunning, fetchJob]);

  // Auto-scroll logs (only within the console container, NOT the whole page)
  useEffect(() => {
    if (showProductLogs && productLogsContainerRef.current) {
      const el = productLogsContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [job?.logs?.productLogs, showProductLogs]);
  useEffect(() => {
    if (showImageLogs && imageLogsContainerRef.current) {
      const el = imageLogsContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [job?.logs?.imageLogs, showImageLogs]);

  // ── Debounced search ──
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Cleanup newProduct animation timeout on unmount
  useEffect(() => {
    return () => {
      if (newProductTimeoutRef.current) clearTimeout(newProductTimeoutRef.current);
    };
  }, []);

  // ── Fetch products ──
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        jobId,
        page: String(page),
        limit: String(LIMIT),
      });
      if (filter !== "ALL") params.set("status", filter);
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(`/api/admin/pfs-sync/staged?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur lors du chargement");

      const data: FetchResponse = await res.json();

      // Detect newly appeared products for animation (only during active sync, not on page/filter change)
      const currentIds = new Set(data.products.map((p) => p.id));
      if (isJobRunningRef.current && prevProductIdsRef.current.size > 0) {
        const freshIds = new Set<string>();
        currentIds.forEach((id) => {
          if (!prevProductIdsRef.current.has(id)) {
            freshIds.add(id);
          }
        });
        if (freshIds.size > 0) {
          setNewProductIds(freshIds);
          // Clear previous timeout to avoid stale setState
          if (newProductTimeoutRef.current) clearTimeout(newProductTimeoutRef.current);
          newProductTimeoutRef.current = setTimeout(() => setNewProductIds(new Set()), 1500);
        }
      }
      prevProductIdsRef.current = currentIds;

      setProducts(data.products);
      setTotal(data.total);
      setCounts(data.counts);
      onProductCountChange?.(data.counts);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [jobId, page, filter, debouncedSearch, onProductCountChange]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Auto-refresh products while job is running (every 4s, offset from job poll)
  useEffect(() => {
    if (!isJobRunning) return;
    const interval = setInterval(fetchProducts, 4000);
    return () => clearInterval(interval);
  }, [isJobRunning, fetchProducts]);

  // ── Selection helpers ──
  const readyProductsOnPage = products.filter((p) => p.status === "READY");
  const allReadySelected =
    readyProductsOnPage.length > 0 &&
    readyProductsOnPage.every((p) => selectedIds.has(p.id));

  const handleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allReadySelected) {
        readyProductsOnPage.forEach((p) => next.delete(p.id));
      } else {
        readyProductsOnPage.forEach((p) => next.add(p.id));
      }
      return next;
    });
  }, [allReadySelected, readyProductsOnPage]);

  // Select ALL ready products across all pages
  const handleSelectAllReady = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        jobId,
        status: "READY",
        idsOnly: "true",
      });
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(`/api/admin/pfs-sync/staged?${params.toString()}`);
      if (!res.ok) return;
      const data: { ids: string[] } = await res.json();
      setSelectedIds(new Set(data.ids));
    } catch {
      // silent
    }
  }, [jobId, debouncedSearch]);

  // ── Single actions ──
  const handleApprove = useCallback(
    async (id: string) => {
      setApprovingIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch("/api/admin/pfs-sync/staged/approve-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [id] }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data?.error ?? `Erreur ${res.status}`);
          return;
        }
        const results = data?.results?.results ?? data?.results ?? [];
        const resultArr = Array.isArray(results) ? results : [];
        const failed = resultArr.filter((r: { error?: string }) => r.error);
        if (failed.length > 0) {
          toast.error(`Erreur: ${failed[0].error}`);
          return;
        }
        toast.success("Produit approuvé");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erreur réseau");
      } finally {
        setApprovingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        fetchProducts();
      }
    },
    [fetchProducts, toast],
  );

  const handleReject = useCallback(
    async (id: string) => {
      const ok = await confirm({
        type: "danger",
        title: "Refuser ce produit ?",
        message: "Ce produit ne sera pas importé dans la Boutique.",
        confirmLabel: "Refuser",
        cancelLabel: "Annuler",
      });
      if (!ok) return;

      await fetch("/api/admin/pfs-sync/staged/reject-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      fetchProducts();
      toast.success("Produit refusé");
    },
    [confirm, fetchProducts, toast],
  );

  // ── Bulk actions (parallel chunks to maximize speed) ──
  const BULK_CHUNK_SIZE = 10;
  const PARALLEL_CHUNKS = 5;

  const handleBulkApprove = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const allIds = [...selectedIds];
    const count = allIds.length;
    setBulkLoading(true);
    setBulkProgress({ current: 0, total: count });
    setApprovingIds(new Set(allIds));
    let totalErrors = 0;
    let processed = 0;

    // Split into small chunks
    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += BULK_CHUNK_SIZE) {
      chunks.push(allIds.slice(i, i + BULK_CHUNK_SIZE));
    }

    try {
      // Process chunks in parallel waves
      for (let w = 0; w < chunks.length; w += PARALLEL_CHUNKS) {
        const wave = chunks.slice(w, w + PARALLEL_CHUNKS);
        const results = await Promise.allSettled(
          wave.map(async (chunk) => {
            const res = await fetch("/api/admin/pfs-sync/staged/approve-bulk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: chunk }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => null);
              return { errors: chunk.length, message: data?.error };
            }
            const data = await res.json();
            const arr = data?.results?.results ?? data?.results ?? [];
            const resultArr = Array.isArray(arr) ? arr : [];
            return { errors: resultArr.filter((r: { error?: string }) => r.error).length };
          }),
        );

        for (const result of results) {
          const chunkSize = wave[results.indexOf(result)]?.length ?? 0;
          if (result.status === "fulfilled") {
            totalErrors += result.value.errors;
            if (result.value.message) toast.error(result.value.message);
          } else {
            totalErrors += chunkSize;
          }
          processed += chunkSize;
        }
        setBulkProgress({ current: processed, total: count });
      }

      setSelectedIds(new Set());
      fetchProducts();
      const succeeded = count - totalErrors;
      if (totalErrors > 0) {
        toast.warning(`${succeeded} créé(s), ${totalErrors} erreur(s)`);
      } else {
        toast.success(`${count} produit(s) créé(s)`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setBulkLoading(false);
      setBulkProgress({ current: 0, total: 0 });
      setApprovingIds(new Set());
    }
  }, [selectedIds, fetchProducts, toast]);

  const handleBulkReject = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const allIds = [...selectedIds];
    const count = allIds.length;
    const ok = await confirm({
      type: "danger",
      title: `Refuser ${count} produit(s) ?`,
      message: "Ces produits ne seront pas importés dans la Boutique. Cette action est irréversible.",
      confirmLabel: "Refuser tout",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    setBulkLoading(true);
    try {
      for (let i = 0; i < allIds.length; i += BULK_CHUNK_SIZE) {
        const chunk = allIds.slice(i, i + BULK_CHUNK_SIZE);
        const res = await fetch("/api/admin/pfs-sync/staged/reject-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          toast.error(data?.error ?? `Erreur lot ${Math.floor(i / BULK_CHUNK_SIZE) + 1}`);
        }
      }
      setSelectedIds(new Set());
      fetchProducts();
      toast.success(`${count} produit(s) refusé(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setBulkLoading(false);
    }
  }, [selectedIds, confirm, fetchProducts, toast]);

  // ── Filter change ──
  const handleFilterChange = useCallback((f: StatusFilter) => {
    setFilter(f);
    setPage(1);
    setSelectedIds(new Set());
  }, []);

  // ── Pagination ──
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  // ── Job progress computed values ──
  const logsData = job?.logs || null;
  const imageStats = logsData?.imageStats;
  const pendingImages = imageStats ? (imageStats.pending + imageStats.active) : 0;
  const totalImages = imageStats?.total ?? 0;
  const completedImages = imageStats?.completed ?? 0;

  // Progress combines product processing (50%) + image downloading (50%)
  // If no images yet, product progress alone but capped at 95%
  const progress = (() => {
    if (!job || job.totalProducts <= 0) return 0;
    const productProgress = job.processedProducts / job.totalProducts;
    if (totalImages <= 0) {
      // No image stats yet — show product progress but cap at 95%
      return Math.round(Math.min(productProgress * 100, 95));
    }
    const imageProgress = completedImages / totalImages;
    // Weighted: 50% products + 50% images
    return Math.round((productProgress * 50) + (imageProgress * 50));
  })();

  const totalAll = counts.ready + counts.approved + counts.rejected + counts.preparing + counts.error;

  return (
    <div className="relative flex flex-col gap-4">
      {/* ══════════════════════════════════════════ */}
      {/* LIVE SYNC HEADER — shown while job is running or just completed */}
      {/* ══════════════════════════════════════════ */}
      {job && (
        <div className="space-y-4">
          {/* ── Progress bar + stats ── */}
          <div className="card overflow-hidden">
            {/* Status header */}
            <div className="px-6 py-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isJobRunning && (
                    <svg
                      className="animate-spin w-5 h-5 text-[#22C55E] shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      role="status"
                      aria-label="Synchronisation en cours"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  <h2 className="font-heading font-semibold text-text-primary text-sm sm:text-base">
                    {job.status === "ANALYZING"
                      ? "Analyse en cours..."
                      : job.status === "NEEDS_VALIDATION"
                        ? "Validation requise"
                        : isJobRunning
                          ? "Importation en cours..."
                          : job.status === "COMPLETED"
                            ? "Importation terminée"
                            : job.status === "STOPPED"
                              ? "Importation arrêtée"
                              : "Importation échouée"}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {isJobRunning && (
                    <button
                      type="button"
                      onClick={stopJob}
                      disabled={stopping}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#EF4444] bg-[#EF4444]/10 hover:bg-[#EF4444]/20 border border-[#EF4444]/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12" rx="1" />
                      </svg>
                      {stopping ? "Arrêt..." : "Stop"}
                    </button>
                  )}
                  <span
                    className={`badge ${
                      job.status === "ANALYZING"
                        ? "badge-info"
                        : job.status === "NEEDS_VALIDATION"
                          ? "badge-warning"
                          : isJobRunning
                            ? "badge-info"
                            : job.status === "COMPLETED"
                              ? "badge-success"
                              : job.status === "STOPPED"
                                ? "badge-warning"
                                : "badge-error"
                    }`}
                  >
                    {job.status === "ANALYZING" ? "Analyse..." : job.status === "NEEDS_VALIDATION" ? "Validation requise" : isJobRunning ? `${progress}%` : job.status === "COMPLETED" ? "Terminé" : job.status === "STOPPED" ? "Arrêté" : "Échoué"}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              {isJobRunning && (
                <div
                  className="w-full bg-bg-secondary rounded-full h-2.5 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progression de la synchronisation"
                >
                  <div
                    className="h-full bg-[#22C55E] rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" role="group" aria-label="Statistiques de synchronisation">
                <div className="rounded-xl bg-[#22C55E]/10 p-3 text-center" aria-label={`${counts.ready + counts.approved} produits téléchargés`}>
                  <div className="text-xl sm:text-2xl font-bold font-heading text-[#22C55E]">
                    {counts.ready + counts.approved}
                  </div>
                  <div className="text-[11px] text-[#22C55E]/80 mt-0.5">Téléchargés</div>
                </div>
                <div className="rounded-xl bg-[#EF4444]/10 p-3 text-center" aria-label={`${counts.error} erreurs`}>
                  <div className="text-xl sm:text-2xl font-bold font-heading text-[#EF4444]">
                    {counts.error}
                  </div>
                  <div className="text-[11px] text-[#EF4444]/80 mt-0.5">Erreurs</div>
                </div>
                <div className="rounded-xl bg-[#F59E0B]/10 p-3 text-center" aria-label={`${isJobRunning ? Math.max(0, (job.totalProducts || 0) - job.processedProducts) : counts.preparing} produits restants`}>
                  <div className="text-xl sm:text-2xl font-bold font-heading text-[#F59E0B]">
                    {isJobRunning
                      ? Math.max(0, (job.totalProducts || 0) - job.processedProducts)
                      : counts.preparing}
                  </div>
                  <div className="text-[11px] text-[#F59E0B]/80 mt-0.5">Produits restants</div>
                </div>
                <div className="rounded-xl bg-[#8B5CF6]/10 p-3 text-center" aria-label={`${pendingImages} images en attente`}>
                  <div className="text-xl sm:text-2xl font-bold font-heading text-[#8B5CF6]">
                    {pendingImages}
                  </div>
                  <div className="text-[11px] text-[#8B5CF6]/80 mt-0.5">
                    Images restantes
                    {totalImages > 0 && <span className="opacity-70"> / {totalImages}</span>}
                  </div>
                </div>
                <div className="rounded-xl bg-bg-secondary p-3 text-center" aria-label={`${job.totalProducts || totalAll} produits au total`}>
                  <div className="text-xl sm:text-2xl font-bold font-heading text-text-primary">
                    {job.totalProducts || totalAll}
                  </div>
                  <div className="text-[11px] text-text-secondary mt-0.5">Total produits</div>
                </div>
              </div>

              {/* Page info */}
              {isJobRunning && job.totalProducts > 0 && (
                <p className="text-xs text-text-secondary text-center">
                  {job.processedProducts.toLocaleString()} / {job.totalProducts.toLocaleString()} produits
                  {totalImages > 0 && ` — ${completedImages} / ${totalImages} images`}
                  {job.lastPage > 0 && ` (page ${job.lastPage})`}
                </p>
              )}

              {/* Error message */}
              {job.status === "FAILED" && job.errorMessage && (
                <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 text-[#EF4444] px-4 py-2.5 rounded-xl text-sm">
                  {job.errorMessage}
                </div>
              )}
            </div>
          </div>

          {/* ── Dual consoles (collapsible) ── */}
          {logsData && (isJobRunning || (logsData.productLogs?.length ?? 0) > 0 || (logsData.imageLogs?.length ?? 0) > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Product console */}
              {logsData.productLogs && logsData.productLogs.length > 0 && (
                <div className="card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowProductLogs((v) => !v)}
                    aria-expanded={showProductLogs}
                    className="w-full flex items-center justify-between px-4 py-3 bg-bg-dark text-text-inverse hover:bg-[#2A2A2A] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                      </svg>
                      <span className="font-heading font-semibold text-sm">
                        Produits ({logsData.productLogs.length})
                      </span>
                    </div>
                    <ChevronDownIcon className={`w-4 h-4 transition-transform ${showProductLogs ? "rotate-180" : ""}`} />
                  </button>
                  {showProductLogs && (
                    <div ref={productLogsContainerRef} className="bg-[#0D0D0D] text-[#E0E0E0] px-4 py-3 max-h-80 overflow-y-auto font-mono text-[11px] leading-relaxed">
                      {logsData.productLogs.map((line, idx) => (
                        <div key={idx} className={`py-0.5 ${logColor(line)}`}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Image console */}
              {((logsData.imageLogs && logsData.imageLogs.length > 0) || logsData.imageStats) && (
                <div className="card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowImageLogs((v) => !v)}
                    aria-expanded={showImageLogs}
                    className="w-full flex items-center justify-between px-4 py-3 bg-bg-dark text-text-inverse hover:bg-[#2A2A2A] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                      </svg>
                      <span className="font-heading font-semibold text-sm">
                        Images {logsData.imageStats ? `(${logsData.imageStats.completed}/${logsData.imageStats.total})` : ""}
                      </span>
                    </div>
                    <ChevronDownIcon className={`w-4 h-4 transition-transform ${showImageLogs ? "rotate-180" : ""}`} />
                  </button>
                  {logsData.imageStats && logsData.imageStats.total > 0 && (
                    <div className="bg-[#111] px-4 py-2 flex flex-wrap gap-3 text-[11px] font-mono border-b border-[#222]">
                      <span className="text-green-400">{logsData.imageStats.completed} OK</span>
                      <span className="text-blue-400">{logsData.imageStats.active} en cours</span>
                      <span className="text-yellow-400">{logsData.imageStats.pending} en attente</span>
                      {logsData.imageStats.failed > 0 && (
                        <span className="text-red-400">
                          {logsData.imageStats.failed} erreur{logsData.imageStats.failed > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  )}
                  {showImageLogs && logsData.imageLogs && (
                    <div ref={imageLogsContainerRef} className="bg-[#0D0D0D] text-[#E0E0E0] px-4 py-3 max-h-80 overflow-y-auto font-mono text-[11px] leading-relaxed">
                      {logsData.imageLogs.map((line, idx) => (
                        <div key={idx} className={`py-0.5 ${logColor(line)}`}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* ANALYZING — show analyze logs              */}
      {/* ══════════════════════════════════════════ */}
      {job?.status === "ANALYZING" && job.logs?.analyzeLogs && job.logs.analyzeLogs.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-6 py-3 bg-bg-dark text-text-inverse flex items-center gap-3">
            <svg className="w-4 h-4 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="font-heading font-semibold text-sm">
              Console d&apos;analyse ({job.logs.analyzeLogs.length} lignes)
            </span>
          </div>
          <div className="bg-[#0D0D0D] text-[#E0E0E0] px-6 py-4 max-h-64 overflow-y-auto font-mono text-xs leading-relaxed">
            {job.logs.analyzeLogs.map((line, idx) => (
              <div
                key={idx}
                className={`py-0.5 ${
                  line.includes("terminée") ? "text-green-400"
                    : line.includes("Page") ? "text-blue-300"
                      : line.includes("chargé") ? "text-cyan-300"
                        : line.includes("❌") ? "text-red-400"
                          : line.includes("⚠️") ? "text-yellow-400"
                            : ""
                }`}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* NEEDS_VALIDATION — show validation panel   */}
      {/* ══════════════════════════════════════════ */}
      {job?.status === "NEEDS_VALIDATION" && job.analyzeResult && (
        <PfsValidationPanel
          jobId={jobId}
          analyzeResult={job.analyzeResult as unknown as Parameters<typeof PfsValidationPanel>[0]["analyzeResult"]}
          onValidated={() => fetchJob()}
        />
      )}

      {/* ── Top bar ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Back button */}
        {onBack && (
          <button onClick={onBack} className="text-text-secondary hover:text-text-primary transition-colors text-sm mr-auto">
            &larr; Retour
          </button>
        )}
        {/* Search */}
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par référence ou nom…"
            className="field-input w-full !pl-10"
          />
        </div>

        {/* Progress counter */}
        <div className="flex items-center gap-2 text-sm text-text-secondary whitespace-nowrap">
          <span className="font-medium text-text-primary">{counts.approved + counts.rejected}</span>
          <span>/</span>
          <span>{totalAll}</span>
          <span>traités</span>
        </div>

        {/* Select all (all pages) */}
        {readyProductsOnPage.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary whitespace-nowrap">
            <input
              type="checkbox"
              checked={selectedIds.size >= counts.ready && counts.ready > 0}
              onChange={() => {
                if (selectedIds.size >= counts.ready) {
                  setSelectedIds(new Set());
                } else {
                  handleSelectAllReady();
                }
              }}
              className="checkbox-custom h-4 w-4 rounded border-border"
            />
            Tout sélectionner ({counts.ready})
          </label>
        )}
      </div>

      {/* ── Status filter tabs ── */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((sf) => {
          const count =
            sf.value === "ALL"
              ? totalAll
              : counts[sf.value.toLowerCase() as keyof typeof counts];
          const isActive = filter === sf.value;
          return (
            <button
              key={sf.value}
              onClick={() => handleFilterChange(sf.value)}
              className={`
                flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors
                ${
                  isActive
                    ? "bg-text-primary text-bg-primary"
                    : "bg-bg-secondary text-text-secondary hover:bg-border hover:text-text-primary"
                }
              `}
            >
              {sf.label}
              <span
                className={`
                  inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs
                  ${isActive ? "bg-bg-primary/20 text-bg-primary" : "bg-border text-text-secondary"}
                `}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Existing / New filter ── */}
      {/* ── Grid ── */}
      {loading && products.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="card animate-pulse"
            >
              <div className="aspect-square w-full rounded-t-xl bg-bg-secondary" />
              <div className="flex flex-col gap-2 p-3">
                <div className="h-4 w-3/4 rounded bg-bg-secondary" />
                <div className="h-3 w-1/2 rounded bg-bg-secondary" />
                <div className="h-3 w-1/3 rounded bg-bg-secondary" />
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 && !isJobRunning ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-text-secondary">
          <span className="text-lg">Aucun produit trouvé</span>
          <span className="text-sm">Essayez de modifier vos filtres ou votre recherche.</span>
        </div>
      ) : products.length === 0 && isJobRunning ? (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-text-secondary">
          <svg className="animate-spin w-8 h-8 text-[#22C55E]" fill="none" viewBox="0 0 24 24" role="status" aria-label="Chargement des produits">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Les produits vont apparaître ici au fur et à mesure...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => (
            <div
              key={product.id}
              className={newProductIds.has(product.id) ? "animate-pfs-appear" : ""}
            >
              <PfsStagedProductCard
                product={product}
                selected={selectedIds.has(product.id)}
                approving={approvingIds.has(product.id)}
                colorMap={colorMap}
                onSelect={handleSelect}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            </div>
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-secondary text-text-secondary transition-colors hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Page précédente"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <span className="text-sm text-text-secondary">
            Page <span className="font-medium text-text-primary">{page}</span> sur{" "}
            <span className="font-medium text-text-primary">{totalPages}</span>
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-secondary text-text-secondary transition-colors hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Page suivante"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 animate-fadeIn border-t border-border bg-bg-primary/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-text-primary">
                {selectedIds.size} produit{selectedIds.size > 1 ? "s" : ""} sélectionné{selectedIds.size > 1 ? "s" : ""}
              </span>
              {counts.ready > selectedIds.size && (
                <button
                  onClick={handleSelectAllReady}
                  className="text-sm text-[#3B82F6] underline underline-offset-2 hover:text-[#2563EB]"
                >
                  Tout sélectionner ({counts.ready})
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkApprove}
                disabled={bulkLoading}
                className="flex h-10 items-center gap-2 rounded-lg bg-[#22C55E] px-4 text-sm font-medium text-white transition-colors hover:bg-[#16A34A] disabled:opacity-50"
              >
                {bulkLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {bulkProgress.total > 0 ? `${bulkProgress.current}/${bulkProgress.total}` : "..."}
                  </>
                ) : (
                  <>
                    <CheckIcon className="h-4 w-4" />
                    Approuver
                  </>
                )}
              </button>
              <button
                onClick={handleBulkReject}
                disabled={bulkLoading}
                className="flex h-10 items-center gap-2 rounded-lg bg-[#EF4444] px-4 text-sm font-medium text-white transition-colors hover:bg-[#DC2626] disabled:opacity-50"
              >
                <XIcon className="h-4 w-4" />
                Refuser
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="flex h-10 items-center gap-2 rounded-lg bg-bg-secondary px-4 text-sm font-medium text-text-secondary transition-colors hover:bg-border"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spacer when bulk bar is visible so content isn't hidden behind it */}
      {selectedIds.size > 0 && <div className="h-16" />}

    </div>
  );
}
