/**
 * STUB temporaire — Ankorstore Orders désactivé (2026-08-13).
 * L'ancien drawer sera reconstruit sur lib/ankorstore-bo/orders.ts lors du
 * prochain reverse. En attendant, il rend un message informant l'admin.
 */
"use client";

import type { AnkorstoreOrderDetailFull } from "@/app/actions/admin/ankorstore-orders";

interface Props {
  order: AnkorstoreOrderDetailFull | null;
  onClose: () => void;
}

export default function AnkorstoreOrderDrawer({ order, onClose }: Props) {
  if (!order) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 font-heading text-lg font-bold text-text-primary">Ankorstore — commandes désactivées</h2>
        <p className="text-sm text-text-secondary">
          La synchronisation des commandes Ankorstore est temporairement désactivée
          pendant le chantier de reverse-engineering. Consulte tes commandes
          directement sur <span className="font-mono">fr.ankorstore.com</span>.
        </p>
        <button
          onClick={onClose}
          className="mt-4 rounded-xl bg-bg-dark px-4 py-2 text-sm font-medium text-text-inverse"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
