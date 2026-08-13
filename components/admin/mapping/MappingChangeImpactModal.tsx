"use client";

/**
 * Modale « X produits impactés sur {Marketplace} » : ouverte par le
 * `MappingImpactProvider` dès qu'une server action de mapping renvoie un
 * `impact` non-null.
 *
 * Trois issues :
 *   1. **Synchroniser maintenant** → enqueue une resync (refresh) sur les
 *      produits impactés via `useMarketplaceRefreshQueue`. Le widget flottant
 *      marketplaces en bas à droite affiche la progression.
 *   2. **Marquer "Synchro nécessaire"** → pose `pfsSyncRequired = true`
 *      (ou eq.) sur les produits impactés. Badge orange dans le tableau
 *      produits, resync manuelle plus tard.
 *   3. **Ignorer** → **rollback du mapping** à l'ancienne valeur (règle métier
 *      voulue par la cliente : pas de désynchro silencieuse). `router.refresh()`
 *      pour que l'UI reflète la valeur restaurée.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useMarketplaceRefreshQueue } from "@/components/admin/products/MarketplaceRefreshContext";
import {
  loadImpactedProductsForSync,
  markImpactedProductsSyncRequired,
  rollbackMappingChange,
} from "@/app/actions/admin/mapping-impact";
import {
  marketplaceLabel,
  type MappingChangeSummary,
  type MappingMarketplace,
} from "@/lib/mapping-impact-types";

interface Props {
  summary: MappingChangeSummary;
  onClose: () => void;
}

/**
 * Label court d'un attribut au singulier, utilisé dans la phrase principale
 * (ex : « … utilisent cette **saison** »).
 */
function attributeShortLabel(attr: MappingChangeSummary["attribute"]): string {
  return attr === "season"
    ? "saison"
    : attr === "category"
      ? "catégorie"
      : attr === "color"
        ? "couleur"
        : "composition";
}

/**
 * Marketplace target attendu par `MarketplaceRefreshEnqueueInput.marketplace`
 * (utilise "ankorstore" alors qu'ici on ne cible que pfs/efashion/faire).
 */
function toRefreshTarget(mp: MappingMarketplace): "pfs" | "efashion" | "faire" {
  return mp;
}

export default function MappingChangeImpactModal({ summary, onClose }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { enqueue } = useMarketplaceRefreshQueue();
  const [busy, setBusy] = useState<null | "sync" | "mark" | "rollback">(null);

  const mpName = marketplaceLabel(summary.marketplace);
  const attrLabel = attributeShortLabel(summary.attribute);
  const oldTxt = summary.oldValueLabel ?? "aucune";
  const newTxt = summary.newValueLabel ?? "aucune (le champ ne sera plus envoyé)";
  const productsWord = summary.count > 1 ? "produits" : "produit";
  const usesVerb = summary.count > 1 ? "utilisent" : "utilise";

  async function handleSync() {
    setBusy("sync");
    try {
      const res = await loadImpactedProductsForSync(
        summary.attribute,
        summary.marketplace,
        summary.localId,
      );
      if (!res.success) {
        toast.error("Impossible de synchroniser", res.error);
        setBusy(null);
        return;
      }
      const target = toRefreshTarget(summary.marketplace);
      const inputs = res.products.map((p) => ({
        productId: p.id,
        reference: p.reference,
        productName: p.name,
        firstImage: p.firstImage,
        options: {
          local: false,
          pfs: target === "pfs",
          efashion: target === "efashion",
          faire: target === "faire",
        },
        mode: "refresh" as const,
        marketplace: target,
      }));
      enqueue(inputs);
      toast.info(
        "Ajoutés à la file",
        `${res.products.length} ${res.products.length > 1 ? "produits seront synchronisés" : "produit sera synchronisé"} sur ${mpName} en arrière-plan.`,
      );
      onClose();
    } catch (err) {
      toast.error(
        "Erreur",
        err instanceof Error ? err.message : "Impossible de lancer la synchronisation.",
      );
      setBusy(null);
    }
  }

  async function handleMark() {
    setBusy("mark");
    const res = await markImpactedProductsSyncRequired(
      summary.attribute,
      summary.marketplace,
      summary.localId,
    );
    if (!res.success) {
      toast.error("Impossible", res.error);
      setBusy(null);
      return;
    }
    toast.success(
      "Badge orange posé",
      `${res.count} ${res.count > 1 ? "produits marqués" : "produit marqué"} « Synchro nécessaire » sur ${mpName}.`,
    );
    router.refresh();
    onClose();
  }

  async function handleRollback() {
    setBusy("rollback");
    const res = await rollbackMappingChange(
      summary.attribute,
      summary.localId,
      summary.rollbackFields,
    );
    if (!res.success) {
      toast.error("Rollback impossible", res.error);
      setBusy(null);
      return;
    }
    toast.info("Modification annulée", `Le mapping ${mpName} a été rétabli.`);
    router.refresh();
    onClose();
  }

  const modal = (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-bg-primary rounded-2xl shadow-xl max-w-xl w-full border border-border overflow-hidden">
        {/* Header aurora ambre — action d'attention */}
        <div className="relative overflow-hidden border-b border-border">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 80% at 10% 0%, rgba(254,215,170,0.55), transparent 60%)," +
                "radial-gradient(50% 70% at 90% 10%, rgba(253,186,116,0.28), transparent 65%)",
            }}
          />
          <div className="relative px-6 pt-5 pb-4">
            <div className="flex items-start gap-3">
              <span
                className="inline-flex items-center justify-center w-11 h-11 rounded-2xl shrink-0"
                style={{
                  background: "linear-gradient(135deg, #FED7AA 0%, #FB923C 100%)",
                  color: "#7C2D12",
                }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10.5px] font-bold uppercase tracking-[0.14em]">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Mapping modifié
                </span>
                <h3 className="font-heading text-[18px] font-bold text-text-primary leading-tight mt-2">
                  {summary.count} {productsWord} {usesVerb === "utilisent" ? "impactés" : "impacté"} sur {mpName}
                </h3>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-[14px] text-text-primary leading-relaxed">
            {summary.count} {productsWord} publié{summary.count > 1 ? "s" : ""} sur <strong>{mpName}</strong> {usesVerb} la {attrLabel}{" "}
            <strong>« {summary.localName} »</strong>.
          </p>

          <div className="rounded-xl border border-border bg-bg-secondary/60 p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10.5px] uppercase tracking-widest font-bold text-text-muted mb-1">
                Avant
              </p>
              <p className="text-[13px] text-text-primary font-medium break-words">{oldTxt}</p>
            </div>
            <svg className="w-5 h-5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-[10.5px] uppercase tracking-widest font-bold text-amber-700 mb-1">
                Après
              </p>
              <p className="text-[13px] text-text-primary font-semibold break-words">{newTxt}</p>
            </div>
          </div>

          <p className="text-[12.5px] text-text-secondary leading-relaxed">
            Que veux-tu faire pour que la fiche {mpName} reste cohérente ?
          </p>
        </div>

        {/* Footer — 3 actions */}
        <div className="px-6 pb-6 pt-1 flex flex-col sm:flex-row-reverse gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={!!busy}
            className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg bg-bg-dark hover:bg-black text-text-inverse text-[13px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === "sync" ? (
              <SpinnerSmall />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            )}
            Synchroniser maintenant
          </button>
          <button
            type="button"
            onClick={handleMark}
            disabled={!!busy}
            className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === "mark" ? (
              <SpinnerSmall />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.17V11a6 6 0 10-12 0v3.17c0 .53-.21 1.04-.59 1.42L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
              </svg>
            )}
            Marquer « Synchro nécessaire »
          </button>
          <button
            type="button"
            onClick={handleRollback}
            disabled={!!busy}
            className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-secondary text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:mr-auto"
          >
            {busy === "rollback" ? (
              <SpinnerSmall />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 010 10h-1M3 10l4-4M3 10l4 4" />
              </svg>
            )}
            Ignorer (revenir à l'ancien mapping)
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

function SpinnerSmall() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
