"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ImportJob {
  id: string;
  type: "PRODUCTS" | "IMAGES";
  status: "PENDING" | "UPLOADING" | "PROCESSING" | "COMPLETED" | "FAILED";
  filename: string | null;
  totalItems: number;
  processedItems: number;
  successItems: number;
  errorItems: number;
  errorDraftId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function ImportProgressPanel() {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => { setMounted(true); }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/import-jobs");
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch {
      // Silently fail — will retry
    }
  }, []);

  // Poll every 3s when there are active jobs, 30s otherwise
  useEffect(() => {
    fetchJobs();
    const hasActive = jobs.some((j) => ["PENDING", "UPLOADING", "PROCESSING"].includes(j.status));
    const interval = setInterval(fetchJobs, hasActive ? 3000 : 30000);
    return () => clearInterval(interval);
  }, [fetchJobs, jobs.length > 0 && jobs.some((j) => ["PENDING", "UPLOADING", "PROCESSING"].includes(j.status))]);

  const visibleJobs = jobs.filter((j) => !dismissed.has(j.id));
  const activeJobs = visibleJobs.filter((j) => ["PENDING", "UPLOADING", "PROCESSING"].includes(j.status));
  const doneJobs = visibleJobs.filter((j) => ["COMPLETED", "FAILED"].includes(j.status));

  const dismiss = (id: string) => {
    setDismissed((prev) => new Set([...prev, id]));
  };

  if (!mounted || visibleJobs.length === 0) return null;

  const panel = (
    <div
      className="fixed bottom-0 right-0 z-[9980] lg:right-4 lg:bottom-4 w-full lg:w-[420px]"
      style={{ animation: "importPanelSlide 0.25s ease-out" }}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-[#1A1A1A] text-white rounded-t-xl lg:rounded-t-2xl cursor-pointer hover:bg-[#2A2A2A] transition-colors"
      >
        {/* Animated icon for active jobs */}
        {activeJobs.length > 0 ? (
          <div className="relative w-5 h-5 shrink-0">
            <svg className="w-5 h-5 animate-spin text-white/60" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : (
          <svg className="w-5 h-5 text-[#22C55E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}

        <div className="flex-1 text-left">
          <span className="text-sm font-medium font-[family-name:var(--font-roboto)]">
            {activeJobs.length > 0
              ? `Import en cours${activeJobs.length > 1 ? ` (${activeJobs.length})` : ""}`
              : "Imports terminés"}
          </span>
          {activeJobs.length === 1 && (
            <span className="text-xs text-white/50 ml-2">
              {activeJobs[0].processedItems}/{activeJobs[0].totalItems || "?"}
            </span>
          )}
        </div>

        {/* Mini progress bar for collapsed state */}
        {collapsed && activeJobs.length > 0 && (
          <div className="w-16 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#22C55E] rounded-full transition-all duration-500"
              style={{
                width: `${activeJobs[0].totalItems > 0 ? (activeJobs[0].processedItems / activeJobs[0].totalItems) * 100 : 0}%`,
              }}
            />
          </div>
        )}

        <svg
          className={`w-4 h-4 text-white/50 transition-transform duration-200 shrink-0 ${collapsed ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="bg-bg-primary border border-t-0 border-border rounded-b-xl lg:rounded-b-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.12)] max-h-[400px] overflow-y-auto">
          <div className="divide-y divide-[#F0F0F0]">
            {/* Active jobs first */}
            {activeJobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
            {/* Then completed/failed */}
            {doneJobs.map((job) => (
              <JobRow key={job.id} job={job} onDismiss={() => dismiss(job.id)} />
            ))}
          </div>
          {/* History link */}
          <div className="px-4 py-2 border-t border-[#F0F0F0]">
            <Link
              href="/admin/produits/importer/historique"
              className="text-xs text-[#999] hover:text-[#1A1A1A] transition-colors"
            >
              Voir tout l'historique →
            </Link>
          </div>
        </div>
      )}
    </div>
  );

  return mounted ? createPortal(panel, document.body) : null;
}

// ─────────────────────────────────────────────
// Job Row
// ─────────────────────────────────────────────

function JobRow({ job, onDismiss }: { job: ImportJob; onDismiss?: () => void }) {
  const isActive = ["PENDING", "UPLOADING", "PROCESSING"].includes(job.status);
  const isFailed = job.status === "FAILED";
  const isCompleted = job.status === "COMPLETED";
  const progress = job.totalItems > 0 ? (job.processedItems / job.totalItems) * 100 : 0;

  const typeLabel = job.type === "PRODUCTS" ? "Produits" : "Images";
  const typeIcon = job.type === "PRODUCTS" ? (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
    </svg>
  );

  const statusLabel = job.status === "PENDING"
    ? "En attente…"
    : job.status === "UPLOADING"
    ? "Upload en cours…"
    : job.status === "PROCESSING"
    ? `${job.processedItems}/${job.totalItems}`
    : job.status === "COMPLETED"
    ? `${job.successItems} importé${job.successItems > 1 ? "s" : ""}`
    : "Échec";

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`mt-0.5 shrink-0 ${isFailed ? "text-[#EF4444]" : isCompleted ? "text-[#22C55E]" : "text-[#666]"}`}>
          {typeIcon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)]">
              {typeLabel}
            </span>
            {job.filename && (
              <span className="text-xs text-[#999] truncate max-w-[150px]">{job.filename}</span>
            )}
          </div>

          {/* Progress bar for active jobs */}
          {isActive && (
            <div className="mt-2">
              <div className="w-full h-2 bg-[#F0F0F0] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${Math.max(progress, job.status === "PENDING" ? 0 : 2)}%`,
                    background: "linear-gradient(90deg, #1A1A1A, #444)",
                  }}
                />
              </div>
              <p className="text-xs text-[#999] mt-1 font-[family-name:var(--font-roboto)]">
                {statusLabel}
                {job.totalItems > 0 && ` · ${Math.round(progress)}%`}
              </p>
            </div>
          )}

          {/* Completed summary */}
          {isCompleted && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[#22C55E] font-medium">{statusLabel}</span>
              {job.errorItems > 0 && (
                <>
                  <span className="text-xs text-[#EF4444]">· {job.errorItems} erreur{job.errorItems > 1 ? "s" : ""}</span>
                  {job.errorDraftId && (
                    <Link
                      href={`/admin/produits/importer/brouillon/${job.errorDraftId}`}
                      className="text-xs text-[#1A1A1A] underline hover:no-underline font-medium"
                    >
                      Corriger →
                    </Link>
                  )}
                </>
              )}
            </div>
          )}

          {/* Failed */}
          {isFailed && (
            <p className="mt-1 text-xs text-[#EF4444]">
              {job.errorMessage || "Une erreur est survenue."}
            </p>
          )}
        </div>

        {/* Dismiss button for completed/failed */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="mt-0.5 shrink-0 p-1 rounded-lg hover:bg-[#F7F7F8] transition-colors text-[#999] hover:text-[#666]"
            aria-label="Fermer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
