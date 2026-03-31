"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useConfirm } from "@/components/ui/ConfirmDialog";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface PrepareJob {
  id: string;
  status: "PENDING" | "ANALYZING" | "NEEDS_VALIDATION" | "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";
  totalProducts: number;
  processedProducts: number;
  readyProducts: number;
  errorProducts: number;
  approvedProducts: number;
  rejectedProducts: number;
  pendingReview: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobsResponse {
  jobs: PrepareJob[];
  total: number;
  page: number;
  totalPages: number;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: PrepareJob["status"]) {
  const map: Record<string, { cls: string; label: string }> = {
    COMPLETED: { cls: "badge badge-success", label: "Terminé" },
    FAILED: { cls: "badge badge-error", label: "Échoué" },
    PENDING: { cls: "badge badge-warning", label: "En attente" },
    RUNNING: { cls: "badge badge-info", label: "En cours" },
    ANALYZING: { cls: "badge badge-info", label: "Analyse" },
    NEEDS_VALIDATION: { cls: "badge badge-warning", label: "Validation requise" },
    STOPPED: { cls: "badge badge-neutral", label: "Arrêté" },
  };
  const s = map[status] || { cls: "badge badge-neutral", label: status };
  return <span className={s.cls}>{s.label}</span>;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function EfashionHistoryClient() {
  const { confirm } = useConfirm();

  const [jobs, setJobs] = useState<PrepareJob[]>([]);
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsTotalPages, setJobsTotalPages] = useState(1);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Fetch jobs ──
  const fetchJobs = useCallback(async (page: number) => {
    setJobsLoading(true);
    try {
      const res = await fetch(`/api/admin/efashion-sync/prepare/history?page=${page}&limit=10`);
      if (!res.ok) throw new Error("Erreur chargement");
      const data: JobsResponse = await res.json();
      setJobs(data.jobs);
      setJobsPage(data.page);
      setJobsTotalPages(data.totalPages);
    } catch {
      // silent
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs(1);
  }, [fetchJobs]);

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
    if (selectedIds.size === jobs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(jobs.map((j) => j.id)));
    }
  };

  // ── Bulk delete ──
  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    const ok = await confirm({
      title: "Supprimer les historiques",
      message: `Êtes-vous sûr de vouloir supprimer ${count} historique${count > 1 ? "s" : ""} ? Cette action est irréversible.`,
      confirmLabel: "Supprimer",
      type: "danger",
    });
    if (!ok) return;

    try {
      const res = await fetch("/api/admin/efashion-sync/prepare/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!res.ok) throw new Error("Erreur suppression");
      setSelectedIds(new Set());
      fetchJobs(1);
      setJobsPage(1);
    } catch {
      // silent
    }
  };

  // ── Render ──
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/admin/efashion"
          className="text-text-secondary hover:text-text-primary transition-colors text-sm"
        >
          &larr; Retour
        </Link>
      </div>

      <div>
        <h1 className="page-title font-heading">Historique eFashion</h1>
        <p className="page-subtitle">
          Consultez les synchronisations eFashion passées et leurs statistiques
        </p>
      </div>

      {/* Loading */}
      {jobsLoading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-border border-t-text-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!jobsLoading && jobs.length === 0 && (
        <div className="card text-center py-12">
          <svg className="w-12 h-12 mx-auto mb-3 text-text-secondary opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-text-secondary text-sm">Aucun historique de synchronisation eFashion.</p>
        </div>
      )}

      {/* Table */}
      {!jobsLoading && jobs.length > 0 && (
        <>
          {/* Bulk actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-text-secondary">{selectedIds.size} sélectionné(s)</span>
              <button onClick={handleBulkDelete} className="btn-secondary text-sm text-[#EF4444]">
                Supprimer
              </button>
            </div>
          )}

          {/* Desktop table */}
          <div className="card overflow-hidden hidden md:block">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="text-left px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === jobs.length && jobs.length > 0}
                      onChange={toggleSelectAll}
                      className="checkbox-custom"
                      aria-label="Tout sélectionner"
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">Date</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">Statut</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">Total</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">En attente</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">Approuvés</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">Refusés</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">Erreurs</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr
                    key={j.id}
                    className="border-t border-border hover:bg-bg-secondary/50 transition-colors cursor-pointer"
                    onClick={() => window.location.href = `/admin/efashion/historique/${j.id}`}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(j.id)}
                        onChange={() => toggleSelect(j.id)}
                        className="checkbox-custom"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary font-body">{formatDate(j.createdAt)}</td>
                    <td className="px-4 py-3 text-center">{statusBadge(j.status)}</td>
                    <td className="px-4 py-3 text-center text-sm text-text-secondary">{j.totalProducts}</td>
                    <td className="px-4 py-3 text-center text-sm text-text-secondary">{j.pendingReview}</td>
                    <td className="px-4 py-3 text-center text-sm text-text-secondary">{j.approvedProducts}</td>
                    <td className="px-4 py-3 text-center text-sm text-text-secondary">{j.rejectedProducts}</td>
                    <td className="px-4 py-3 text-center text-sm text-text-secondary">{j.errorProducts}</td>
                    <td className="px-4 py-3 text-right">
                      <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {jobs.map((j) => (
              <Link
                key={j.id}
                href={`/admin/efashion/historique/${j.id}`}
                className="card p-4 block"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text-primary">{formatDate(j.createdAt)}</span>
                  {statusBadge(j.status)}
                </div>
                <div className="flex gap-4 text-xs text-text-secondary">
                  <span>Total: {j.totalProducts}</span>
                  <span>Approuvés: {j.approvedProducts}</span>
                  <span>Erreurs: {j.errorProducts}</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {jobsTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => { setJobsPage(jobsPage - 1); fetchJobs(jobsPage - 1); }}
                disabled={jobsPage <= 1}
                className="btn-secondary text-sm px-3 py-1.5"
              >
                Précédent
              </button>
              <span className="text-sm text-text-secondary">
                {jobsPage} / {jobsTotalPages}
              </span>
              <button
                onClick={() => { setJobsPage(jobsPage + 1); fetchJobs(jobsPage + 1); }}
                disabled={jobsPage >= jobsTotalPages}
                className="btn-secondary text-sm px-3 py-1.5"
              >
                Suivant
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
