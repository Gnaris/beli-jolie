"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useProductStream, type ProductEvent } from "@/hooks/useProductStream";

interface ImportProgress {
  jobId: string;
  processed: number;
  total: number;
  success: number;
  errors: number;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
}

export default function ImportProgressBanner() {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  // Listen for IMPORT_PROGRESS events via SSE
  useProductStream(useCallback((event: ProductEvent) => {
    if (event.type !== "IMPORT_PROGRESS" || !event.importProgress) return;

    const p = event.importProgress;
    setProgress(p);
    setDismissed(false);

    if (p.status === "COMPLETED" || p.status === "FAILED") {
      setShowCompleted(true);
    }
  }, []));

  // Also check for active import on mount (polling once)
  useEffect(() => {
    fetch("/api/admin/import-jobs")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data?.jobs) return;
        const active = data.jobs.find(
          (j: { status: string; type: string }) =>
            (j.status === "PROCESSING" || j.status === "PENDING") && j.type === "PRODUCTS"
        );
        if (active && !progress) {
          setProgress({
            jobId: active.id,
            processed: active.processedItems ?? 0,
            total: active.totalItems ?? 0,
            success: active.successItems ?? 0,
            errors: active.errorItems ?? 0,
            status: "PROCESSING",
          });
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss completed banner after 8 seconds
  useEffect(() => {
    if (!showCompleted) return;
    const timer = setTimeout(() => setDismissed(true), 8000);
    return () => clearTimeout(timer);
  }, [showCompleted]);

  if (!progress || dismissed) return null;

  const isProcessing = progress.status === "PROCESSING";
  const isCompleted = progress.status === "COMPLETED";
  const isFailed = progress.status === "FAILED";
  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div
      className={`rounded-xl border px-4 py-3 animate-fadeIn ${
        isProcessing
          ? "bg-blue-50 border-blue-200"
          : isCompleted
          ? "bg-green-50 border-green-200"
          : "bg-red-50 border-red-200"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Icon */}
          {isProcessing ? (
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : isCompleted ? (
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}

          {/* Text */}
          <div className="min-w-0">
            <p className={`text-sm font-medium font-body ${
              isProcessing ? "text-blue-800" : isCompleted ? "text-green-800" : "text-red-800"
            }`}>
              {isProcessing
                ? "Importation en cours..."
                : isCompleted
                ? "Importation termin\u00e9e !"
                : "Erreur d'importation"
              }
            </p>
            <p className={`text-xs font-body ${
              isProcessing ? "text-blue-600" : isCompleted ? "text-green-600" : "text-red-600"
            }`}>
              {isProcessing
                ? `${progress.processed}/${progress.total} produits trait\u00e9s \u2014 ${progress.success} cr\u00e9\u00e9s${progress.errors > 0 ? `, ${progress.errors} erreur${progress.errors > 1 ? "s" : ""}` : ""}`
                : isCompleted
                ? `${progress.success} produit${progress.success > 1 ? "s" : ""} cr\u00e9\u00e9${progress.success > 1 ? "s" : ""}${progress.errors > 0 ? ` \u2014 ${progress.errors} erreur${progress.errors > 1 ? "s" : ""}` : ""}`
                : "L'importation a \u00e9chou\u00e9. V\u00e9rifiez les logs."
              }
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* View errors link */}
          {(isCompleted || isFailed) && progress.errors > 0 && (
            <Link
              href="/admin/produits/importer/historique"
              className={`text-xs font-medium font-body px-2.5 py-1 rounded-lg border transition-colors ${
                isCompleted
                  ? "text-green-700 border-green-300 hover:bg-green-100"
                  : "text-red-700 border-red-300 hover:bg-red-100"
              }`}
            >
              Voir les erreurs
            </Link>
          )}

          {/* Dismiss */}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className={`p-1 rounded-md transition-colors ${
              isProcessing ? "text-blue-400 hover:text-blue-600 hover:bg-blue-100" : isCompleted ? "text-green-400 hover:text-green-600 hover:bg-green-100" : "text-red-400 hover:text-red-600 hover:bg-red-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {isProcessing && progress.total > 0 && (
        <div className="mt-2.5 h-1.5 bg-blue-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
