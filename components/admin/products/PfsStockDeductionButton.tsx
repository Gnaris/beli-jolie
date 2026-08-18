"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import PfsStockDeductionPreviewModal from "@/components/admin/products/PfsStockDeductionPreviewModal";
import { useRefreshMarketplaceDialog } from "@/components/admin/products/useRefreshMarketplaceDialog";
import type { PfsStockDeductionActionResult } from "@/app/actions/admin/pfs-stock-deduction";

export interface PfsStockDeductionButtonProps {
  initialPendingCount: number;
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  hasEfashionConfig: boolean;
  hasFaireConfig: boolean;
}

export default function PfsStockDeductionButton({
  initialPendingCount,
  hasPfsConfig,
  hasAnkorstoreConfig,
  hasEfashionConfig,
  hasFaireConfig,
}: PfsStockDeductionButtonProps) {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState<number>(initialPendingCount);
  const [modalOpen, setModalOpen] = useState(false);
  const disabled = pendingCount === 0;

  // PFS est volontairement exclu : PFS gère son propre stock côté leur
  // plateforme après validation de commande. Les autres marketplaces reçoivent
  // le refresh pour propager le nouveau stock.
  const { refreshBulk } = useRefreshMarketplaceDialog({
    showPfs: false,
    showAnkorstore: hasAnkorstoreConfig,
    showEfashion: hasEfashionConfig,
    showFaire: hasFaireConfig,
  });

  const handleDone = useCallback(
    async (res: PfsStockDeductionActionResult) => {
      if (!res.success) return;
      setPendingCount(0);
      if (res.refreshPayloads.length > 0) {
        await refreshBulk(res.refreshPayloads);
      }
      router.refresh();
    },
    [refreshBulk, router],
  );

  void hasPfsConfig;

  // Bouton : accent orange foncé si des lignes en attente, gris disabled sinon.
  const activeCls = "bg-orange-600 text-white hover:bg-orange-700 shadow-sm";
  const idleCls = "bg-bg-tertiary text-text-muted cursor-not-allowed";

  return (
    <>
      <button
        type="button"
        onClick={() => !disabled && setModalOpen(true)}
        disabled={disabled}
        className={`inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-body font-medium transition-all w-full md:w-auto ${disabled ? idleCls : activeCls}`}
        title={pendingCount === 0 ? "Aucune commande PFS en attente de déduction" : `${pendingCount} ligne${pendingCount > 1 ? "s" : ""} PFS à déduire`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4m0 0l6-6m-6 6l6 6" />
        </svg>
        <span className="hidden sm:inline">
          Déduire stock PFS{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </span>
        <span className="sm:hidden">
          PFS{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </span>
      </button>

      <PfsStockDeductionPreviewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onDone={handleDone}
      />
    </>
  );
}
