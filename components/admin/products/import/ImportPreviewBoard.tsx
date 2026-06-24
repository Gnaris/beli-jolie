"use client";

/**
 * Tableau de bord pré-import en 3 colonnes :
 *
 *   ┌──────────────┬──────────────┬──────────────────────────────┐
 *   │   Succès     │  À corriger  │  Introuvable                 │
 *   │   (prêt)     │  (action)    │  ├─ Format incorrect         │
 *   │              │              │  └─ Référence inexistante    │
 *   └──────────────┴──────────────┴──────────────────────────────┘
 *
 * - Succès      : référence trouvée + couleur trouvée + position libre.
 * - À corriger  : référence trouvée mais couleur absente du produit OU
 *                 position déjà occupée. Actions inline : choisir une
 *                 couleur du produit (parmi celles déjà sur la fiche),
 *                 choisir une stratégie de conflit, modifier la position.
 * - Introuvable : deux sous-sections distinctes —
 *                 (a) Format incorrect → nom de fichier ne respecte pas
 *                     « {reference} {couleur} {position} » (ou avec
 *                     underscores).
 *                 (b) Référence inexistante → format OK mais aucune fiche
 *                     produit ne porte cette référence en BDD.
 *
 * Le composant reste purement présentationnel : tous les états et
 * actions sont passés en props depuis ImportImagesTab.tsx (qui détient
 * l'état métier et les hooks).
 */

import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "@/components/ui/SmartImage";
import ColorSwatch from "@/components/ui/ColorSwatch";

export type ConflictStrategy = "replace" | "next_available" | "shift";

export interface ConflictInfo {
  filename: string;
  reference: string;
  color: string;
  position: number;
  existingImagePath: string;
  availablePositions: number[];
}

export interface AvailableColor {
  id: string;
  colorId: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
}

export interface MissingColorInfo {
  filename: string;
  reference: string;
  color: string;
  position: number;
  productId: string;
  productName: string;
  availableColors: AvailableColor[];
}

export interface MissingRefInfo {
  filename: string;
  reference: string;
  color: string;
  position: number;
}

export interface FileOverride {
  position?: number;
  color?: string;
}

export interface PreviewFile {
  name: string;
  url: string;
  /** Couleur lue dans le nom de fichier ; "—" si format invalide. */
  color: string;
  /** Position lue dans le nom ; 0 si format invalide. */
  position: number;
  /** true si parseFilename a réussi. */
  valid: boolean;
  /** Référence parsée en MAJUSCULES ; "" si format invalide. */
  reference: string;
}

interface Props {
  files: PreviewFile[];
  conflicts: ConflictInfo[];
  missingColors: MissingColorInfo[];
  missingRefs: MissingRefInfo[];
  overrides: Map<string, FileOverride>;
  perFileResolutions: Map<string, { filename: string; strategy: ConflictStrategy }>;
  defaultStrategy: ConflictStrategy;
  onDefaultStrategyChange: (s: ConflictStrategy) => void;
  onResolutionChange: (filename: string, strategy: ConflictStrategy) => void;
  /** Force la couleur (et invalide la précédente) sur un fichier. */
  onColorOverride: (filename: string, colorName: string) => void;
  /** Modifie la position cible d'un fichier (1-10). */
  onPositionOverride: (filename: string, position: number) => void;
  /** Retire un fichier de la liste à importer. */
  onRemoveFile: (filename: string) => void;
}

const STRATEGY_LABELS: Record<ConflictStrategy, string> = {
  replace: "Remplacer",
  shift: "Décaler",
  next_available: "Position suivante",
};
const STRATEGY_DESCRIPTIONS: Record<ConflictStrategy, string> = {
  replace: "L'image existante à cette position est supprimée et remplacée par la nouvelle.",
  shift: "L'image existante glisse d'un cran (et les suivantes si besoin). La nouvelle prend la position du nom de fichier.",
  next_available: "L'existante ne bouge pas. La nouvelle va à la première position libre après celle demandée.",
};

export default function ImportPreviewBoard({
  files,
  conflicts,
  missingColors,
  missingRefs,
  overrides,
  perFileResolutions,
  defaultStrategy,
  onDefaultStrategyChange,
  onResolutionChange,
  onColorOverride,
  onPositionOverride,
  onRemoveFile,
}: Props) {
  // ─── Tri en 3 buckets ─────────────────────────────────────────────
  const buckets = useMemo(() => {
    const conflictByFile = new Map(conflicts.map((c) => [c.filename, c]));
    const missingColorByFile = new Map(missingColors.map((m) => [m.filename, m]));
    const missingRefByFile = new Map(missingRefs.map((m) => [m.filename, m]));

    const ok: PreviewFile[] = [];
    const toFixConflicts: { file: PreviewFile; conflict: ConflictInfo }[] = [];
    const toFixMissingColor: { file: PreviewFile; missing: MissingColorInfo }[] = [];
    const notFoundFormat: PreviewFile[] = [];
    const notFoundRef: { file: PreviewFile; missing: MissingRefInfo }[] = [];

    for (const f of files) {
      if (!f.valid) {
        notFoundFormat.push(f);
        continue;
      }
      const mRef = missingRefByFile.get(f.name);
      if (mRef) {
        notFoundRef.push({ file: f, missing: mRef });
        continue;
      }
      const mColor = missingColorByFile.get(f.name);
      if (mColor) {
        toFixMissingColor.push({ file: f, missing: mColor });
        continue;
      }
      const c = conflictByFile.get(f.name);
      if (c) {
        toFixConflicts.push({ file: f, conflict: c });
        continue;
      }
      ok.push(f);
    }

    return { ok, toFixConflicts, toFixMissingColor, notFoundFormat, notFoundRef };
  }, [files, conflicts, missingColors, missingRefs]);

  const okGroups = useMemo(() => {
    const m = new Map<string, PreviewFile[]>();
    for (const f of buckets.ok) {
      const ref = f.reference || "—";
      if (!m.has(ref)) m.set(ref, []);
      m.get(ref)!.push(f);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [buckets.ok]);

  const toFixCount = buckets.toFixConflicts.length + buckets.toFixMissingColor.length;
  const notFoundCount = buckets.notFoundFormat.length + buckets.notFoundRef.length;

  const effectiveColor = (file: PreviewFile) => overrides.get(file.name)?.color ?? file.color;
  const effectivePosition = (file: PreviewFile) =>
    overrides.get(file.name)?.position ?? file.position;

  // ─── États collapse + lightbox ───────────────────────────────────
  const [closedOkRefs, setClosedOkRefs] = useState<Set<string>>(new Set());
  const [notFoundClosed, setNotFoundClosed] = useState<{ format: boolean; ref: boolean }>({ format: false, ref: false });
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  const hasFormat = buckets.notFoundFormat.length > 0;
  const hasRef = buckets.notFoundRef.length > 0;

  const allOkClosed = okGroups.length > 0 && okGroups.every(([r]) => closedOkRefs.has(r));
  const toggleAllOk = () => {
    if (allOkClosed) {
      setClosedOkRefs(new Set());
    } else {
      setClosedOkRefs(new Set(okGroups.map(([r]) => r)));
    }
  };
  const toggleOkRef = (ref: string) => {
    setClosedOkRefs((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  const allNotFoundClosed =
    (hasFormat || hasRef) &&
    (!hasFormat || notFoundClosed.format) &&
    (!hasRef || notFoundClosed.ref);
  const toggleAllNotFound = () => {
    if (allNotFoundClosed) {
      setNotFoundClosed({ format: false, ref: false });
    } else {
      setNotFoundClosed({ format: hasFormat, ref: hasRef });
    }
  };

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {/* ═══════════════════════════════════════════════════════════
          Colonne 1 — Succès
          ═══════════════════════════════════════════════════════════ */}
      <div className="relative bg-bg-primary border border-emerald-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 to-emerald-600 pointer-events-none" />
        <div className="absolute -top-10 -right-10 w-24 h-24 rounded-full blur-3xl bg-emerald-300/30 pointer-events-none" />
        <div className="relative px-5 pt-5 pb-3 border-b border-emerald-100">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100/80 border border-emerald-200 text-[10px] font-body font-semibold uppercase tracking-[0.18em] text-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Prêt à partir
            </span>
            <span className="ml-auto font-heading text-2xl font-bold tabular-nums text-emerald-700">
              {buckets.ok.length}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3 mt-2">
            <p className="text-[11px] text-text-muted font-body leading-relaxed flex-1">
              Référence, couleur et position OK. Ces images partent telles quelles.
            </p>
            {okGroups.length > 0 && (
              <button
                type="button"
                onClick={toggleAllOk}
                className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-bg-primary border border-emerald-200 text-emerald-800 font-body font-medium hover:border-emerald-500 hover:bg-emerald-50/60 transition-colors"
              >
                {allOkClosed ? "Tout ouvrir" : "Tout fermer"}
              </button>
            )}
          </div>
        </div>

        <div className="relative flex-1 overflow-y-auto max-h-[560px]">
          {okGroups.length === 0 ? (
            <EmptyState label="Aucune image prête pour l'instant." />
          ) : (
            <div className="divide-y divide-emerald-50">
              {okGroups.map(([ref, group]) => {
                const isClosed = closedOkRefs.has(ref);
                return (
                  <div key={ref}>
                    <button
                      type="button"
                      onClick={() => toggleOkRef(ref)}
                      className="w-full px-5 py-2.5 bg-emerald-50/40 cursor-pointer flex items-center gap-2 select-none hover:bg-emerald-50/70 transition-colors text-left"
                      aria-expanded={!isClosed}
                    >
                      <svg
                        className={`w-3.5 h-3.5 text-emerald-600 transition-transform ${isClosed ? "" : "rotate-90"}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="font-mono text-xs font-semibold text-text-primary">{ref}</span>
                      <span className="text-[10px] text-text-muted font-body">
                        · {group.length} image{group.length > 1 ? "s" : ""}
                      </span>
                    </button>
                    {!isClosed && (
                      <ul className="divide-y divide-emerald-50/60">
                        {group.map((f) => (
                          <li key={f.name} className="px-5 py-2 flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setLightbox({ url: f.url, name: f.name })}
                              className="relative w-10 h-10 rounded-lg overflow-hidden border border-emerald-100 bg-bg-secondary shrink-0 cursor-zoom-in hover:ring-2 hover:ring-emerald-400 transition-all"
                              aria-label={`Agrandir ${f.name}`}
                            >
                              <Image src={f.url} alt={f.name} fill className="object-cover" unoptimized />
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-text-secondary font-body truncate">{f.name}</p>
                              <p className="text-[10px] text-text-muted font-body mt-0.5">
                                {effectiveColor(f)} · Position {effectivePosition(f)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => onRemoveFile(f.name)}
                              className="text-[10px] text-text-muted hover:text-red-600 font-body shrink-0"
                              title="Retirer cette image de l'import"
                            >
                              Retirer
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          Colonne 2 — À corriger
          ═══════════════════════════════════════════════════════════ */}
      <div className="relative bg-bg-primary border border-amber-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 to-amber-600 pointer-events-none" />
        <div className="absolute -top-10 -right-10 w-24 h-24 rounded-full blur-3xl bg-amber-300/30 pointer-events-none" />
        <div className="relative px-5 pt-5 pb-3 border-b border-amber-100">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100/80 border border-amber-200 text-[10px] font-body font-semibold uppercase tracking-[0.18em] text-amber-800">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Action nécessaire
            </span>
            <span className="ml-auto font-heading text-2xl font-bold tabular-nums text-amber-700">
              {toFixCount}
            </span>
          </div>
          <p className="text-[11px] text-text-muted font-body mt-2 leading-relaxed">
            Référence trouvée. Choisissez la couleur ou la stratégie de conflit pour chaque image.
          </p>

          {/* Stratégie par défaut (affichée seulement s'il y a des conflits de position) */}
          {buckets.toFixConflicts.length > 0 && (
            <div className="mt-3 p-3 bg-amber-50/60 border border-amber-100 rounded-xl">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[10px] font-body font-semibold uppercase tracking-wider text-amber-800">
                  Stratégie de conflit par défaut
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(STRATEGY_LABELS) as ConflictStrategy[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onDefaultStrategyChange(s)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border font-body font-medium transition-all ${
                      s === defaultStrategy
                        ? "bg-amber-700 text-white border-amber-700 shadow-sm"
                        : "bg-bg-primary text-amber-800 border-amber-300 hover:border-amber-500"
                    }`}
                  >
                    {STRATEGY_LABELS[s]}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-amber-700 font-body italic mt-2 leading-snug">
                {STRATEGY_DESCRIPTIONS[defaultStrategy]}
              </p>
            </div>
          )}
        </div>

        <div className="relative flex-1 overflow-y-auto max-h-[560px]">
          {toFixCount === 0 ? (
            <EmptyState label="Aucune action requise. 🎉" />
          ) : (
            <ul className="divide-y divide-amber-50">
              {/* Couleurs manquantes */}
              {buckets.toFixMissingColor.map(({ file, missing }) => (
                <li key={`mc-${file.name}`} className="px-5 py-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setLightbox({ url: file.url, name: file.name })}
                      className="relative w-12 h-12 rounded-lg overflow-hidden border border-amber-100 bg-bg-secondary shrink-0 cursor-zoom-in hover:ring-2 hover:ring-amber-400 transition-all"
                      aria-label={`Agrandir ${file.name}`}
                    >
                      <Image src={file.url} alt={file.name} fill className="object-cover" unoptimized />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-text-primary font-body truncate font-medium">
                        {file.name}
                      </p>
                      <p className="text-[10px] text-text-muted font-body mt-0.5">
                        <span className="font-mono">{file.reference}</span> · cherchait « {file.color} »
                      </p>
                      <p className="text-[11px] text-amber-700 font-body mt-1 leading-snug">
                        Cette couleur n&apos;existe pas sur le produit. Choisissez parmi celles disponibles :
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveFile(file.name)}
                      className="text-[10px] text-text-muted hover:text-red-600 font-body shrink-0"
                      title="Retirer cette image de l'import"
                    >
                      Retirer
                    </button>
                  </div>
                  {missing.availableColors.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pl-[60px]">
                      {missing.availableColors.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onColorOverride(file.name, c.name)}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-primary border border-amber-200 hover:border-amber-500 hover:shadow-sm transition-all text-[11px] font-body"
                        >
                          <ColorSwatch hex={c.hex ?? "#9CA3AF"} patternImage={c.patternImage} size={14} rounded="full" />
                          <span className="text-text-primary">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="pl-[60px]">
                      <p className="text-[11px] text-amber-700 font-body italic leading-snug">
                        Ce produit n&apos;a aucune couleur enregistrée. Ajoutez-en une depuis la fiche produit puis réimportez l&apos;image.
                      </p>
                    </div>
                  )}
                </li>
              ))}

              {/* Conflits de position */}
              {buckets.toFixConflicts.map(({ file, conflict }) => {
                const strat = perFileResolutions.get(file.name)?.strategy ?? defaultStrategy;
                return (
                  <li key={`cf-${file.name}`} className="px-5 py-3 space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setLightbox({ url: file.url, name: file.name })}
                          className="w-12 h-12 rounded-lg overflow-hidden border border-amber-100 bg-bg-secondary cursor-zoom-in hover:ring-2 hover:ring-amber-400 transition-all"
                          aria-label={`Agrandir ${file.name}`}
                        >
                          <div className="relative w-full h-full">
                            <Image src={file.url} alt={file.name} fill className="object-cover" unoptimized />
                          </div>
                        </button>
                        {/* Pile : ancienne image en arrière-plan, nouvelle au-dessus */}
                        <button
                          type="button"
                          onClick={() => setLightbox({ url: `/${conflict.existingImagePath}`, name: "Image existante" })}
                          className="absolute -bottom-1 -right-1 w-7 h-7 rounded-md overflow-hidden border border-amber-300 bg-amber-50 ring-2 ring-bg-primary cursor-zoom-in hover:ring-amber-500 transition-all"
                          aria-label="Agrandir l'image existante"
                        >
                          <div className="relative w-full h-full">
                            <Image src={`/${conflict.existingImagePath}`} alt="existante" fill className="object-cover" unoptimized />
                          </div>
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-text-primary font-body truncate font-medium">
                          {file.name}
                        </p>
                        <p className="text-[10px] text-text-muted font-body mt-0.5">
                          <span className="font-mono">{file.reference}</span> · {file.color} · Position {file.position}
                        </p>
                        <p className="text-[11px] text-amber-700 font-body mt-1 leading-snug">
                          Une image existe déjà à cette position.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveFile(file.name)}
                        className="text-[10px] text-text-muted hover:text-red-600 font-body shrink-0"
                      >
                        Retirer
                      </button>
                    </div>
                    <div className="pl-[60px] flex flex-wrap items-center gap-1.5">
                      {(Object.keys(STRATEGY_LABELS) as ConflictStrategy[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => onResolutionChange(file.name, s)}
                          className={`text-[11px] px-2 py-1 rounded-md border font-body transition-all ${
                            s === strat
                              ? "bg-amber-700 text-white border-amber-700"
                              : "bg-bg-primary text-text-secondary border-amber-200 hover:border-amber-500"
                          }`}
                        >
                          {STRATEGY_LABELS[s]}
                        </button>
                      ))}
                      {conflict.availablePositions.length > 0 && (
                        <PositionPicker
                          current={effectivePosition(file)}
                          available={conflict.availablePositions}
                          onPick={(p) => onPositionOverride(file.name, p)}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          Colonne 3 — Introuvable
          ═══════════════════════════════════════════════════════════ */}
      <div className="relative bg-bg-primary border border-rose-200 rounded-2xl overflow-hidden shadow-sm flex flex-col md:col-span-2 xl:col-span-1">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-400 to-rose-600 pointer-events-none" />
        <div className="absolute -top-10 -right-10 w-24 h-24 rounded-full blur-3xl bg-rose-300/30 pointer-events-none" />
        <div className="relative px-5 pt-5 pb-3 border-b border-rose-100">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-100/80 border border-rose-200 text-[10px] font-body font-semibold uppercase tracking-[0.18em] text-rose-800">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              Introuvable
            </span>
            <span className="ml-auto font-heading text-2xl font-bold tabular-nums text-rose-700">
              {notFoundCount}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3 mt-2">
            <p className="text-[11px] text-text-muted font-body leading-relaxed flex-1">
              Fichiers mal nommés ou références qui n&apos;existent pas. <strong className="text-rose-700">Ignorés au lancement</strong> — renommez-les pour les inclure.
            </p>
            {(hasFormat || hasRef) && (
              <button
                type="button"
                onClick={toggleAllNotFound}
                className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-bg-primary border border-rose-200 text-rose-800 font-body font-medium hover:border-rose-500 hover:bg-rose-50/60 transition-colors"
              >
                {allNotFoundClosed ? "Tout ouvrir" : "Tout fermer"}
              </button>
            )}
          </div>
        </div>

        <div className="relative flex-1 overflow-y-auto max-h-[560px]">
          {notFoundCount === 0 ? (
            <EmptyState label="Tous les fichiers ont une référence connue." />
          ) : (
            <div className="divide-y divide-rose-100">
              {/* ─── Sous-section : Format incorrect ─────────────────── */}
              {hasFormat && (
                <section>
                  <button
                    type="button"
                    onClick={() => setNotFoundClosed((s) => ({ ...s, format: !s.format }))}
                    className="w-full px-5 py-2.5 bg-rose-50/60 flex items-center gap-2 sticky top-0 z-10 backdrop-blur-sm border-b border-rose-100 hover:bg-rose-50 transition-colors text-left"
                    aria-expanded={!notFoundClosed.format}
                  >
                    <svg
                      className={`w-3.5 h-3.5 text-rose-600 transition-transform ${notFoundClosed.format ? "" : "rotate-90"}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-100 border border-rose-200 text-[10px] font-body font-semibold uppercase tracking-[0.14em] text-rose-800">
                      <span className="w-1 h-1 rounded-full bg-rose-500" />
                      Format incorrect
                    </span>
                    <span className="text-[10px] font-body text-rose-700 tabular-nums">
                      · {buckets.notFoundFormat.length} fichier{buckets.notFoundFormat.length > 1 ? "s" : ""}
                    </span>
                  </button>
                  {!notFoundClosed.format && (
                    <ul className="divide-y divide-rose-50">
                      {buckets.notFoundFormat.map((f) => (
                        <li key={`fmt-${f.name}`} className="px-5 py-3 flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => setLightbox({ url: f.url, name: f.name })}
                            className="relative w-12 h-12 rounded-lg overflow-hidden border border-rose-100 bg-bg-secondary shrink-0 cursor-zoom-in hover:ring-2 hover:ring-rose-400 transition-all"
                            aria-label={`Agrandir ${f.name}`}
                          >
                            <Image src={f.url} alt={f.name} fill className="object-cover" unoptimized />
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-text-primary font-body truncate font-medium">{f.name}</p>
                            <p className="text-[11px] text-rose-700 font-body mt-1 leading-snug">
                              Nom invalide. Format attendu :{" "}
                              <code className="px-1 rounded bg-rose-50 border border-rose-100 text-rose-800">REFERENCE COULEUR POSITION.jpg</code>
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onRemoveFile(f.name)}
                            className="text-[10px] text-text-muted hover:text-red-600 font-body shrink-0"
                          >
                            Retirer
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* ─── Sous-section : Référence inexistante ────────────── */}
              {hasRef && (
                <section>
                  <button
                    type="button"
                    onClick={() => setNotFoundClosed((s) => ({ ...s, ref: !s.ref }))}
                    className="w-full px-5 py-2.5 bg-rose-50/60 flex items-center gap-2 sticky top-0 z-10 backdrop-blur-sm border-b border-rose-100 hover:bg-rose-50 transition-colors text-left"
                    aria-expanded={!notFoundClosed.ref}
                  >
                    <svg
                      className={`w-3.5 h-3.5 text-rose-600 transition-transform ${notFoundClosed.ref ? "" : "rotate-90"}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-100 border border-rose-200 text-[10px] font-body font-semibold uppercase tracking-[0.14em] text-rose-800">
                      <span className="w-1 h-1 rounded-full bg-rose-500" />
                      Référence inexistante
                    </span>
                    <span className="text-[10px] font-body text-rose-700 tabular-nums">
                      · {buckets.notFoundRef.length} fichier{buckets.notFoundRef.length > 1 ? "s" : ""}
                    </span>
                  </button>
                  {!notFoundClosed.ref && (
                    <ul className="divide-y divide-rose-50">
                      {buckets.notFoundRef.map(({ file }) => (
                        <li key={`nref-${file.name}`} className="px-5 py-3 flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => setLightbox({ url: file.url, name: file.name })}
                            className="relative w-12 h-12 rounded-lg overflow-hidden border border-rose-100 bg-bg-secondary shrink-0 cursor-zoom-in hover:ring-2 hover:ring-rose-400 transition-all"
                            aria-label={`Agrandir ${file.name}`}
                          >
                            <Image src={file.url} alt={file.name} fill className="object-cover" unoptimized />
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-text-primary font-body truncate font-medium">{file.name}</p>
                            <p className="text-[10px] text-text-muted font-body mt-0.5">
                              Référence cherchée : <span className="font-mono font-semibold">{file.reference}</span>
                            </p>
                            <p className="text-[11px] text-rose-700 font-body mt-1 leading-snug">
                              Aucun produit ne porte cette référence en BDD.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onRemoveFile(file.name)}
                            className="text-[10px] text-text-muted hover:text-red-600 font-body shrink-0"
                          >
                            Retirer
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox image en grand */}
      {lightbox && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
            onClick={() => setLightbox(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`Aperçu de ${lightbox.name}`}
          >
            <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
            <div
              className="relative max-w-[92vw] max-h-[92vh] flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.url}
                alt={lightbox.name}
                className="max-w-[92vw] max-h-[85vh] rounded-xl shadow-2xl object-contain bg-bg-secondary"
              />
              <p className="mt-3 px-3 py-1.5 bg-black/60 text-white text-xs font-body rounded-lg max-w-full truncate">
                {lightbox.name}
              </p>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="absolute -top-3 -right-3 w-9 h-9 flex items-center justify-center rounded-full bg-bg-primary text-text-primary shadow-lg hover:bg-bg-secondary transition-colors"
                aria-label="Fermer l'aperçu"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ─── Sous-composants utilitaires ─────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-[12px] text-text-muted font-body">{label}</p>
    </div>
  );
}

function PositionPicker({
  current,
  available,
  onPick,
}: {
  current: number;
  available: number[];
  onPick: (p: number) => void;
}) {
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer text-[11px] px-2 py-1 rounded-md border border-amber-200 bg-bg-primary text-amber-700 font-body hover:border-amber-500 transition-colors inline-flex items-center gap-1">
        Pos {current}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="absolute z-30 top-full left-0 mt-1 flex bg-bg-primary border border-border rounded-lg shadow-md overflow-hidden">
        {available.map((p) => (
          <button
            key={p}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onPick(p);
              const detailsEl = (e.currentTarget.closest("details") as HTMLDetailsElement | null);
              if (detailsEl) detailsEl.open = false;
            }}
            className={`w-8 h-8 text-[11px] font-body transition-colors ${
              p === current
                ? "bg-amber-700 text-white"
                : "text-text-secondary hover:bg-amber-50 hover:text-amber-800"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </details>
  );
}
