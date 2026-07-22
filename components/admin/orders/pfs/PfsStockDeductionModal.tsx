"use client";

import { useEffect, useState } from "react";
import {
  previewPfsOrderStockDeduction,
  runPfsOrderStockDeductionOne,
  type PfsSingleOrderDeductionPreview,
} from "@/app/actions/admin/pfs-orders";
import { useToast } from "@/components/ui/Toast";

interface Props {
  orderId: string;
  onClose: () => void;
  onDeducted: () => void;
}

const SKIP_REASON_LABELS: Record<string, string> = {
  PRODUCT_NOT_LINKED: "Produit non rattaché à votre boutique",
  VARIANT_NOT_LINKED: "Variante (couleur) non rattachée",
  SIZE_UNKNOWN: "Taille inconnue côté boutique",
  UNIT_VARIANT_NOT_FOUND: "Variante à l'unité introuvable pour cette couleur/taille",
  QTY_ZERO: "Quantité validée à zéro",
};

export default function PfsStockDeductionModal({ orderId, onClose, onDeducted }: Props) {
  const [preview, setPreview] = useState<PfsSingleOrderDeductionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { success, error: errorToast, warning } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await previewPfsOrderStockDeduction(orderId);
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
  }, [orderId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const eligibleLines = preview?.lines.filter((l) => !l.skipReason) ?? [];
  const skippedLines = preview?.lines.filter((l) => l.skipReason) ?? [];
  const canDeduct = eligibleLines.length > 0 && !running;

  const handleRun = async () => {
    setRunning(true);
    const res = await runPfsOrderStockDeductionOne(orderId);
    setRunning(false);
    if (!res.success) {
      errorToast("Déduction échouée", res.error);
      return;
    }
    if (res.processedCount === 0) {
      warning(
        "Rien n'a été déduit",
        "Aucune ligne n'a pu être traitée (produits non rattachés ou tailles inconnues).",
      );
    } else {
      success(
        "Stock déduit",
        `${res.processedCount} article${res.processedCount > 1 ? "s" : ""} traité${res.processedCount > 1 ? "s" : ""}.`,
      );
    }
    onDeducted();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => !running && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-bg-primary rounded-2xl shadow-2xl border border-border w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-text-muted">
              Déduction du stock
            </div>
            <h2 className="font-heading text-xl font-bold text-text-primary mt-0.5 truncate">
              Commande PFS{" "}
              <span className="font-mono">{preview?.orderNumber ?? "…"}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="w-9 h-9 rounded-lg text-text-muted hover:bg-bg-secondary hover:text-text-primary transition-colors disabled:opacity-40"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-16 text-text-muted text-sm gap-3">
              <span className="inline-block w-4 h-4 rounded-full border-2 border-text-muted border-t-transparent animate-spin" />
              Calcul de la prévisualisation…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 p-4 text-sm">
              Impossible de calculer la prévisualisation : {error}
            </div>
          )}

          {!loading && !error && preview && (
            <>
              <p className="text-sm text-text-secondary mb-4">
                Voici les articles dont le stock va être décrémenté. Vérifiez le passage
                <span className="mx-1 font-semibold text-text-primary">stock actuel → nouveau stock</span>
                puis validez.
              </p>

              {eligibleLines.length === 0 ? (
                <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 p-4 text-sm">
                  Aucune ligne éligible à la déduction dans cette commande.
                </div>
              ) : (
                <ul className="space-y-3">
                  {eligibleLines.map((line) => (
                    <li
                      key={line.pfsOrderItemId}
                      className="rounded-xl border border-border bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-semibold text-text-primary truncate">
                            {line.productName ?? "Produit sans nom"}
                          </div>
                          <div className="text-[11.5px] text-text-muted mt-0.5">
                            <span className="font-mono">{line.pfsProductRef}</span>
                            {line.colorLabel ? ` · ${line.colorLabel}` : ""}
                            {line.sizeLabel ? ` · ${line.sizeLabel}` : ""}
                            {" · "}
                            {line.qtyValidated} {line.saleType === "PACK" ? "paquet(s)" : "unité(s)"}
                          </div>
                        </div>
                        {line.saleType === "PACK" && (
                          <span className="inline-block rounded-full text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-violet-50 text-violet-700 border border-violet-200">
                            Paquet
                          </span>
                        )}
                      </div>

                      <ul className="mt-3 space-y-1.5">
                        {line.variantChanges.map((ch, i) => (
                          <li
                            key={`${ch.productColorId}-${i}`}
                            className="flex items-center gap-3 text-[12.5px]"
                          >
                            <span className="text-text-secondary flex-1 truncate">
                              {ch.colorLabel} · {ch.sizeLabel}{" "}
                              <span className="text-text-muted">(−{ch.unitsRemoved})</span>
                            </span>
                            <span className="inline-flex items-center gap-2 tabular-nums">
                              <span className="inline-block rounded-lg bg-bg-secondary border border-border px-2 py-0.5 text-text-primary font-semibold">
                                {ch.currentStock}
                              </span>
                              <svg
                                className="w-3.5 h-3.5 text-text-muted"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                                />
                              </svg>
                              <span
                                className={`inline-block rounded-lg px-2 py-0.5 font-semibold border ${
                                  ch.nextStock === 0
                                    ? "bg-rose-50 text-rose-700 border-rose-200"
                                    : ch.nextStock < ch.currentStock
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-bg-secondary text-text-primary border-border"
                                }`}
                              >
                                {ch.nextStock}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}

              {skippedLines.length > 0 && (
                <div className="mt-5 rounded-xl bg-bg-secondary border border-border p-4">
                  <div className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-text-muted mb-2">
                    Lignes ignorées ({skippedLines.length})
                  </div>
                  <ul className="space-y-1.5 text-[12.5px]">
                    {skippedLines.map((line) => (
                      <li key={line.pfsOrderItemId} className="flex items-baseline gap-2">
                        <span className="font-mono text-text-muted shrink-0">
                          {line.pfsProductRef}
                        </span>
                        <span className="text-text-secondary flex-1 min-w-0">
                          <span className="truncate">
                            {line.productName ?? "—"}
                            {line.colorLabel ? ` · ${line.colorLabel}` : ""}
                            {line.sizeLabel ? ` · ${line.sizeLabel}` : ""}
                          </span>
                        </span>
                        <span className="text-[11px] text-amber-700 shrink-0 italic">
                          {line.skipReason && SKIP_REASON_LABELS[line.skipReason]
                            ? SKIP_REASON_LABELS[line.skipReason]
                            : line.skipReason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3 bg-bg-secondary">
          <div className="text-xs text-text-muted">
            {preview
              ? `${preview.totalUnitsRemoved} unité${preview.totalUnitsRemoved > 1 ? "s" : ""} au total à décrémenter.`
              : ""}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={running}
              className="rounded-xl border border-border bg-white text-sm px-4 py-2 hover:bg-bg-secondary disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={!canDeduct}
              className="rounded-xl bg-slate-900 text-white text-sm font-medium px-5 py-2 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {running ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Déduction en cours…
                </>
              ) : (
                "Déduire maintenant"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
