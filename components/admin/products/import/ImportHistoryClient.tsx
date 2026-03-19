"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ImportJobWithDraft {
  id: string;
  type: "PRODUCTS" | "IMAGES";
  status: string;
  filename: string | null;
  totalItems: number;
  processedItems: number;
  successItems: number;
  errorItems: number;
  errorDraftId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  draft?: {
    id: string;
    status: string;
    errorRows: number;
    successRows: number;
  } | null;
}

interface Props {
  initialJobs: ImportJobWithDraft[];
  initialTotal: number;
  initialTotalPages: number;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type FilterType = "ALL" | "PRODUCTS" | "IMAGES";
type FilterStatus = "ALL" | "COMPLETED" | "FAILED";

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function ImportHistoryClient({
  initialJobs,
  initialTotal,
  initialTotalPages,
}: Props) {
  const [jobs, setJobs] = useState<ImportJobWithDraft[]>(initialJobs);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<FilterType>("ALL");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("ALL");
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(
    async (newType: FilterType, newStatus: FilterStatus, newPage: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (newType !== "ALL") params.set("type", newType);
        if (newStatus !== "ALL") params.set("status", newStatus);
        params.set("page", newPage.toString());

        const res = await fetch(`/api/admin/import-jobs/history?${params.toString()}`);
        if (!res.ok) throw new Error("Erreur serveur");
        const data = await res.json();
        setJobs(data.jobs);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setPage(data.page);
      } catch {
        // Keep current state on error
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleTypeFilter = (t: FilterType) => {
    setTypeFilter(t);
    fetchData(t, statusFilter, 1);
  };

  const handleStatusFilter = (s: FilterStatus) => {
    setStatusFilter(s);
    fetchData(typeFilter, s, 1);
  };

  const handlePage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    fetchData(typeFilter, statusFilter, p);
  };

  // ─────────────────────────────────────────────
  // Status badge
  // ─────────────────────────────────────────────

  function StatusBadge({ job }: { job: ImportJobWithDraft }) {
    if (job.status === "COMPLETED" && job.errorItems > 0) {
      return <span className="badge-warning">Terminé avec erreurs</span>;
    }
    if (job.status === "COMPLETED") {
      return <span className="badge-success">Terminé</span>;
    }
    if (job.status === "FAILED") {
      return <span className="badge-error">Échoué</span>;
    }
    if (job.status === "PROCESSING") {
      return (
        <span className="badge-neutral animate-pulse">En cours</span>
      );
    }
    if (job.status === "UPLOADING") {
      return (
        <span className="badge-neutral animate-pulse">Upload en cours</span>
      );
    }
    return <span className="badge-neutral">En attente</span>;
  }

  // ─────────────────────────────────────────────
  // Actions cell
  // ─────────────────────────────────────────────

  function ActionsCell({ job }: { job: ImportJobWithDraft }) {
    if (job.errorDraftId && job.draft) {
      if (job.draft.status === "PENDING") {
        return (
          <Link
            href={`/admin/produits/importer/brouillon/${job.errorDraftId}`}
            className="text-sm font-medium text-[#F59E0B] hover:text-[#D97706] transition-colors"
          >
            Corriger ({job.draft.errorRows} erreur{job.draft.errorRows > 1 ? "s" : ""})
          </Link>
        );
      }
      if (job.draft.status === "RESOLVED") {
        return (
          <span className="text-sm font-medium text-[#22C55E]">Corrigé</span>
        );
      }
    }

    if (job.status === "FAILED" && job.errorMessage) {
      return (
        <span
          className="text-sm text-[#EF4444] cursor-help underline decoration-dotted"
          title={job.errorMessage}
        >
          Voir l&apos;erreur
        </span>
      );
    }

    return <span className="text-sm text-[#999]">—</span>;
  }

  // ─────────────────────────────────────────────
  // Pill button helper
  // ─────────────────────────────────────────────

  function Pill({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) {
    return (
      <button
        onClick={onClick}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
          active
            ? "bg-[#1A1A1A] text-white"
            : "bg-white text-[#666] border border-[#E5E5E5] hover:border-[#1A1A1A]"
        }`}
      >
        {children}
      </button>
    );
  }

  // ─────────────────────────────────────────────
  // Pagination numbers
  // ─────────────────────────────────────────────

  function renderPageNumbers() {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }

    return pages.map((p, idx) =>
      p === "..." ? (
        <span key={`dots-${idx}`} className="px-2 text-[#999]">
          ...
        </span>
      ) : (
        <button
          key={p}
          onClick={() => handlePage(p)}
          className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
            p === page
              ? "bg-[#1A1A1A] text-white"
              : "text-[#666] hover:bg-[#F7F7F8]"
          }`}
        >
          {p}
        </button>
      )
    );
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fadeIn font-[family-name:var(--font-roboto)]">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/admin/produits/importer"
          className="text-[#666] hover:text-[#1A1A1A] transition-colors text-sm"
        >
          &larr; Retour à l&apos;import
        </Link>
      </div>

      <div>
        <h1 className="page-title font-[family-name:var(--font-poppins)]">
          Historique des imports
        </h1>
        <p className="page-subtitle">
          {total} import{total !== 1 ? "s" : ""} au total
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-[#E5E5E5] rounded-2xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#666] mr-1">Type :</span>
            <Pill active={typeFilter === "ALL"} onClick={() => handleTypeFilter("ALL")}>
              Tous
            </Pill>
            <Pill active={typeFilter === "PRODUCTS"} onClick={() => handleTypeFilter("PRODUCTS")}>
              Produits
            </Pill>
            <Pill active={typeFilter === "IMAGES"} onClick={() => handleTypeFilter("IMAGES")}>
              Images
            </Pill>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#666] mr-1">Statut :</span>
            <Pill active={statusFilter === "ALL"} onClick={() => handleStatusFilter("ALL")}>
              Tous
            </Pill>
            <Pill active={statusFilter === "COMPLETED"} onClick={() => handleStatusFilter("COMPLETED")}>
              Terminé
            </Pill>
            <Pill active={statusFilter === "FAILED"} onClick={() => handleStatusFilter("FAILED")}>
              Échoué
            </Pill>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-[#E5E5E5] border-t-[#1A1A1A] rounded-full animate-spin" />
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-12 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[#999] text-lg mb-4">Aucun import pour le moment</p>
          <Link href="/admin/produits/importer" className="btn-primary inline-block">
            Lancer un import
          </Link>
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white border border-[#E5E5E5] rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="text-left px-4 py-3 text-sm font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Fichier</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Date</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Statut</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Résultat</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="table-row">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          job.type === "PRODUCTS"
                            ? "bg-[#F0F0F0] text-[#1A1A1A]"
                            : "bg-[#E8F0FE] text-[#3B82F6]"
                        }`}
                      >
                        {job.type === "PRODUCTS" ? "Produits" : "Images"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#1A1A1A] max-w-[200px] truncate">
                      {job.filename || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#666]">
                      {formatDate(job.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge job={job} />
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="text-[#1A1A1A]">
                        {job.successItems}/{job.totalItems} importé{job.successItems !== 1 ? "s" : ""}
                      </span>
                      {job.errorItems > 0 && (
                        <span className="text-[#EF4444] ml-2">
                          ({job.errorItems} erreur{job.errorItems > 1 ? "s" : ""})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ActionsCell job={job} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-white border border-[#E5E5E5] rounded-2xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
              >
                <div className="flex items-center justify-between mb-3">
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      job.type === "PRODUCTS"
                        ? "bg-[#F0F0F0] text-[#1A1A1A]"
                        : "bg-[#E8F0FE] text-[#3B82F6]"
                    }`}
                  >
                    {job.type === "PRODUCTS" ? "Produits" : "Images"}
                  </span>
                  <StatusBadge job={job} />
                </div>

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#666]">Fichier</span>
                    <span className="text-[#1A1A1A] truncate max-w-[180px]">
                      {job.filename || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#666]">Date</span>
                    <span className="text-[#1A1A1A]">{formatDate(job.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#666]">Résultat</span>
                    <span>
                      <span className="text-[#1A1A1A]">
                        {job.successItems}/{job.totalItems} importé{job.successItems !== 1 ? "s" : ""}
                      </span>
                      {job.errorItems > 0 && (
                        <span className="text-[#EF4444] ml-1">
                          ({job.errorItems} err.)
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-[#E5E5E5]">
                  <ActionsCell job={job} />
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-sm text-[#666]">
                Page {page} sur {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePage(page - 1)}
                  disabled={page <= 1}
                  className="btn-secondary text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Précédent
                </button>
                {renderPageNumbers()}
                <button
                  onClick={() => handlePage(page + 1)}
                  disabled={page >= totalPages}
                  className="btn-secondary text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
