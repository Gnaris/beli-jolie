"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { signOut } from "next-auth/react";

export default function LogoutButton() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-2.5 px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors font-[family-name:var(--font-roboto)] w-full"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
        </svg>
        Deconnexion
      </button>

      {open && mounted && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-bg-primary w-full max-w-sm p-6 space-y-4 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-bg-secondary flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                </svg>
              </div>
              <div>
                <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary">
                  Confirmer la deconnexion
                </h3>
                <p className="text-sm text-text-secondary font-[family-name:var(--font-roboto)] mt-1">
                  Voulez-vous vraiment quitter votre session administrateur ?
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/connexion" })}
                className="flex-1 bg-bg-dark hover:bg-neutral-800 text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-colors font-[family-name:var(--font-roboto)]"
              >
                Se deconnecter
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 border border-border text-text-secondary hover:border-bg-dark hover:text-text-primary text-sm font-medium py-2.5 px-4 rounded-lg transition-colors font-[family-name:var(--font-roboto)]"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
