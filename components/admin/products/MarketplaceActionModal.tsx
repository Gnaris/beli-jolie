"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";

interface Props {
  open: boolean;
  marketplaceName: string;
  marketplaceCode: string;
  productLabel: string;
  canCreate: boolean;
  canLink: boolean;
  createDisabledReason?: string;
  onClose: () => void;
  onCreate: () => void;
  onLink: () => void;
}

export default function MarketplaceActionModal({
  open,
  marketplaceName,
  marketplaceCode,
  productLabel,
  canCreate,
  canLink,
  createDisabledReason,
  onClose,
  onCreate,
  onLink,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const backdrop = useBackdropClose(onClose);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="bg-bg-primary w-full max-w-lg rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-bg-secondary border border-border flex items-center justify-center shrink-0 font-heading font-bold text-text-primary text-sm">
              {marketplaceCode}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-heading text-base font-semibold text-text-primary leading-tight">
                {marketplaceName}
              </h3>
              <p className="text-[12.5px] text-text-secondary font-body mt-0.5 truncate">
                {productLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="w-8 h-8 rounded-lg text-text-muted hover:bg-bg-secondary hover:text-text-primary flex items-center justify-center shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Corps : 2 gros boutons horizontaux */}
        <div className="p-6">
          <p className="text-[13px] text-text-secondary font-body mb-4 leading-relaxed">
            Voulez-vous créer un nouveau produit sur <strong>{marketplaceName}</strong> ou
            le lier à une fiche déjà existante ?
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Créer */}
            <button
              type="button"
              onClick={canCreate ? onCreate : undefined}
              disabled={!canCreate}
              title={canCreate ? undefined : createDisabledReason}
              className={`group relative overflow-hidden text-left p-5 rounded-xl border-2 transition-all ${
                canCreate
                  ? "bg-bg-primary border-border hover:border-ink hover:shadow-[var(--shadow-pop)] cursor-pointer"
                  : "bg-bg-secondary border-border opacity-50 cursor-not-allowed"
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                canCreate ? "bg-ink text-text-inverse" : "bg-bg-tertiary text-text-muted"
              }`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <div className="font-heading text-[15px] font-bold text-text-primary leading-tight">
                Créer le produit
              </div>
              <div className="text-[12px] text-text-secondary font-body mt-1 leading-snug">
                Publier une nouvelle fiche sur {marketplaceName}.
              </div>
              {!canCreate && createDisabledReason && (
                <div className="text-[11px] text-warning font-body mt-2 leading-snug">
                  ⚠ {createDisabledReason}
                </div>
              )}
            </button>

            {/* Lier */}
            <button
              type="button"
              onClick={canLink ? onLink : undefined}
              disabled={!canLink}
              className={`group relative overflow-hidden text-left p-5 rounded-xl border-2 transition-all ${
                canLink
                  ? "bg-bg-primary border-border hover:border-ink hover:shadow-[var(--shadow-pop)] cursor-pointer"
                  : "bg-bg-secondary border-border opacity-50 cursor-not-allowed"
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                canLink ? "bg-ink text-text-inverse" : "bg-bg-tertiary text-text-muted"
              }`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
              </div>
              <div className="font-heading text-[15px] font-bold text-text-primary leading-tight">
                Lier à un existant
              </div>
              <div className="text-[12px] text-text-secondary font-body mt-1 leading-snug">
                Rattacher à une fiche {marketplaceName} déjà créée.
              </div>
            </button>
          </div>
        </div>

        {/* Pied : annuler */}
        <div className="px-6 pb-5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-full text-[13px] text-text-secondary hover:text-text-primary font-body py-2"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
