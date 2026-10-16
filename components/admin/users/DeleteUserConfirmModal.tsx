"use client";

/**
 * Modale de confirmation de suppression définitive d'un client.
 * Réutilisée par :
 *   - DeleteUserButton (fiche client /admin/clients/[id])
 *   - UserRowActionsMenu (menu Actions sur /admin/clients)
 *
 * La cliente doit retaper « Supprimer » pour activer le bouton rouge — garde-fou
 * contre les clics accidentels sur un compte avec panier/favoris/commandes.
 */

import { useState, useTransition, useEffect } from "react";
import { createPortal } from "react-dom";
import { deleteUser } from "@/app/actions/admin/deleteUser";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useToast } from "@/components/ui/Toast";

interface Props {
  userId: string;
  userName: string;
  onClose: () => void;
  /** Appelé après une suppression réussie. Le caller décide quoi faire ensuite
   *  (redirect vers la liste depuis la fiche, refresh depuis la liste, etc.). */
  onSuccess: () => void;
}

export default function DeleteUserConfirmModal({ userId, userName, onClose, onSuccess }: Props) {
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const { showLoading, hideLoading } = useLoadingOverlay();
  const toast = useToast();

  // On attend que window soit disponible avant d'utiliser createPortal — sinon
  // le rendu serveur plante (le composant est "use client" mais Next peut
  // malgré tout le pré-rendre si on l'importe depuis un server component).
  useEffect(() => setMounted(true), []);

  function handleDelete() {
    if (confirmText !== "Supprimer") return;
    showLoading();
    startTransition(async () => {
      try {
        const result = await deleteUser(userId);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("Client supprimé");
        onSuccess();
      } finally {
        hideLoading();
      }
    });
  }

  function handleCancel() {
    setConfirmText("");
    onClose();
  }

  if (!mounted) return null;

  // Rendu via portail sur document.body : évite d'hériter de `whitespace-nowrap`
  // ou d'autres contraintes de la cellule <td> depuis laquelle le menu Actions
  // peut ouvrir la modale (sinon le texte déborde horizontalement).
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 whitespace-normal">
      <div className="bg-bg-primary rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h3 className="font-heading text-lg font-semibold text-text-primary">
              Supprimer le client
            </h3>
            <p className="text-sm text-text-secondary font-body">
              Cette action est irréversible.
            </p>
          </div>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-800 font-body">
            Vous êtes sur le point de supprimer définitivement le compte de <strong>{userName}</strong> ainsi que toutes ses données associées (panier, favoris, adresses).
          </p>
        </div>

        <div>
          <label className="block text-sm font-body font-semibold text-text-secondary mb-1.5">
            Tapez <span className="font-mono text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Supprimer</span> pour confirmer
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Supprimer"
            className="field-input w-full"
            autoFocus
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={confirmText !== "Supprimer" || isPending}
            className="flex-1 bg-red-600 text-white text-sm font-body font-medium py-2.5 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? "Suppression..." : "Supprimer définitivement"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="flex-1 btn-secondary py-2.5"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
