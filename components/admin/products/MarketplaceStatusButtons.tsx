"use client";

import { useState } from "react";
import { usePfsRefreshQueue } from "./PfsRefreshContext";

interface MarketplaceStatusButtonsProps {
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  pfsProductId: string | null;
  ankorsProductId: string | null;
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
}

export function MarketplaceStatusButtons({
  productId,
  reference,
  productName,
  firstImage,
  pfsProductId,
  ankorsProductId,
  hasPfsConfig,
  hasAnkorstoreConfig,
}: MarketplaceStatusButtonsProps) {
  const { enqueue } = usePfsRefreshQueue();
  const [confirmTarget, setConfirmTarget] = useState<"pfs" | "ankorstore" | null>(null);

  const handlePublish = (target: "pfs" | "ankorstore") => {
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage,
        options: {
          local: false,
          pfs: target === "pfs",
          ankorstore: target === "ankorstore",
        },
        mode: "publish",
      },
    ]);
    setConfirmTarget(null);
  };

  return (
    <>
      {/* PFS Button */}
      {hasPfsConfig && (
        <button
          type="button"
          onClick={() => {
            if (pfsProductId) return;
            setConfirmTarget("pfs");
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold font-body border transition-all ${
            pfsProductId
              ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] cursor-default"
              : "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA] hover:bg-[#FEE2E2] cursor-pointer"
          }`}
          title={
            pfsProductId
              ? "Disponible sur Paris Fashion Shop"
              : "Non disponible — cliquez pour publier sur Paris Fashion Shop"
          }
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              pfsProductId ? "bg-[#22C55E]" : "bg-[#DC2626]"
            }`}
          />
          {pfsProductId ? (
            "Paris Fashion Shop"
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Non publié PFS
            </>
          )}
        </button>
      )}

      {/* Ankorstore Button */}
      {hasAnkorstoreConfig && (
        <button
          type="button"
          onClick={() => {
            if (ankorsProductId) return;
            setConfirmTarget("ankorstore");
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold font-body border transition-all ${
            ankorsProductId
              ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] cursor-default"
              : "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA] hover:bg-[#FEE2E2] cursor-pointer"
          }`}
          title={
            ankorsProductId
              ? "Disponible sur Ankorstore"
              : "Non disponible — cliquez pour publier sur Ankorstore"
          }
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              ankorsProductId ? "bg-[#22C55E]" : "bg-[#DC2626]"
            }`}
          />
          {ankorsProductId ? (
            "Ankorstore"
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Non publié Ankorstore
            </>
          )}
        </button>
      )}

      {/* Confirmation Modal */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEF2F2] flex items-center justify-center">
                <svg className="w-5 h-5 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="font-heading font-bold text-text-primary">
                  Publier sur {confirmTarget === "pfs" ? "Paris Fashion Shop" : "Ankorstore"} ?
                </h3>
                <p className="text-sm text-text-secondary font-body">
                  {productName} ({reference})
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary font-body">
              Ce produit n&apos;existe pas encore sur {confirmTarget === "pfs" ? "Paris Fashion Shop" : "Ankorstore"}.
              Voulez-vous le créer maintenant ?
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-xl hover:bg-bg-tertiary transition-colors font-body"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handlePublish(confirmTarget)}
                className="px-4 py-2 text-sm font-medium text-white bg-[#DC2626] rounded-xl hover:bg-[#B91C1C] transition-colors font-body"
              >
                Oui, publier
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
