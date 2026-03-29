"use client";

import { useState, useTransition } from "react";
import { deleteUser } from "@/app/actions/admin/deleteUser";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

export default function DeleteUserButton({ userId, userName }: { userId: string; userName: string }) {
  const [showModal, setShowModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();

  function handleDelete() {
    if (confirmText !== "Supprimer") return;
    showLoading();
    startTransition(async () => {
      try {
        await deleteUser(userId);
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="btn-danger"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Supprimer definitivement
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
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
                  Cette action est irreversible.
                </p>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm text-red-800 font-body">
                Vous etes sur le point de supprimer definitivement le compte de <strong>{userName}</strong> ainsi que toutes ses donnees associees (panier, favoris, adresses).
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
                {isPending ? "Suppression..." : "Supprimer definitivement"}
              </button>
              <button
                type="button"
                onClick={() => { setShowModal(false); setConfirmText(""); }}
                className="flex-1 btn-secondary py-2.5"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
