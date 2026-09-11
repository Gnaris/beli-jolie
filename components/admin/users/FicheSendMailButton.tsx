"use client";

/**
 * Bouton « Envoyer mail » dans une ligne fiche de la Vue Mails marketing.
 * Grisé + tooltip si la fiche n'a pas d'email.
 * Ouvre <FicheSendMailModal> (newsletter uniquement — pas de panier/inactif/restock
 * comme les vrais clients inscrits car une fiche n'a ni compte ni panier).
 */

import { useState } from "react";
import FicheSendMailModal from "./FicheSendMailModal";

interface Props {
  ficheId: string;
  ficheLabel: string;
  ficheEmail: string | null;
}

export default function FicheSendMailButton({ ficheId, ficheLabel, ficheEmail }: Props) {
  const [open, setOpen] = useState(false);

  if (!ficheEmail) {
    return (
      <button
        type="button"
        disabled
        title="Cette fiche n'a pas d'email — impossible d'envoyer un mail."
        aria-label="Pas d'email"
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-body font-bold bg-bg-tertiary text-text-muted border border-border cursor-not-allowed"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18.36 6.64a9 9 0 11-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
        Pas d&apos;email
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-body font-bold bg-gradient-to-br from-slate-800 to-slate-900 text-white shadow-sm hover:opacity-90 transition-opacity"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        Envoyer mail
      </button>

      {open && (
        <FicheSendMailModal
          ficheId={ficheId}
          ficheLabel={ficheLabel}
          ficheEmail={ficheEmail}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
