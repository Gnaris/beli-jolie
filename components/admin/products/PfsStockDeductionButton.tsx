"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  runPfsStockDeduction,
  markProductsSyncRequiredAfterDeduction,
  type PfsStockPostDeductionMarketplace,
} from "@/app/actions/admin/pfs-stock-deduction";

export interface PfsStockDeductionButtonProps {
  initialPendingCount: number;
  hasAnkorstoreConfig: boolean;
  hasEfashionConfig: boolean;
  hasFaireConfig: boolean;
}

export default function PfsStockDeductionButton({
  initialPendingCount,
  hasAnkorstoreConfig,
  hasEfashionConfig,
  hasFaireConfig,
}: PfsStockDeductionButtonProps) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [pendingCount, setPendingCount] = useState<number>(initialPendingCount);
  const [busy, setBusy] = useState(false);
  const disabled = busy || pendingCount === 0;

  const handleClick = useCallback(async () => {
    if (disabled) return;

    const ok = await confirm({
      type: "warning",
      title: `Déduire le stock à partir de ${pendingCount} ligne${pendingCount > 1 ? "s" : ""} PFS`,
      message:
        "Les commandes PFS validées ou envoyées qui n'ont jamais été prises en compte vont réduire votre stock. Les variantes PACK associées seront automatiquement recalculées. Cette action n'est pas réversible.",
      confirmLabel: "Déduire maintenant",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;

    setBusy(true);
    try {
      const res = await runPfsStockDeduction();
      if (!res.success) {
        toast.error(res.error || "Impossible de déduire le stock.");
        setBusy(false);
        return;
      }

      const { processedCount, skipped, touchedProductIds } = res.result;
      const skippedCount = skipped.length;

      toast.success(
        `${processedCount} ligne${processedCount > 1 ? "s" : ""} traitée${processedCount > 1 ? "s" : ""}` +
          (skippedCount > 0 ? ` · ${skippedCount} ignorée${skippedCount > 1 ? "s" : ""}` : "") +
          ` · ${touchedProductIds.length} produit${touchedProductIds.length > 1 ? "s" : ""} touché${touchedProductIds.length > 1 ? "s" : ""}`,
      );

      // Décrémenter le badge (les lignes traitées ne sont plus en attente ; les
      // sautées restent en attente uniquement si on les remet à null, ce que la
      // server action ne fait pas — donc on recharge le count depuis le serveur).
      setPendingCount(0);

      if (touchedProductIds.length === 0) {
        router.refresh();
        setBusy(false);
        return;
      }

      // 2ᵉ prompt : demande les marketplaces à marquer « synchro nécessaire »
      // (PFS volontairement exclu, cf. CLAUDE.md).
      // Toutes cases cochées par défaut → variables initialisées à true, seules
      // les cases décochées par l'admin déclencheront un onChange qui passe à false.
      let syncShop = true;
      let syncAnkor = hasAnkorstoreConfig;
      let syncEfashion = hasEfashionConfig;
      let syncFaire = hasFaireConfig;
      const checkboxes = [
        {
          id: "SHOP",
          label: "Boutique (rafraîchit lastRefreshedAt)",
          defaultChecked: true,
          onChange: (c: boolean) => {
            syncShop = c;
          },
        },
      ];
      if (hasAnkorstoreConfig) {
        checkboxes.push({
          id: "ANKORSTORE",
          label: "Ankorstore — marquer synchro nécessaire",
          defaultChecked: true,
          onChange: (c: boolean) => {
            syncAnkor = c;
          },
        });
      }
      if (hasEfashionConfig) {
        checkboxes.push({
          id: "EFASHION",
          label: "eFashion Paris — marquer synchro nécessaire",
          defaultChecked: true,
          onChange: (c: boolean) => {
            syncEfashion = c;
          },
        });
      }
      if (hasFaireConfig) {
        checkboxes.push({
          id: "FAIRE",
          label: "Faire — marquer synchro nécessaire",
          defaultChecked: true,
          onChange: (c: boolean) => {
            syncFaire = c;
          },
        });
      }

      const ok2 = await confirm({
        type: "info",
        title: `Synchroniser ${touchedProductIds.length} produit${touchedProductIds.length > 1 ? "s" : ""} touché${touchedProductIds.length > 1 ? "s" : ""} ?`,
        message:
          "Choisissez sur quelles marketplaces marquer une synchro nécessaire. Le refresh réel se fera au prochain clic sur le bouton « Rafraîchir » du produit (widget marketplace). PFS n'est pas proposé car il gère son propre stock côté PFS.",
        checkboxes,
        checkboxesLabel: "Marketplaces",
        confirmLabel: "Marquer synchro nécessaire",
        cancelLabel: "Non merci",
      });

      if (ok2 === true) {
        const marketplaces: PfsStockPostDeductionMarketplace[] = [];
        if (syncShop) marketplaces.push("SHOP");
        if (syncAnkor) marketplaces.push("ANKORSTORE");
        if (syncEfashion) marketplaces.push("EFASHION");
        if (syncFaire) marketplaces.push("FAIRE");
        if (marketplaces.length > 0) {
          const res2 = await markProductsSyncRequiredAfterDeduction({
            productIds: touchedProductIds,
            marketplaces,
          });
          if (res2.success) {
            toast.success(`${res2.taggedCount} produit${res2.taggedCount > 1 ? "s" : ""} marqué${res2.taggedCount > 1 ? "s" : ""} pour synchro.`);
          } else {
            toast.error(res2.error || "Impossible de marquer les produits.");
          }
        }
      }

      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setBusy(false);
    }
  }, [confirm, disabled, hasAnkorstoreConfig, hasEfashionConfig, hasFaireConfig, pendingCount, router, toast]);

  // Bouton : accent amber si des lignes en attente, gris disabled sinon.
  const activeCls = "bg-amber-500 text-white hover:bg-amber-600 shadow-sm";
  const idleCls = "bg-bg-tertiary text-text-muted cursor-not-allowed";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-body font-medium transition-all w-full md:w-auto ${disabled ? idleCls : activeCls}`}
      title={pendingCount === 0 ? "Aucune commande PFS en attente de déduction" : `${pendingCount} ligne${pendingCount > 1 ? "s" : ""} PFS à déduire`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4m0 0l6-6m-6 6l6 6" />
      </svg>
      <span className="hidden sm:inline">
        {busy ? "Déduction en cours…" : `Déduire stock PFS${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
      </span>
      <span className="sm:hidden">
        {busy ? "…" : `PFS${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
      </span>
    </button>
  );
}
