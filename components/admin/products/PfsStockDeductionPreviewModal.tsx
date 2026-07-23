"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useToast } from "@/components/ui/Toast";
import { getImageSrc } from "@/lib/image-utils";
import {
  getPfsStockDeductionPreview,
  runPfsStockDeduction,
  type PfsStockDeductionActionResult,
} from "@/app/actions/admin/pfs-stock-deduction";
import type {
  PfsStockPreviewAll,
  PfsStockPreviewAllProduct,
} from "@/lib/pfs-stock-deduction";

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: (result: PfsStockDeductionActionResult) => void;
}

type FilterMode = "all" | "included" | "excluded";

const STATUS_LABEL: Record<PfsStockPreviewAllProduct["status"], { label: string; dot: string }> = {
  ONLINE: { label: "En ligne", dot: "bg-emerald-500" },
  OFFLINE: { label: "Hors ligne", dot: "bg-slate-400" },
  ARCHIVED: { label: "Archivé", dot: "bg-rose-400" },
  SYNCING: { label: "Synchronisation…", dot: "bg-amber-400" },
};

export default function PfsStockDeductionPreviewModal({ open, onClose, onDone }: Props) {
  const toast = useToast();
  const [preview, setPreview] = useState<PfsStockPreviewAll | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterMode>("all");
  const [zoomImage, setZoomImage] = useState<{ src: string; name: string; reference: string } | null>(null);

  // Charge la prévisualisation à l'ouverture. Reset des exclusions à chaque ouverture
  // (elles ne sont pas persistantes tant que la modale n'est pas validée).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExcluded(new Set());
    setFilter("all");
    (async () => {
      const res = await getPfsStockDeductionPreview();
      if (cancelled) return;
      if (!res.success) {
        setError(res.error);
        setLoading(false);
        return;
      }
      setPreview(res.preview);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // ESC ferme (sauf pendant l'exécution).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoomImage) {
        setZoomImage(null);
        return;
      }
      if (!running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, running, onClose, zoomImage]);

  const products = preview?.products ?? [];
  const excludedCount = excluded.size;
  const includedCount = products.length - excludedCount;

  const visibleProducts = useMemo(() => {
    if (filter === "included") return products.filter((p) => !excluded.has(p.productId));
    if (filter === "excluded") return products.filter((p) => excluded.has(p.productId));
    return products;
  }, [products, filter, excluded]);

  const totalUnitsToRemove = useMemo(() => {
    return products
      .filter((p) => !excluded.has(p.productId))
      .reduce((sum, p) => sum + p.totalUnitsRemoved, 0);
  }, [products, excluded]);

  const toggleExclude = (productId: string) => {
    if (running) return;
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const handleRun = async () => {
    if (!preview || running) return;
    setRunning(true);
    try {
      const res = await runPfsStockDeduction({ excludedProductIds: Array.from(excluded) });
      if (!res.success) {
        toast.error(res.error);
        setRunning(false);
        return;
      }

      const { processedCount, excludedItemsCount, touchedProductIds } = res.result;
      const parts: string[] = [];
      if (processedCount > 0) {
        parts.push(`${processedCount} ligne${processedCount > 1 ? "s" : ""} traitée${processedCount > 1 ? "s" : ""}`);
      }
      if (touchedProductIds.length > 0) {
        parts.push(
          `${touchedProductIds.length} produit${touchedProductIds.length > 1 ? "s" : ""} touché${touchedProductIds.length > 1 ? "s" : ""}`,
        );
      }
      if (excludedItemsCount > 0) {
        parts.push(
          `${excludedItemsCount} ligne${excludedItemsCount > 1 ? "s" : ""} exclue${excludedItemsCount > 1 ? "s" : ""}`,
        );
      }
      toast.success(parts.length > 0 ? parts.join(" · ") : "Aucune ligne traitée");

      onDone(res);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue");
      setRunning(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-3"
        onClick={() => !running && onClose()}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header aurora indigo/violet — palette PFS */}
          <div className="relative overflow-hidden shrink-0">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600" />
            <div className="absolute -top-16 -right-10 w-48 h-48 rounded-full bg-white/20 blur-3xl" />
            <div className="absolute -bottom-14 left-1/3 w-40 h-40 rounded-full bg-fuchsia-400/20 blur-3xl" />
            <div className="relative px-6 py-5 flex items-start justify-between gap-4 text-white">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[13px] font-bold text-white shadow-sm"
                    style={{ background: "linear-gradient(135deg,#4f46e5,#6366f1)" }}
                  >
                    P
                  </span>
                  <span className="text-[10.5px] uppercase tracking-[0.22em] font-bold text-white/80">
                    PFS · Déduction du stock
                  </span>
                </div>
                <h2 className="mt-1 font-heading text-2xl font-bold leading-tight">
                  Prévisualisation avant déduction
                </h2>
                <p className="mt-1 text-sm text-white/85">
                  {loading ? (
                    "Chargement…"
                  ) : preview ? (
                    <>
                      <span className="font-semibold">
                        {preview.totalPendingLines} ligne{preview.totalPendingLines > 1 ? "s" : ""}
                      </span>{" "}
                      en attente sur{" "}
                      <span className="font-semibold">
                        {products.length} produit{products.length > 1 ? "s" : ""}
                      </span>
                      . Vérifiez le stock avant / après, puis validez.
                    </>
                  ) : (
                    ""
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={running}
                aria-label="Fermer"
                className="w-9 h-9 rounded-lg text-white/80 hover:bg-white/15 transition-colors disabled:opacity-40 shrink-0"
              >
                <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Bandeau avertissement irréversible */}
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 text-[12.5px] text-amber-900 flex items-start gap-2 shrink-0">
            <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3l9 16H3L12 3z" />
            </svg>
            <div>
              Le bouton <span className="font-semibold">« Ne pas déduire »</span> marquera le produit comme déjà
              traité côté PFS — <span className="font-semibold">action définitive après validation</span>. Vous
              pouvez annuler l&apos;exclusion tant que la modale est ouverte.
            </div>
          </div>

          {/* Filtres + total */}
          {preview && products.length > 0 && (
            <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between gap-4 flex-wrap bg-slate-50/70 shrink-0">
              <div className="flex items-center gap-2">
                <div className="text-[11px] uppercase tracking-[0.18em] font-bold text-slate-500">Filtrer</div>
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
                  Tous <span className="ml-1 opacity-70">{products.length}</span>
                </FilterChip>
                <FilterChip active={filter === "included"} onClick={() => setFilter("included")}>
                  À déduire <span className="ml-1 opacity-70">{includedCount}</span>
                </FilterChip>
                <FilterChip active={filter === "excluded"} onClick={() => setFilter("excluded")}>
                  Exclus <span className="ml-1 opacity-70">{excludedCount}</span>
                </FilterChip>
              </div>
              <div className="text-[12px] text-slate-600">
                <span className="font-semibold text-slate-900 tabular-nums">{totalUnitsToRemove} unités</span> vont être
                décrémentées au total
              </div>
            </div>
          )}

          {/* Body scrollable */}
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-3 bg-slate-50/40">
            {loading && (
              <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-3">
                <span className="inline-block w-4 h-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                Calcul de la prévisualisation…
              </div>
            )}

            {!loading && error && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 p-4 text-sm">
                Impossible de calculer la prévisualisation : {error}
              </div>
            )}

            {!loading && !error && preview && products.length === 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 p-4 text-sm">
                Aucun produit rattaché parmi les lignes PFS en attente. Rien à déduire.
              </div>
            )}

            {!loading && !error && preview && visibleProducts.map((p) => {
              const isExcluded = excluded.has(p.productId);
              const status = STATUS_LABEL[p.status];
              return (
                <div
                  key={p.productId}
                  className={`rounded-2xl bg-white border border-slate-200 shadow-sm p-4 md:p-5 relative transition-opacity ${isExcluded ? "opacity-60" : ""}`}
                >
                  {isExcluded && (
                    <div className="absolute top-3 right-3 text-[10.5px] uppercase tracking-[0.16em] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-3 py-1">
                      Exclu de la déduction
                    </div>
                  )}
                  <div className="flex items-start gap-4">
                    {/* Image cliquable pour zoomer */}
                    <button
                      type="button"
                      className="relative group shrink-0 rounded-xl overflow-hidden ring-1 ring-slate-200 hover:ring-indigo-400 transition-all bg-slate-100"
                      onClick={() =>
                        p.firstImage &&
                        setZoomImage({ src: getImageSrc(p.firstImage, "large"), name: p.productName, reference: p.reference })
                      }
                      disabled={!p.firstImage}
                      aria-label={p.firstImage ? "Agrandir l'image" : "Aucune image"}
                    >
                      <div className="w-24 h-24 md:w-28 md:h-28 flex items-center justify-center">
                        {p.firstImage ? (
                          <Image
                            src={getImageSrc(p.firstImage, "thumb")}
                            alt={p.productName}
                            width={112}
                            height={112}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <span className="text-slate-400 text-[11px] font-medium px-2 text-center">
                            Pas d&apos;image
                          </span>
                        )}
                      </div>
                      {p.firstImage && (
                        <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/40 transition-colors flex items-center justify-center pointer-events-none">
                          <svg
                            className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m-3-3h6"
                            />
                          </svg>
                        </div>
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap text-[10.5px] uppercase tracking-[0.16em] font-bold text-slate-400">
                            <span className="font-mono">Réf. {p.reference}</span>
                            {p.hasPack && (
                              <span className="inline-block rounded-full text-[9.5px] px-2 py-0.5 font-bold uppercase tracking-wider bg-violet-50 text-violet-700 border border-violet-200">
                                Paquet
                              </span>
                            )}
                            {p.skippedLinesCount > 0 && (
                              <span className="inline-block rounded-full text-[9.5px] px-2 py-0.5 font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                                {p.skippedLinesCount} ligne{p.skippedLinesCount > 1 ? "s" : ""} ignorée
                                {p.skippedLinesCount > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          <h3 className="mt-0.5 font-bold text-[15px] text-slate-900 leading-snug">
                            {p.productName}
                          </h3>
                          <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-slate-500">
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                              {status.label}
                            </span>
                            <span>
                              · {p.linesCount} ligne{p.linesCount > 1 ? "s" : ""} PFS ({p.orderNumbers.length} commande
                              {p.orderNumbers.length > 1 ? "s" : ""})
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <div className="text-[10.5px] uppercase tracking-[0.14em] text-slate-400 font-semibold">
                              Total retiré
                            </div>
                            <div
                              className={`font-bold text-lg leading-none tabular-nums ${isExcluded ? "text-slate-400 line-through" : "text-rose-600"}`}
                            >
                              −{p.totalUnitsRemoved}{" "}
                              <span className="text-[11px] font-medium">u.</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleExclude(p.productId)}
                            disabled={running}
                            className={`rounded-xl text-[12px] font-medium px-3 py-2 inline-flex items-center gap-1.5 border transition-colors disabled:opacity-40 ${
                              isExcluded
                                ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                            }`}
                          >
                            {isExcluded ? (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Réinclure
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 105.636 5.636m12.728 12.728L5.636 5.636" />
                                </svg>
                                Ne pas déduire
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Détail variantes */}
                      {p.variantChanges.length > 0 && (
                        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 divide-y divide-slate-100">
                          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10.5px] uppercase tracking-[0.14em] font-bold text-slate-400">
                            <div className="col-span-6">Variante</div>
                            <div className="col-span-2 text-center">Retiré</div>
                            <div className="col-span-4 text-right">Stock</div>
                          </div>
                          {p.variantChanges.map((ch) => (
                            <div
                              key={ch.productColorId + ch.sizeLabel}
                              className="grid grid-cols-12 gap-2 items-center px-4 py-2.5 text-[13px]"
                            >
                              <div className="col-span-6 text-slate-800 truncate">
                                {ch.colorLabel} · {ch.sizeLabel}
                              </div>
                              <div className="col-span-2 text-center">
                                <span className="inline-block rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[12px] px-2 py-0.5 font-semibold tabular-nums">
                                  −{ch.unitsRemoved}
                                </span>
                              </div>
                              <div
                                className={`col-span-4 flex items-center justify-end gap-2 tabular-nums ${isExcluded ? "grayscale" : ""}`}
                              >
                                <span className="inline-block rounded-lg bg-white border border-slate-200 px-2.5 py-0.5 font-semibold text-slate-700">
                                  {ch.currentStock}
                                </span>
                                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                </svg>
                                <span
                                  className={`inline-block rounded-lg px-2.5 py-0.5 font-bold border ${
                                    ch.nextStock === 0
                                      ? "bg-rose-50 text-rose-700 border-rose-200"
                                      : ch.nextStock <= 2
                                      ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  }`}
                                >
                                  {ch.nextStock}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Détail commandes source dépliable */}
                      {p.orderNumbers.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[11.5px] text-slate-500 hover:text-slate-800 select-none">
                            Commandes PFS concernées ({p.orderNumbers.length})
                          </summary>
                          <ul className="mt-1.5 pl-3 text-[11.5px] text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
                            {p.orderNumbers.map((n) => (
                              <li key={n}>· <span className="font-mono">{n}</span></li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Lignes ignorées globales (produits non rattachés) */}
            {!loading && !error && preview && preview.skippedUnlinked.length > 0 && (
              <details className="mt-4 rounded-2xl bg-white border border-slate-200 p-4">
                <summary className="cursor-pointer text-[12px] font-semibold text-slate-700 select-none">
                  {preview.skippedUnlinked.length} ligne{preview.skippedUnlinked.length > 1 ? "s" : ""} PFS ignorée
                  {preview.skippedUnlinked.length > 1 ? "s" : ""} (produit non rattaché à votre boutique)
                </summary>
                <ul className="mt-2 space-y-1 text-[12px] text-slate-600 max-h-40 overflow-y-auto">
                  {preview.skippedUnlinked.map((s) => (
                    <li key={s.pfsOrderItemId} className="flex items-center gap-2">
                      <span className="font-mono text-slate-500 shrink-0">{s.pfsProductRef}</span>
                      <span className="truncate">
                        {s.productName ?? "—"}
                        {s.colorLabel ? ` · ${s.colorLabel}` : ""}
                        {s.sizeLabel ? ` · ${s.sizeLabel}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between gap-3 flex-wrap shrink-0">
            <div className="text-[12px] text-slate-600">
              {preview ? (
                <>
                  <span className="font-semibold text-slate-900">{includedCount}</span> produit
                  {includedCount > 1 ? "s" : ""} à déduire ·{" "}
                  <span className="font-semibold text-slate-900 tabular-nums">{totalUnitsToRemove}</span> unité
                  {totalUnitsToRemove > 1 ? "s" : ""} retirée{totalUnitsToRemove > 1 ? "s" : ""}
                  {excludedCount > 0 && (
                    <>
                      {" "}
                      · <span className="text-rose-600 font-medium">{excludedCount} exclu{excludedCount > 1 ? "s" : ""}</span>
                    </>
                  )}
                </>
              ) : (
                ""
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={running}
                className="rounded-xl border border-slate-200 bg-white text-slate-700 text-sm px-4 py-2 hover:bg-slate-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={running || loading || !preview || (includedCount === 0 && excludedCount === 0)}
                className="rounded-xl bg-slate-900 text-white text-sm font-medium px-5 py-2 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 shadow-sm"
              >
                {running ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Déduction en cours…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Déduire maintenant
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox zoom image */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-[90] bg-slate-950/90 flex items-center justify-center p-6"
          onClick={() => setZoomImage(null)}
        >
          <button
            type="button"
            aria-label="Fermer"
            className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-slate-800">
              <Image
                src={zoomImage.src}
                alt={zoomImage.name}
                width={1024}
                height={1024}
                className="w-full h-auto max-h-[70vh] object-contain bg-slate-900"
                unoptimized
              />
            </div>
            <div className="mt-4 text-center text-white/80 text-sm">
              <div className="font-semibold text-white">{zoomImage.name}</div>
              <div className="text-[12px] mt-0.5 font-mono opacity-60">Réf. {zoomImage.reference}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FilterChip({
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
      type="button"
      onClick={onClick}
      className={`rounded-full text-[12px] px-3 py-1 font-medium transition-colors ${
        active
          ? "bg-slate-900 text-white"
          : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}
