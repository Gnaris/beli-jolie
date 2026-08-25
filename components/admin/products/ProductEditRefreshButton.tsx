"use client";

import { useState } from "react";
import { useRefreshMarketplaceDialog } from "@/components/admin/products/useRefreshMarketplaceDialog";

export function ProductEditRefreshButton({
  productId,
  reference,
  productName,
  firstImage,
  status,
  isIncomplete,
  wasImported,
  locked = false,
  hasPfsConfig = true,
  hasAnkorstoreConfig = false,
  ankorstoreEnabled = false,
  hasEfashionConfig = false,
  efashionEnabled = false,
  hasFaireConfig = false,
  faireEnabled = false,
  hasOrderchampConfig = false,
  orderchampEnabled = false,
  orderchampProductId = null,
}: {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  wasImported: boolean;
  locked?: boolean;
  hasPfsConfig?: boolean;
  hasAnkorstoreConfig?: boolean;
  ankorstoreEnabled?: boolean;
  hasEfashionConfig?: boolean;
  efashionEnabled?: boolean;
  hasFaireConfig?: boolean;
  faireEnabled?: boolean;
  hasOrderchampConfig?: boolean;
  orderchampEnabled?: boolean;
  orderchampProductId?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const showAnkorstore = hasAnkorstoreConfig && ankorstoreEnabled;
  const showEfashion = hasEfashionConfig && efashionEnabled;
  const showFaire = hasFaireConfig && faireEnabled;
  // OC : aligné sur les autres marketplaces — la case n'apparaît que si le
  // produit est déjà lié. Un « Rafraîchir » sur un produit non-lié
  // enclencherait sinon la création côté OC (fallback publish).
  const showOrderchamp = hasOrderchampConfig && orderchampEnabled && !!orderchampProductId;
  const { refreshSingle } = useRefreshMarketplaceDialog({
    showPfs: hasPfsConfig,
    showAnkorstore,
    showEfashion,
    showFaire,
    showOrderchamp,
  });

  if (locked) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="inline-flex items-center justify-center gap-1.5 w-full md:w-auto px-2 md:px-3 py-2 md:py-1.5 text-[12px] font-medium text-text-muted bg-bg-secondary border border-border rounded-md font-body shadow-sm opacity-60 cursor-not-allowed whitespace-nowrap"
        title="Ce produit est verrouillé — rafraîchissement désactivé"
        aria-label="Rafraîchissement verrouillé"
      >
        <svg className="w-4 h-4 md:w-3.5 md:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
        <span className="hidden md:inline">Verrouillé</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        if (pending) return;
        setPending(true);
        try {
          await refreshSingle({
            productId,
            reference,
            productName,
            firstImage,
            status,
            isIncomplete,
            wasImported,
            orderchampProductId,
          });
        } finally {
          setPending(false);
        }
      }}
      disabled={pending}
      className="inline-flex items-center justify-center gap-1.5 w-full md:w-auto px-2 md:px-3 py-2 md:py-1.5 text-[12px] font-medium text-text-secondary bg-bg-primary border border-border rounded-md hover:bg-bg-secondary hover:border-border-dark hover:text-text-primary transition-all font-body shadow-sm disabled:opacity-50 disabled:cursor-wait whitespace-nowrap"
      title="Rafraîchir (boutique + marketplaces)"
      aria-label="Rafraîchir"
    >
      <svg
        className={`w-4 h-4 md:w-3.5 md:h-3.5 ${pending ? "animate-spin" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992"
        />
      </svg>
      <span className="hidden md:inline">Rafraîchir</span>
    </button>
  );
}
