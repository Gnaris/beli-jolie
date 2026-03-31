"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import EfashionStagedProductCard from "./EfashionStagedProductCard";
import type { EfashionStagedProduct } from "./EfashionStagedProductCard";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface EfashionReviewGridProps {
  jobId: string;
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
  errorMessage: string | null;
  logs: {
    productLogs?: string[];
    analyzeLogs?: string[];
  } | null;
}

interface FetchResponse {
  products: EfashionStagedProduct[];
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
// Component
// ─────────────────────────────────────────────

export default function EfashionReviewGrid({ jobId }: EfashionReviewGridProps) {
  const { confirm } = useConfirm();
  const toast = useToast();

  // ── State ──
  const [products, setProducts] = useState<EfashionStagedProduct[]>([]);
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
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());

  // ── Job status ──
  const [job, setJob] = useState<JobData | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isJobRunning = job?.status === "RUNNING" || job?.status === "PENDING" || job?.status === "ANALYZING";

  // ── Fetch job status ──
  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/efashion-sync?id=${jobId}`);
      const data = await res.json();
      if (data.job) setJob(data.job);
    } catch {
      // silent
    }
  }, [jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Poll while running
  useEffect(() => {
    if (!isJobRunning) return;
    const interval = setInterval(() => {
      fetchJob();
      fetchProducts();
    }, 3000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJobRunning, fetchJob]);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs && logsContainerRef.current) {
      const el = logsContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [job?.logs?.productLogs, showLogs]);

  // ── Stop job ──
  const [stopping, setStopping] = useState(false);

  const stopJob = async () => {
    const ok = await confirm({
      title: "Arrêter l'importation",
      message: "Les produits déjà préparés seront conservés. Voulez-vous arrêter ?",
      confirmLabel: "Arrêter",
      cancelLabel: "Continuer",
      type: "danger",
    });
    if (!ok) return;

    setStopping(true);
    try {
      await fetch(`/api/admin/efashion-sync?id=${jobId}`, { method: "DELETE" });
      await fetchJob();
    } catch {
      // silent
    } finally {
      setStopping(false);
    }
  };

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

  // ── Fetch products ──
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ jobId, page: String(page), limit: String(LIMIT) });
      if (filter !== "ALL") params.set("status", filter);
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(`/api/admin/efashion-sync/staged?${params}`);
      const data: FetchResponse = await res.json();
      setProducts(data.products || []);
      setTotal(data.total || 0);
      if (data.counts) setCounts(data.counts);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [jobId, page, filter, debouncedSearch]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // ── Selection ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map((p) => p.id)));
    }
  };

  // ── Single approve/reject ──
  const handleApprove = async (id: string) => {
    setApprovingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/admin/efashion-sync/staged/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (res.ok) {
        toast.success("Produit approuvé");
        fetchProducts();
      } else {
        const data = await res.json();
        toast.error(data.error || "Erreur");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setApprovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/efashion-sync/staged/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      if (res.ok) {
        toast.success("Produit refusé");
        fetchProducts();
      } else {
        const data = await res.json();
        toast.error(data.error || "Erreur");
      }
    } catch {
      toast.error("Erreur réseau");
    }
  };

  // ── Bulk approve/reject ──
  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: "Approuver les produits",
      message: `Approuver ${selectedIds.size} produit(s) sélectionné(s) ? Ils seront importés dans la boutique.`,
      confirmLabel: "Approuver",
    });
    if (!ok) return;

    setBulkLoading(true);
    try {
      const res = await fetch("/api/admin/efashion-sync/staged/approve-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        toast.success(`${selectedIds.size} produit(s) approuvé(s)`);
        setSelectedIds(new Set());
        fetchProducts();
      } else {
        const data = await res.json();
        toast.error(data.error || "Erreur");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: "Refuser les produits",
      message: `Refuser ${selectedIds.size} produit(s) sélectionné(s) ?`,
      confirmLabel: "Refuser",
      type: "danger",
    });
    if (!ok) return;

    setBulkLoading(true);
    try {
      const res = await fetch("/api/admin/efashion-sync/staged/reject-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        toast.success(`${selectedIds.size} produit(s) refusé(s)`);
        setSelectedIds(new Set());
        fetchProducts();
      } else {
        const data = await res.json();
        toast.error(data.error || "Erreur");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setBulkLoading(false);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-6">
      {/* Job status banner */}
      {job && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isJobRunning && (
                <svg className="animate-spin w-5 h-5 text-[#22C55E] shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {isJobRunning && `Préparation en cours... (${job.processedProducts}/${job.totalProducts})`}
                  {job.status === "COMPLETED" && "Préparation terminée"}
                  {job.status === "FAILED" && "Préparation échouée"}
                  {job.status === "STOPPED" && "Préparation arrêtée"}
                  {job.status === "NEEDS_VALIDATION" && "Validation requise"}
                </p>
                {job.errorMessage && (
                  <p className="text-xs text-[#EF4444] mt-0.5">{job.errorMessage}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isJobRunning && (
                <button
                  onClick={stopJob}
                  disabled={stopping}
                  className="btn-secondary text-sm text-[#EF4444]"
                >
                  {stopping ? "Arrêt..." : "Arrêter"}
                </button>
              )}
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="btn-secondary text-sm"
              >
                {showLogs ? "Masquer les logs" : "Voir les logs"}
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {isJobRunning && job.totalProducts > 0 && (
            <div className="w-full bg-bg-secondary rounded-full h-2 mt-3">
              <div
                className="bg-[#22C55E] h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (job.processedProducts / job.totalProducts) * 100)}%` }}
              />
            </div>
          )}

          {/* Stats row */}
          <div className="flex gap-4 mt-3 text-xs text-text-secondary flex-wrap">
            <span>Total: {job.totalProducts}</span>
            <span>Traités: {job.processedProducts}</span>
            <span>Prêts: {job.readyProducts}</span>
            <span>Approuvés: {job.approvedProducts}</span>
            <span>Erreurs: {job.errorProducts}</span>
          </div>

          {/* Logs */}
          {showLogs && job.logs?.productLogs && job.logs.productLogs.length > 0 && (
            <div
              ref={logsContainerRef}
              className="mt-3 bg-[#1a1a2e] rounded-xl p-3 max-h-64 overflow-y-auto text-xs font-mono text-gray-300 space-y-0.5"
            >
              {job.logs.productLogs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Status tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((sf) => {
            const count = sf.value === "ALL"
              ? counts.ready + counts.approved + counts.rejected + counts.preparing + counts.error
              : counts[sf.value.toLowerCase() as keyof typeof counts] || 0;
            return (
              <button
                key={sf.value}
                onClick={() => { setFilter(sf.value); setPage(1); setSelectedIds(new Set()); }}
                className={`badge cursor-pointer transition-all ${
                  filter === sf.value ? sf.badgeClass : "badge-neutral opacity-60 hover:opacity-80"
                }`}
              >
                {sf.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par référence ou nom..."
            className="field-input pl-9 text-sm w-full"
          />
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-bg-secondary rounded-xl">
          <input
            type="checkbox"
            checked={selectedIds.size === products.length}
            onChange={toggleSelectAll}
            className="checkbox-custom"
          />
          <span className="text-sm text-text-secondary">{selectedIds.size} sélectionné(s)</span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={handleBulkApprove}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#22C55E] hover:bg-[#16A34A] rounded-lg transition-colors"
            >
              Approuver
            </button>
            <button
              onClick={handleBulkReject}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#EF4444] bg-[#EF4444]/10 hover:bg-[#EF4444]/20 rounded-lg transition-colors"
            >
              Refuser
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && products.length === 0 && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-border border-t-text-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && products.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-text-secondary text-sm">
            {isJobRunning ? "Les produits arrivent en temps réel..." : "Aucun produit trouvé."}
          </p>
        </div>
      )}

      {/* Product grid */}
      {products.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {products.map((product) => (
            <EfashionStagedProductCard
              key={product.id}
              product={product}
              selected={selectedIds.has(product.id)}
              approving={approvingIds.has(product.id)}
              onSelect={toggleSelect}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="btn-secondary text-sm px-3 py-1.5"
          >
            Précédent
          </button>
          <span className="text-sm text-text-secondary">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="btn-secondary text-sm px-3 py-1.5"
          >
            Suivant
          </button>
        </div>
      )}
    </div>
  );
}
