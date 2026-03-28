"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { deleteImportJobs } from "@/app/actions/admin/import-jobs";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

// Result details stored in ImportJob.resultDetails JSON field
interface ProductResultDetails {
  type: "PRODUCTS";
  products: {
    reference: string;
    name: string;
    category?: string;
    variants: { color: string; saleType: string; unitPrice: number; stock: number; packQuantity?: number | null }[];
  }[];
}

interface ImageResultDetails {
  type: "IMAGES";
  images: {
    filename: string;
    reference: string;
    color: string;
    position: number;
  }[];
}

type ResultDetails = ProductResultDetails | ImageResultDetails | null;

export interface ImportJobWithDraft {
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
  resultDetails?: ResultDetails;
  createdAt: string;
  updatedAt: string;
  draft?: {
    id: string;
    status: string;
    errorRows: number;
    successRows: number;
  } | null;
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return "< 1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}min ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}min`;
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
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const { confirm } = useConfirm();
  const { toast } = useToast();

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === jobs.length ? new Set() : new Set(jobs.map((j) => j.id))
    );
  }, [jobs]);

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

  const handleDelete = useCallback(async () => {
    const count = selectedIds.size;
    if (count === 0) return;

    const confirmed = await confirm({
      type: "danger",
      title: "Supprimer définitivement",
      message: `Êtes-vous sûr de vouloir supprimer ${count} import${count > 1 ? "s" : ""} ? Cette action est irréversible.`,
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      const result = await deleteImportJobs([...selectedIds]);
      toast({ type: "success", title: `${result.deleted} import${result.deleted > 1 ? "s" : ""} supprimé${result.deleted > 1 ? "s" : ""}` });
      setSelectedIds(new Set());
      fetchData(typeFilter, statusFilter, page);
    } catch (err) {
      toast({ type: "error", title: "Erreur", message: err instanceof Error ? err.message : "Erreur lors de la suppression." });
    } finally {
      setDeleting(false);
    }
  }, [selectedIds, confirm, toast, fetchData, typeFilter, statusFilter, page]);

  const handleTypeFilter = (t: FilterType) => {
    setTypeFilter(t);
    setSelectedIds(new Set());
    fetchData(t, statusFilter, 1);
  };

  const handleStatusFilter = (s: FilterStatus) => {
    setStatusFilter(s);
    setSelectedIds(new Set());
    fetchData(typeFilter, s, 1);
  };

  const handlePage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setSelectedIds(new Set());
    fetchData(typeFilter, statusFilter, p);
  };

  // ─────────────────────────────────────────────
  // Status badge
  // ─────────────────────────────────────────────

  function StatusBadge({ job }: { job: ImportJobWithDraft }) {
    if (job.status === "COMPLETED" && job.errorItems > 0) {
      return <span className="badge badge-warning">Terminé avec erreurs</span>;
    }
    if (job.status === "COMPLETED") {
      return <span className="badge badge-success">Terminé</span>;
    }
    if (job.status === "FAILED") {
      return <span className="badge badge-error">Échoué</span>;
    }
    if (job.status === "PROCESSING") {
      return (
        <span className="badge badge-info animate-pulse">En cours</span>
      );
    }
    if (job.status === "UPLOADING") {
      return (
        <span className="badge badge-info animate-pulse">Upload en cours</span>
      );
    }
    return <span className="badge badge-neutral">En attente</span>;
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
            ? "bg-bg-dark text-text-inverse"
            : "bg-bg-primary text-[#666] border border-border hover:border-bg-dark"
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
              ? "bg-bg-dark text-text-inverse"
              : "text-[#666] hover:bg-bg-secondary"
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
    <div className="space-y-6 animate-fadeIn font-body">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/admin/produits/importer"
          className="text-[#666] hover:text-text-primary transition-colors text-sm"
        >
          &larr; Retour à l&apos;import
        </Link>
      </div>

      <div>
        <h1 className="page-title font-heading">
          Historique des imports
        </h1>
        <p className="page-subtitle">
          {total} import{total !== 1 ? "s" : ""} au total
        </p>
      </div>

      {/* Filters + Delete bar */}
      <div className="bg-bg-primary border border-border rounded-2xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
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

          {/* Delete button — appears when selection is active */}
          {selectedIds.size > 0 && (
            <div className="sm:ml-auto flex items-center gap-3">
              <span className="text-sm text-[#666]">
                {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
              </span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-[#EF4444] hover:bg-[#DC2626] transition-colors disabled:opacity-50"
                aria-label={`Supprimer ${selectedIds.size} import${selectedIds.size > 1 ? "s" : ""}`}
              >
                {deleting ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
                Supprimer
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-border border-t-[#1A1A1A] rounded-full animate-spin" />
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <div className="bg-bg-primary border border-border rounded-2xl p-12 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[#999] text-lg mb-4">Aucun import pour le moment</p>
          <Link href="/admin/produits/importer" className="btn-primary inline-block">
            Lancer un import
          </Link>
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="w-12 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={jobs.length > 0 && selectedIds.size === jobs.length}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < jobs.length;
                      }}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-[#D1D5DB] text-text-primary focus:ring-[#1A1A1A] cursor-pointer accent-[#1A1A1A]"
                      aria-label="Tout sélectionner"
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Fichier</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Date</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Statut</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Résultat</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Actions</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <JobRowDesktop
                    key={job.id}
                    job={job}
                    expanded={expandedJobId === job.id}
                    onToggle={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                    selected={selectedIds.has(job.id)}
                    onSelect={() => toggleSelect(job.id)}
                    StatusBadge={StatusBadge}
                    ActionsCell={ActionsCell}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {/* Mobile select all */}
            <div className="flex items-center gap-3 px-1">
              <input
                type="checkbox"
                checked={jobs.length > 0 && selectedIds.size === jobs.length}
                ref={(el) => {
                  if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < jobs.length;
                }}
                onChange={toggleSelectAll}
                className="w-5 h-5 rounded border-[#D1D5DB] text-text-primary focus:ring-[#1A1A1A] cursor-pointer accent-[#1A1A1A]"
                aria-label="Tout sélectionner"
              />
              <span className="text-sm text-[#666]">Tout sélectionner</span>
            </div>
            {jobs.map((job) => (
              <JobCardMobile
                key={job.id}
                job={job}
                expanded={expandedJobId === job.id}
                onToggle={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                selected={selectedIds.has(job.id)}
                onSelect={() => toggleSelect(job.id)}
                StatusBadge={StatusBadge}
                ActionsCell={ActionsCell}
              />
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

// ─────────────────────────────────────────────
// Desktop row with expandable detail
// ─────────────────────────────────────────────

function JobRowDesktop({
  job,
  expanded,
  onToggle,
  selected,
  onSelect,
  StatusBadge,
  ActionsCell,
}: {
  job: ImportJobWithDraft;
  expanded: boolean;
  onToggle: () => void;
  selected: boolean;
  onSelect: () => void;
  StatusBadge: React.FC<{ job: ImportJobWithDraft }>;
  ActionsCell: React.FC<{ job: ImportJobWithDraft }>;
}) {
  return (
    <>
      <tr
        className={`table-row cursor-pointer transition-colors ${selected ? "bg-[#F0F7FF]" : "hover:bg-[#FAFAFA]"}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            className="w-4 h-4 rounded border-[#D1D5DB] text-text-primary focus:ring-[#1A1A1A] cursor-pointer accent-[#1A1A1A]"
            aria-label={`Sélectionner ${job.filename || job.id}`}
          />
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
              job.type === "PRODUCTS"
                ? "bg-[#F0F0F0] text-text-primary"
                : "bg-[#E8F0FE] text-[#3B82F6]"
            }`}
          >
            {job.type === "PRODUCTS" ? "Produits" : "Images"}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-text-primary max-w-[200px] truncate">
          {job.filename || "—"}
        </td>
        <td className="px-4 py-3 text-sm text-[#666]">
          {formatDate(job.createdAt)}
        </td>
        <td className="px-4 py-3">
          <StatusBadge job={job} />
        </td>
        <td className="px-4 py-3 text-sm">
          <span className="text-text-primary">
            {job.successItems}/{job.totalItems} importé{job.successItems !== 1 ? "s" : ""}
          </span>
          {job.errorItems > 0 && (
            <span className="text-[#EF4444] ml-2">
              ({job.errorItems} erreur{job.errorItems > 1 ? "s" : ""})
            </span>
          )}
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <ActionsCell job={job} />
        </td>
        <td className="px-4 py-3 text-[#999] text-xs">
          {expanded ? "▲" : "▼"}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="p-0">
            <JobDetailPanel job={job} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// Mobile card with expandable detail
// ─────────────────────────────────────────────

function JobCardMobile({
  job,
  expanded,
  onToggle,
  selected,
  onSelect,
  StatusBadge,
  ActionsCell,
}: {
  job: ImportJobWithDraft;
  expanded: boolean;
  onToggle: () => void;
  selected: boolean;
  onSelect: () => void;
  StatusBadge: React.FC<{ job: ImportJobWithDraft }>;
  ActionsCell: React.FC<{ job: ImportJobWithDraft }>;
}) {
  return (
    <div className={`bg-bg-primary border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden ${selected ? "border-[#3B82F6] bg-[#F0F7FF]" : "border-border"}`}>
      <div className="p-4 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              onClick={(e) => e.stopPropagation()}
              className="w-5 h-5 rounded border-[#D1D5DB] text-text-primary focus:ring-[#1A1A1A] cursor-pointer accent-[#1A1A1A]"
              aria-label={`Sélectionner ${job.filename || job.id}`}
            />
            <span
              className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                job.type === "PRODUCTS"
                  ? "bg-[#F0F0F0] text-text-primary"
                  : "bg-[#E8F0FE] text-[#3B82F6]"
              }`}
            >
              {job.type === "PRODUCTS" ? "Produits" : "Images"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge job={job} />
            <span className="text-[#999] text-xs">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-[#666]">Fichier</span>
            <span className="text-text-primary truncate max-w-[180px]">
              {job.filename || "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#666]">Date</span>
            <span className="text-text-primary">{formatDate(job.createdAt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#666]">Résultat</span>
            <span>
              <span className="text-text-primary">
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

        <div className="mt-3 pt-3 border-t border-border" onClick={(e) => e.stopPropagation()}>
          <ActionsCell job={job} />
        </div>
      </div>

      {expanded && <JobDetailPanel job={job} />}
    </div>
  );
}

// ─────────────────────────────────────────────
// Detail panel — shown when a job row is expanded
// ─────────────────────────────────────────────

function JobDetailPanel({ job }: { job: ImportJobWithDraft }) {
  const successPct = job.totalItems > 0 ? (job.successItems / job.totalItems) * 100 : 0;
  const errorPct = job.totalItems > 0 ? (job.errorItems / job.totalItems) * 100 : 0;
  const isProcessing = job.status === "PENDING" || job.status === "PROCESSING" || job.status === "UPLOADING";

  const details = job.resultDetails as ResultDetails;
  const productDetails = details?.type === "PRODUCTS" ? details : null;
  const imageDetails = details?.type === "IMAGES" ? details : null;

  // Group images by reference for display
  const imagesByRef = imageDetails
    ? imageDetails.images.reduce<Record<string, typeof imageDetails.images>>((acc, img) => {
        (acc[img.reference] ??= []).push(img);
        return acc;
      }, {})
    : null;

  return (
    <div className="bg-[#FAFAFA] border-t border-border px-6 py-5 space-y-5">
      {/* Info grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-[#999] uppercase tracking-wide mb-1">Type</p>
          <p className="text-sm font-medium text-text-primary">{job.type === "PRODUCTS" ? "Données produits" : "Images produits"}</p>
        </div>
        <div>
          <p className="text-xs text-[#999] uppercase tracking-wide mb-1">Fichier</p>
          <p className="text-sm text-text-primary break-all">{job.filename || "—"}</p>
        </div>
        <div>
          <p className="text-xs text-[#999] uppercase tracking-wide mb-1">Date de lancement</p>
          <p className="text-sm text-text-primary">{formatDate(job.createdAt)}</p>
        </div>
        <div>
          <p className="text-xs text-[#999] uppercase tracking-wide mb-1">Durée</p>
          <p className="text-sm text-text-primary">
            {isProcessing ? (
              <span className="text-amber-600">En cours...</span>
            ) : (
              formatDuration(job.createdAt, job.updatedAt)
            )}
          </p>
        </div>
      </div>

      {/* Progress breakdown */}
      <div>
        <p className="text-xs text-[#999] uppercase tracking-wide mb-3">Résumé</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl p-3 bg-bg-primary border border-border text-center">
            <p className="text-2xl font-bold font-heading text-text-primary">{job.totalItems}</p>
            <p className="text-xs text-[#666] mt-0.5">{job.type === "PRODUCTS" ? "Produits total" : "Images total"}</p>
          </div>
          <div className="rounded-xl p-3 bg-green-50 border border-green-200 text-center">
            <p className="text-2xl font-bold font-heading text-green-700">{job.successItems}</p>
            <p className="text-xs text-green-600 mt-0.5">{job.type === "PRODUCTS" ? "Créés" : "Importées"}</p>
          </div>
          <div className={`rounded-xl p-3 border text-center ${job.errorItems > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
            <p className={`text-2xl font-bold font-heading ${job.errorItems > 0 ? "text-red-700" : "text-green-700"}`}>{job.errorItems}</p>
            <p className={`text-xs mt-0.5 ${job.errorItems > 0 ? "text-red-600" : "text-green-600"}`}>Erreurs</p>
          </div>
        </div>

        {/* Visual progress bar */}
        {job.totalItems > 0 && (
          <div className="mt-3">
            <div className="w-full h-3 bg-[#F0F0F0] rounded-full overflow-hidden flex">
              {successPct > 0 && (
                <div className="h-full bg-[#22C55E] transition-all" style={{ width: `${successPct}%` }} />
              )}
              {errorPct > 0 && (
                <div className="h-full bg-[#EF4444] transition-all" style={{ width: `${errorPct}%` }} />
              )}
            </div>
            <div className="flex justify-between text-xs mt-1.5">
              <span className="text-green-600">{Math.round(successPct)}% succès</span>
              {errorPct > 0 && <span className="text-red-600">{Math.round(errorPct)}% erreurs</span>}
            </div>
          </div>
        )}
      </div>

      {/* Processing progress */}
      {isProcessing && job.totalItems > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-center justify-between text-sm text-amber-800 mb-2">
            <span className="font-medium">Progression</span>
            <span>{job.processedItems} / {job.totalItems} traité(s)</span>
          </div>
          <div className="w-full h-2 bg-amber-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${job.totalItems > 0 ? (job.processedItems / job.totalItems) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* ── PRODUCT DETAILS TABLE ── */}
      {productDetails && productDetails.products.length > 0 && (
        <div>
          <p className="text-xs text-[#999] uppercase tracking-wide mb-3">
            Produits créés ({productDetails.products.length})
          </p>
          <div className="bg-bg-primary border border-border rounded-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_1.5fr_1fr_2fr] gap-2 px-4 py-2.5 bg-bg-secondary border-b border-border text-xs font-medium text-[#666] uppercase tracking-wide">
              <div>Référence</div>
              <div>Nom</div>
              <div>Catégorie</div>
              <div>Variantes</div>
            </div>
            {/* Rows */}
            <div className="divide-y divide-[#F0F0F0] max-h-[400px] overflow-y-auto">
              {productDetails.products.map((p, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1.5fr_1fr_2fr] gap-2 px-4 py-3 items-start">
                  <p className="font-mono text-sm font-semibold text-text-primary">{p.reference}</p>
                  <p className="text-sm text-text-primary truncate">{p.name}</p>
                  <p className="text-sm text-[#666]">{p.category || "—"}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.variants.map((v, vi) => (
                      <span
                        key={vi}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-bg-secondary border border-border text-[#444]"
                      >
                        <span className="font-medium">{v.color}</span>
                        <span className="text-[10px] text-[#999]">
                          {v.saleType === "PACK" ? `Pack ×${v.packQuantity ?? "?"}` : `${v.unitPrice}€`}
                        </span>
                        <span className="text-[10px] text-[#999]">· {v.stock} en stock</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── IMAGE DETAILS TABLE ── */}
      {imagesByRef && Object.keys(imagesByRef).length > 0 && (
        <div>
          <p className="text-xs text-[#999] uppercase tracking-wide mb-3">
            Images importées ({imageDetails!.images.length}) — {Object.keys(imagesByRef).length} référence(s)
          </p>
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {Object.entries(imagesByRef).map(([ref, imgs]) => (
              <div key={ref} className="bg-bg-primary border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-bg-secondary border-b border-border flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-text-primary">{ref}</span>
                  <span className="text-xs text-[#666]">{imgs.length} image(s)</span>
                </div>
                <div className="divide-y divide-[#F0F0F0]">
                  {imgs.map((img, ii) => (
                    <div key={ii} className="grid grid-cols-[2fr_1.5fr_auto] gap-3 px-4 py-2.5 items-center">
                      <p className="text-xs text-[#444] break-all leading-tight">{img.filename}</p>
                      <div className="flex items-center gap-2">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-bg-secondary border border-border text-text-primary">
                          {img.color}
                        </span>
                      </div>
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-bg-secondary border border-border text-xs font-bold text-text-primary">
                        {img.position}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No details available (older jobs before this feature) */}
      {!details && job.status === "COMPLETED" && (
        <p className="text-sm text-[#999] italic">
          Détails non disponibles pour cet import (importé avant la mise à jour).
        </p>
      )}

      {/* Error message for failed jobs */}
      {job.status === "FAILED" && job.errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-xs text-red-500 uppercase tracking-wide font-medium mb-1">Message d&apos;erreur</p>
          <p className="text-sm text-red-700 break-all">{job.errorMessage}</p>
        </div>
      )}

      {/* Draft link */}
      {job.errorDraftId && job.draft && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-amber-800">
              {job.draft.status === "RESOLVED" ? "Brouillon corrigé" : `${job.draft.errorRows} ligne(s) en erreur dans le brouillon`}
            </p>
            {job.draft.successRows > 0 && (
              <p className="text-xs text-amber-700 mt-0.5">
                {job.draft.successRows} corrigée(s) manuellement
              </p>
            )}
          </div>
          <Link
            href={`/admin/produits/importer/brouillon/${job.errorDraftId}`}
            className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
              job.draft.status === "RESOLVED"
                ? "bg-green-100 text-green-700 hover:bg-green-200"
                : "bg-amber-200 text-amber-900 hover:bg-amber-300"
            }`}
          >
            {job.draft.status === "RESOLVED" ? "Voir le brouillon" : "Corriger les erreurs →"}
          </Link>
        </div>
      )}
    </div>
  );
}
