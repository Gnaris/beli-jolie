"use client";

import { useState } from "react";

import { getImageSrc } from "@/lib/image-utils";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  useEfashionShootingBatch,
  type EfashionShootingItemView,
} from "@/components/admin/products/EfashionShootingBatchContext";

const EFASHION_BLUE = "#2563EB";

export function EfashionShootingBatchWidget() {
  const { items, hasBlockingIssue, isCommitting, removeProduct, commit } =
    useEfashionShootingBatch();
  const [minimized, setMinimized] = useState(false);
  const toast = useToast();
  const { confirm } = useConfirm();

  if (items.length === 0) return null;

  // Position : juste à gauche du MarketplaceRefreshWidget (qui vit à
  // bottom-4 right-24 et fait 420px de large). On l'aligne sur la même
  // ligne (bottom-4) en décalant son right de 420px + 7rem + ~1rem d'air
  // pour qu'il colle à 16px du bord gauche du widget marketplace.
  const containerPos = "fixed bottom-4 right-[calc(420px+8rem)] z-[9000]";
  const containerMaxWidth = "calc(100vw - 420px - 10rem)";

  const total = items.length;
  const issueCount = items.filter(
    (it) => !it.productDeleted && (it.missing.length > 0 || it.noEligibleVariants),
  ).length;

  const handleCommit = async () => {
    const ok = await confirm({
      type: "info",
      title: "Envoyer le shooting à eFashion ?",
      message: `${total} produit(s) seront envoyés en un seul ticket de shooting. Une fois validé, eFashion devra confirmer manuellement de leur côté.`,
      confirmLabel: "Envoyer",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;
    const res = await commit();
    if (res.ok) toast.success("Shooting envoyé", res.message);
    else toast.error("Envoi impossible", res.message);
  };

  if (minimized) {
    return (
      <div className={`${containerPos} animate-fadeIn`} style={{ maxWidth: containerMaxWidth }}>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2.5 bg-bg-primary border border-border rounded-full pl-3 pr-4 py-2 shadow-lg hover:shadow-xl transition-all font-body"
        >
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-full"
            style={{ background: "#DBEAFE", color: EFASHION_BLUE }}
            aria-hidden="true"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 22V12h6v10" />
            </svg>
          </span>
          <span className="text-[13px] font-medium text-text-primary tabular-nums">
            Shooting eFashion : {total}
          </span>
          {issueCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold tabular-nums">
              {issueCount} bloqué{issueCount > 1 ? "s" : ""}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`${containerPos} animate-fadeIn`}
      style={{ maxWidth: containerMaxWidth }}
      role="region"
      aria-label="File du shooting eFashion"
    >
      <div className="bg-bg-primary border border-border rounded-2xl shadow-xl w-[420px] max-w-full overflow-hidden flex flex-col">
        <header className="px-4 py-3 border-b border-border bg-gradient-to-r from-bg-secondary to-bg-primary flex items-start gap-2.5">
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0 mt-0.5"
            style={{ background: "#DBEAFE", color: EFASHION_BLUE }}
            aria-hidden="true"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 22V12h6v10" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold font-heading text-text-primary leading-tight">
              Shooting eFashion en préparation
            </h3>
            <p className="text-[11px] font-body text-text-muted mt-0.5">
              {total} produit{total > 1 ? "s" : ""} prêt{total > 1 ? "s" : ""} à partir en un seul ticket
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors shrink-0"
            title="Réduire"
            aria-label="Réduire"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
            </svg>
          </button>
        </header>

        <ul className="overflow-y-auto" style={{ maxHeight: "320px" }}>
          {items.map((item) => (
            <BatchRow key={item.id} item={item} onRemove={() => void removeProduct(item.productId)} />
          ))}
        </ul>

        <footer className="px-4 py-3 border-t border-border bg-bg-secondary">
          {hasBlockingIssue && (
            <p className="text-[11px] text-red-700 mb-2 leading-snug">
              <strong>Corrigez ou retirez</strong> les produits en rouge avant de valider — eFashion refuserait le shooting.
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleCommit()}
            disabled={hasBlockingIssue || isCommitting}
            className="w-full px-4 py-2.5 rounded-lg font-medium text-white transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: hasBlockingIssue ? "#9CA3AF" : EFASHION_BLUE }}
          >
            {isCommitting ? "Envoi en cours…" : `Valider le shooting et envoyer à eFashion`}
          </button>
        </footer>
      </div>
    </div>
  );
}

function BatchRow({
  item,
  onRemove,
}: {
  item: EfashionShootingItemView;
  onRemove: () => void;
}) {
  const hasIssue =
    !item.productDeleted && (item.missing.length > 0 || item.noEligibleVariants);
  const rowBg = hasIssue ? "bg-red-50" : "";
  const borderColor = hasIssue ? "border-red-200" : "border-border";

  const thumb = item.firstImage ? getImageSrc(item.firstImage, "thumb") : null;
  const modeLabel = item.mode === "PUBLISH" ? "Création" : "Rafraîchissement";

  return (
    <li className={`px-3 py-2.5 border-b ${borderColor} ${rowBg} flex items-start gap-2.5`}>
      <div className="w-10 h-10 rounded-md bg-bg-tertiary border border-border shrink-0 overflow-hidden">
        {thumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="w-full h-full grid place-items-center text-text-muted">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4-4 4 4 4-4 4 4M4 8h16" />
            </svg>
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-text-primary truncate" title={item.productName}>
          {item.productName}
        </p>
        <p className="text-[10.5px] font-body text-text-muted truncate flex items-center gap-1.5">
          <span className="tabular-nums">{item.reference}</span>
          <span aria-hidden="true">·</span>
          <span>{modeLabel}</span>
        </p>
        {item.productDeleted && (
          <p className="text-[10.5px] text-amber-700 mt-1">
            Produit supprimé — sera ignoré silencieusement à la validation.
          </p>
        )}
        {item.noEligibleVariants && (
          <p className="text-[10.5px] text-red-700 mt-1">
            Pas de variante à l&apos;unité — eFashion n&apos;accepte pas les packs.
          </p>
        )}
        {item.missing.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {item.missing.map((m, i) => (
              <li key={i} className="text-[10.5px] text-red-700 leading-snug">
                • {m}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded-md transition-colors shrink-0"
        title="Retirer de la file"
        aria-label="Retirer de la file"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </li>
  );
}
