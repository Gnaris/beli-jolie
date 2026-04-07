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
  existingNoDiff: number;
  existingWithDiff: number;
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

export default function PfsHistoryClient() {
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
      const res = await fetch(`/api/admin/pfs-sync/prepare/history?page=${page}&limit=10`);
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
      title: "Supprimer les résumés",
      message: `Êtes-vous sûr de vouloir supprimer ${count} résumé${count > 1 ? "s" : ""} ? Cette action est irréversible.`,
      confirmLabel: "Supprimer",
      type: "danger",
    });
    if (!ok) return;

    try {
      const res = await fetch("/api/admin/pfs-sync/prepare/history", {
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
          href="/admin/pfs"
          className="text-text-secondary hover:text-text-primary transition-colors text-sm"
        >
          &larr; Retour
        </Link>
      </div>

      <div>
        <h1 className="page-title font-heading">Résumé Paris Fashion Shop</h1>
        <p className="page-subtitle">
          Consultez les synchronisations Paris Fashion Shop passées et leurs statistiques
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
          <p className="text-text-secondary text-sm">Aucun résumé de synchronisation Paris Fashion Shop.</p>
        </div>
      )}

      {/* Table */}
      {!jobsLoading && jobs.length > 0 && (
        <>
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
                  <th className="text-center px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">Identiques</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">Avec diff.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map((job) => (
                  <tr key={job.id} className="table-row group">
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(job.id)}
                        onChange={() => toggleSelect(job.id)}
                        className="checkbox-custom"
                        aria-label={`Sélectionner la synchronisation du ${formatDate(job.createdAt)}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/pfs/resume/${job.id}`}
                        className="text-sm font-medium text-text-primary hover:underline font-heading"
                      >
                        {formatDate(job.createdAt)}
                      </Link>
                      {job.errorMessage && (
                        <p className="text-xs text-[#EF4444] mt-0.5 truncate max-w-48">{job.errorMessage}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {statusBadge(job.status)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-medium text-text-primary">{job.totalProducts}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {job.pendingReview > 0 ? (
                        <span className="inline-flex items-center gap-1 text-sm font-medium text-[#4B5563]">
                          {job.pendingReview}
                        </span>
                      ) : (
                        <span className="text-sm text-text-secondary">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {job.approvedProducts > 0 ? (
                        <span className="text-sm font-medium text-[#22C55E]">{job.approvedProducts}</span>
                      ) : (
                        <span className="text-sm text-text-secondary">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {job.rejectedProducts > 0 ? (
                        <span className="text-sm font-medium text-[#EF4444]">{job.rejectedProducts}</span>
                      ) : (
                        <span className="text-sm text-text-secondary">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {job.existingNoDiff > 0 ? (
                        <span className="text-sm font-medium text-text-secondary">{job.existingNoDiff}</span>
                      ) : (
                        <span className="text-sm text-text-secondary">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {job.existingWithDiff > 0 ? (
                        <span className="text-sm font-medium text-[#F59E0B]">{job.existingWithDiff}</span>
                      ) : (
                        <span className="text-sm text-text-secondary">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/pfs/resume/${job.id}`}
                        className="btn-secondary text-xs px-3 h-9 inline-flex items-center"
                      >
                        Voir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {jobs.map((job) => (
              <Link
                key={job.id}
                href={`/admin/pfs/resume/${job.id}`}
                className="card block p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(job.id)}
                      onChange={(e) => {
                        e.preventDefault();
                        toggleSelect(job.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="checkbox-custom"
                      aria-label={`Sélectionner la synchronisation du ${formatDate(job.createdAt)}`}
                    />
                    <span className="text-sm font-medium text-text-primary font-heading">
                      {formatDate(job.createdAt)}
                    </span>
                  </div>
                  {statusBadge(job.status)}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <StatCell label="Total" value={job.totalProducts} />
                  <StatCell label="En attente" value={job.pendingReview} color="#4B5563" />
                  <StatCell label="Approuvés" value={job.approvedProducts} color="#22C55E" />
                  <StatCell label="Refusés" value={job.rejectedProducts} color="#EF4444" />
                  <StatCell label="Identiques" value={job.existingNoDiff} />
                  <StatCell label="Avec diff." value={job.existingWithDiff} color="#F59E0B" />
                </div>

                {job.errorMessage && (
                  <p className="text-xs text-[#EF4444] mt-2 truncate">{job.errorMessage}</p>
                )}
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {jobsTotalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => fetchJobs(jobsPage - 1)}
                disabled={jobsPage <= 1}
                className="btn-secondary text-sm h-10 disabled:opacity-40"
              >
                Précédent
              </button>
              <span className="text-sm text-text-secondary">
                Page {jobsPage} / {jobsTotalPages}
              </span>
              <button
                onClick={() => fetchJobs(jobsPage + 1)}
                disabled={jobsPage >= jobsTotalPages}
                className="btn-secondary text-sm h-10 disabled:opacity-40"
              >
                Suivant
              </button>
            </div>
          )}
        </>
      )}

      {/* Bulk delete bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-primary border-t border-border shadow-lg px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <span className="text-sm text-text-secondary">
              {selectedIds.size} résumé{selectedIds.size > 1 ? "s" : ""} sélectionné{selectedIds.size > 1 ? "s" : ""}
            </span>
            <button
              onClick={handleBulkDelete}
              className="btn-danger text-sm"
            >
              Supprimer {selectedIds.size} résumé{selectedIds.size > 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Mobile stat cell
// ─────────────────────────────────────────────

function StatCell({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-bg-secondary rounded-lg py-2 px-1">
      <div
        className="text-base font-semibold font-heading"
        style={value > 0 && color ? { color } : undefined}
      >
        {value}
      </div>
      <div className="text-[10px] text-text-secondary leading-tight mt-0.5">{label}</div>
    </div>
  );
}
