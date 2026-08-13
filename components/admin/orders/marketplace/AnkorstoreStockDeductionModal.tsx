/**
 * STUB temporaire — Ankorstore Orders désactivé (2026-08-13).
 * À remplacer lors de la ré-implémentation via lib/ankorstore-bo/orders.ts.
 */
"use client";

interface Props {
  open: boolean;
  onClose: () => void;
  [key: string]: unknown;
}

export default function AnkorstoreStockDeductionModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 font-heading text-lg font-bold">Ankorstore désactivé</h2>
        <p className="text-sm text-text-secondary">
          La déduction de stock automatique Ankorstore est temporairement suspendue.
        </p>
        <button onClick={onClose} className="mt-4 rounded-xl bg-bg-dark px-4 py-2 text-sm font-medium text-text-inverse">
          Fermer
        </button>
      </div>
    </div>
  );
}
