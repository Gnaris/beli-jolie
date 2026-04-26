"use client";

import { useState, useTransition } from "react";
import { deleteCatalog } from "@/app/actions/admin/catalogs";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  id: string;
  title: string;
}

export default function DeleteCatalogButton({ id, title }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();

  const handleDelete = () => {
    showLoading();
    startTransition(async () => {
      try {
        await deleteCatalog(id);
      } finally {
        hideLoading();
        setShowModal(false);
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        title={`Supprimer "${title}"`}
        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-[#FEF2F2] hover:border-[#FCA5A5] hover:text-[#EF4444] transition-colors text-[#6B7280]"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
        </svg>
      </button>

      {/* Modal de confirmation */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !isPending && setShowModal(false)} />
          <div className="relative bg-bg-primary rounded-2xl shadow-lg border border-border w-full max-w-sm p-6 space-y-4">
            {/* Icône */}
            <div className="w-12 h-12 mx-auto rounded-xl bg-[#FEF2F2] flex items-center justify-center">
              <svg className="w-6 h-6 text-[#EF4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </div>

            {/* Texte */}
            <div className="text-center">
              <h3 className="font-heading font-semibold text-text-primary text-base mb-1">
                Supprimer ce catalogue ?
              </h3>
              <p className="text-sm text-text-muted font-body">
                Le catalogue <span className="font-medium text-text-primary">&laquo;&nbsp;{title}&nbsp;&raquo;</span> sera supprim&eacute; d&eacute;finitivement avec tous ses produits associ&eacute;s.
              </p>
            </div>

            {/* Boutons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                disabled={isPending}
                className="flex-1 h-10 rounded-xl border border-border text-sm font-medium font-body text-text-muted hover:bg-bg-secondary transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="flex-1 h-10 rounded-xl bg-[#EF4444] text-white text-sm font-medium font-body hover:bg-[#DC2626] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Suppression...
                  </>
                ) : (
                  "Supprimer"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
