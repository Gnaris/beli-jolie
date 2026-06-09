"use client";

/**
 * ImageProcessingWidget
 *
 * Widget flottant en bas à gauche de l'admin (côté opposé du widget
 * marketplace pour éviter la collision) qui affiche en temps réel l'état du
 * worker `lib/image-queue.ts`. Apparaît dès qu'un job PENDING/PROCESSING
 * existe, se replie automatiquement quand tout est traité, propose un
 * Retry pour les FAILED.
 *
 * Design : pastille orange pulsante, barre de progression dégradée, panneau
 * dépliable au survol/clic, animation fluide. Pas agressif — on est dans
 * l'admin et l'utilisatrice doit pouvoir bosser sans être distraite.
 */

import { useEffect, useMemo, useState } from "react";
import { useImageProcessing, type ImageJobRow } from "./ImageProcessingContext";

export function ImageProcessingWidget() {
  const { jobs, counts, hasActiveWork, retry } = useImageProcessing();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Dès qu'un nouveau travail démarre, on ré-arme le widget (annule la fermeture
  // manuelle précédente) pour que l'utilisatrice voit la progression.
  useEffect(() => {
    if (hasActiveWork) setDismissed(false);
  }, [hasActiveWork]);

  const visible = useMemo(() => {
    if (dismissed) return false;
    if (hasActiveWork) return true;
    if (counts.failed > 0) return true; // garde affiché tant qu'il y a des erreurs
    return false; // tout est traité sans erreur → on disparaît
  }, [dismissed, hasActiveWork, counts.failed]);

  const failedJobs = useMemo(
    () => jobs.filter((j) => j.status === "FAILED").slice(0, 8),
    [jobs],
  );

  if (!visible) return null;

  const active = counts.pending + counts.processing;
  const processed = counts.done + counts.failed;
  const totalSeen = active + processed;
  const percent = totalSeen === 0 ? 100 : Math.round((processed / totalSeen) * 100);

  return (
    <div
      className="fixed bottom-4 left-4 z-40 w-[340px] font-body select-none"
      role="status"
      aria-live="polite"
    >
      <div className="bg-white border border-[#FED7AA] rounded-xl shadow-lg overflow-hidden">
        {/* Header — clic pour replier/déplier */}
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex-1 flex items-center gap-3 px-3.5 py-3 text-left hover:bg-[#FFF7ED] transition-colors min-w-0"
          >
            {/* Pastille orange (pulsante si actif) */}
            <span className="relative inline-flex shrink-0">
              <span
                className={`w-2.5 h-2.5 rounded-full bg-[#F97316] ${
                  hasActiveWork ? "animate-pulse" : ""
                }`}
              />
              {hasActiveWork && (
                <span className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-[#F97316] opacity-60 animate-ping" />
              )}
            </span>

            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-[#9A3412] truncate">
                {hasActiveWork
                  ? `${processed} / ${totalSeen} images traitées`
                  : `${counts.failed} image${counts.failed > 1 ? "s" : ""} en erreur`}
              </div>
              <div className="text-[10.5px] text-[#9A3412]/70 truncate">
                {hasActiveWork
                  ? counts.processing > 0
                    ? `${counts.processing} en cours · ${counts.pending} en attente`
                    : `${counts.pending} en attente de démarrage`
                  : "Cliquez pour voir les détails"}
              </div>
            </div>

            <svg
              className={`w-3.5 h-3.5 text-[#9A3412] transition-transform shrink-0 ${
                expanded ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2.2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {/* Croix de fermeture — masque le widget jusqu'au prochain travail */}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 px-2.5 flex items-center justify-center text-[#9A3412]/60 hover:text-[#9A3412] hover:bg-[#FFF7ED] transition-colors border-l border-[#FED7AA]"
            aria-label="Fermer ce panneau"
            title="Fermer"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2.4}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Barre de progression dégradée */}
        <div className="h-1 bg-[#FFF7ED]" aria-hidden="true">
          <div
            className="h-full bg-gradient-to-r from-[#F97316] via-[#FB923C] to-[#FCA5A5] transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Liste des FAILED — dépliable */}
        {expanded && failedJobs.length > 0 && (
          <div className="border-t border-[#FED7AA] bg-[#FFFBEB] max-h-[280px] overflow-y-auto">
            <div className="px-3.5 py-2 text-[10px] uppercase tracking-wider text-[#9A3412]/70 font-semibold">
              Images en erreur — cliquez pour réessayer
            </div>
            <ul className="divide-y divide-[#FED7AA]/60">
              {failedJobs.map((job) => (
                <FailedJobRow key={job.id} job={job} onRetry={retry} />
              ))}
            </ul>
          </div>
        )}

        {expanded && failedJobs.length === 0 && !hasActiveWork && (
          <div className="border-t border-[#FED7AA] bg-[#F0FDF4] px-3.5 py-3 text-[11.5px] text-[#15803D] font-medium">
            ✓ Toutes les images ont été traitées avec succès.
          </div>
        )}
      </div>
    </div>
  );
}

function FailedJobRow({
  job,
  onRetry,
}: {
  job: ImageJobRow;
  onRetry: (jobId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="px-3.5 py-2 flex items-start gap-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-[#9A3412] truncate">
          Job {job.id.slice(0, 8)}…
        </div>
        <div className="text-[10.5px] text-[#9A3412]/70 line-clamp-2 break-words">
          {job.error || "Erreur inconnue"}
        </div>
      </div>
      <button
        type="button"
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await onRetry(job.id);
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold border transition-colors ${
          busy
            ? "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A] cursor-wait"
            : "bg-white text-[#9A3412] border-[#FED7AA] hover:bg-[#FFF7ED]"
        }`}
        aria-label="Relancer ce traitement"
      >
        <svg
          className={`w-3 h-3 ${busy ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.4}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
        {busy ? "…" : "Réessayer"}
      </button>
    </li>
  );
}
