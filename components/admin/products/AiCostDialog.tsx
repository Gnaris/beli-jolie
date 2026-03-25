"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";

interface AiCostDialogProps {
  estimatedCostUsd: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function AiCostDialog({ estimatedCostUsd, onConfirm, onCancel }: AiCostDialogProps) {
  const [mounted, setMounted] = useState(false);
  const backdrop = useBackdropClose(onCancel);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
      role="dialog"
      aria-modal="true"
      aria-label="Générer avec l'IA"
    >
      <div
        className="bg-bg-primary rounded-2xl p-6 w-full max-w-sm shadow-[0_20px_60px_rgba(0,0,0,0.4)] space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-[#16A34A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
          </div>
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary">
              Générer avec l&apos;IA
            </h3>
            <p className="text-sm text-text-secondary font-[family-name:var(--font-roboto)] mt-1">
              L&apos;IA va analyser les images et les informations du produit pour générer
              le nom et la description dans toutes les langues.
            </p>
          </div>
        </div>

        {/* Cost */}
        <div className="bg-bg-secondary border border-border rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary font-[family-name:var(--font-roboto)]">Coût estimé</span>
            <span className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary">
              ~${estimatedCostUsd.toFixed(4)}
            </span>
          </div>
          <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
            Facturé sur votre compte API Anthropic
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 bg-[#1A1A1A] hover:bg-black text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-colors font-[family-name:var(--font-roboto)]"
          >
            Générer
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 border border-border text-text-secondary hover:border-[#1A1A1A] hover:text-text-primary text-sm font-medium py-2.5 px-4 rounded-lg transition-colors font-[family-name:var(--font-roboto)]"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
