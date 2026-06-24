"use client";

import type { PreviewState } from "./MarketplaceExportButton";
import type { ExportMode } from "@/lib/marketplace-excel/types";

interface Props {
  preview: PreviewState;
  isDownloading: boolean;
  mode: ExportMode;
  onModeChange: (mode: ExportMode) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

interface ModeOption {
  value: ExportMode;
  label: string;
  hint: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: "both",
    label: "Fiche produit + images",
    hint: "Le fichier Excel et toutes les photos dans un ZIP.",
  },
  {
    value: "excel-only",
    label: "Fiche produit uniquement",
    hint: "Seulement le fichier Excel, sans les photos.",
  },
  {
    value: "images-only",
    label: "Images uniquement",
    hint: "Seulement les photos, dans un ZIP, sans Excel.",
  },
];

export default function MarketplaceExportPreviewModal({
  preview,
  isDownloading,
  mode,
  onModeChange,
  onCancel,
  onConfirm,
}: Props) {
  const eligibleCount = preview.eligible.length;
  const ignoredCount = preview.ignored.length;
  const canConfirm = eligibleCount > 0 && !isDownloading;
  // Ankorstore ne supporte pas l'export d'images seules : les photos sont
  // récupérées via les URLs du site une fois l'Excel importé.
  const ankorstoreImagesDisabled = preview.marketplace === "ankorstore";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="font-heading font-bold text-lg text-text-primary">
              Exporter vers {preview.marketplaceLabel}
            </h3>
            <p className="text-sm text-text-secondary font-body mt-0.5">
              {eligibleCount} produit{eligibleCount > 1 ? "s" : ""} prêt
              {eligibleCount > 1 ? "s" : ""} à exporter
              {ignoredCount > 0
                ? ` · ${ignoredCount} ignoré${ignoredCount > 1 ? "s" : ""}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isDownloading}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors shrink-0 disabled:opacity-50"
            aria-label="Fermer"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
          {eligibleCount > 0 && (
            <div className="rounded-lg border border-border bg-bg-secondary/30 p-4">
              <p className="text-xs font-body font-semibold uppercase tracking-[0.12em] text-text-secondary mb-3">
                Que voulez-vous exporter ?
              </p>
              <div className="space-y-2">
                {MODE_OPTIONS.map((opt) => {
                  const disabled =
                    isDownloading ||
                    (opt.value === "images-only" && ankorstoreImagesDisabled);
                  const checked = mode === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                        disabled
                          ? "opacity-50 cursor-not-allowed border-border bg-bg-tertiary/30"
                          : checked
                            ? "border-bg-dark bg-bg-primary"
                            : "border-border bg-bg-primary hover:bg-bg-secondary/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="export-mode"
                        value={opt.value}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => onModeChange(opt.value)}
                        className="mt-0.5 accent-bg-dark"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-body font-semibold text-text-primary">
                          {opt.label}
                        </p>
                        <p className="text-xs font-body text-text-secondary mt-0.5">
                          {opt.hint}
                          {opt.value === "images-only" && ankorstoreImagesDisabled
                            ? " Indisponible pour Ankorstore : les photos sont récupérées via les URLs du site."
                            : ""}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {eligibleCount > 0 && (
            <div className="rounded-lg border border-success/30 bg-success/5 p-4">
              <p className="text-sm font-body font-semibold text-success">
                ✓ {eligibleCount} produit{eligibleCount > 1 ? "s" : ""} sera
                {eligibleCount > 1 ? "ont" : ""} dans l&apos;export
              </p>
            </div>
          )}

          {ignoredCount > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-body font-semibold text-amber-800 mb-2">
                ⚠ {ignoredCount} produit{ignoredCount > 1 ? "s" : ""} ignoré
                {ignoredCount > 1 ? "s" : ""} (champs manquants)
              </p>
              <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                {preview.ignored.map((i) => (
                  <li key={i.productId} className="text-xs font-body text-amber-900">
                    <strong>{i.reference}</strong> : {i.missing.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {eligibleCount === 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4">
              <p className="text-sm font-body font-semibold text-red-700">
                Aucun produit éligible. Corrigez les champs manquants puis relancez l&apos;export.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border bg-bg-secondary/30 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDownloading}
            className="px-4 py-2 text-sm font-body text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="px-5 py-2 text-sm font-body font-semibold text-white bg-bg-dark rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {isDownloading ? "Téléchargement…" : "Continuer l'export"}
          </button>
        </div>
      </div>
    </div>
  );
}
