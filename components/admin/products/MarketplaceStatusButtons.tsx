"use client";

import { useState } from "react";
import { usePfsRefreshQueue } from "./PfsRefreshContext";

interface MarketplaceStatusButtonsProps {
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  pfsProductId: string | null;
  hasPfsConfig: boolean;
}

export function MarketplaceStatusButtons({
  productId,
  reference,
  productName,
  firstImage,
  pfsProductId,
  hasPfsConfig,
}: MarketplaceStatusButtonsProps) {
  const { enqueue } = usePfsRefreshQueue();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resyncOpen, setResyncOpen] = useState(false);

  const handlePublish = () => {
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage,
        options: { local: false, pfs: true },
        mode: "publish",
      },
    ]);
    setConfirmOpen(false);
  };

  const handleResync = () => {
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage,
        options: { local: false, pfs: true },
        mode: "resync",
      },
    ]);
    setResyncOpen(false);
  };

  if (!hasPfsConfig) return null;

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            if (pfsProductId) return;
            setConfirmOpen(true);
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-semibold font-body border transition-all ${
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

        {pfsProductId && (
          <button
            type="button"
            onClick={() => setResyncOpen(true)}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] hover:bg-[#DCFCE7] transition-colors"
            title="Resynchroniser toutes les données sur Paris Fashion Shop"
            aria-label="Resynchroniser sur Paris Fashion Shop"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
            </svg>
          </button>
        )}
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-none shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEF2F2] flex items-center justify-center">
                <svg className="w-5 h-5 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="font-heading font-bold text-text-primary">
                  Publier sur Paris Fashion Shop ?
                </h3>
                <p className="text-sm text-text-secondary font-body">
                  {productName} ({reference})
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary font-body">
              Ce produit n&apos;existe pas encore sur Paris Fashion Shop.
              Voulez-vous le créer maintenant ?
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary transition-colors font-body"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handlePublish}
                className="px-4 py-2 text-sm font-medium text-white bg-[#DC2626] rounded-none hover:bg-[#B91C1C] transition-colors font-body"
              >
                Oui, publier
              </button>
            </div>
          </div>
        </div>
      )}

      {resyncOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-none shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#F0FDF4] flex items-center justify-center">
                <svg className="w-5 h-5 text-[#15803D]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              </div>
              <div>
                <h3 className="font-heading font-bold text-text-primary">
                  Resynchroniser sur Paris Fashion Shop ?
                </h3>
                <p className="text-sm text-text-secondary font-body">
                  {productName} ({reference})
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary font-body">
              Toutes les données du produit (nom, description, photos, prix, stock,
              statut, Best Seller, variantes) seront renvoyées à Paris Fashion Shop
              pour s&apos;assurer que les deux côtés sont identiques. L&apos;identifiant
              PFS du produit reste inchangé.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setResyncOpen(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary transition-colors font-body"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleResync}
                className="px-4 py-2 text-sm font-medium text-white bg-[#15803D] rounded-none hover:bg-[#166534] transition-colors font-body"
              >
                Oui, resynchroniser
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
