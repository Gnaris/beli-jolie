"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

export default function LogoutButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex items-center gap-2 px-3 py-2 text-sm text-[#E2E8F0] hover:text-red-400 transition-colors font-[family-name:var(--font-roboto)] w-full"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
        </svg>
        Déconnexion
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full max-w-sm p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                </svg>
              </div>
              <div>
                <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#0F172A]">
                  Confirmer la déconnexion
                </h3>
                <p className="text-sm text-[#475569] font-[family-name:var(--font-roboto)] mt-1">
                  Voulez-vous vraiment quitter votre session administrateur ?
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/connexion" })}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-medium py-2 px-4 transition-colors font-[family-name:var(--font-roboto)]"
              >
                Se déconnecter
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 border border-[#E2E8F0] text-[#475569] hover:border-[#0F3460] hover:text-[#0F172A] text-sm font-medium py-2 px-4 transition-colors font-[family-name:var(--font-roboto)]"
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
