"use client";

/**
 * Bouton « Envoyer un mail » affiché dans la colonne Action de la Vue Mails
 * (/admin/utilisateurs?view=mails). Ouvre <SendMailModal>.
 *
 * Bloqué (grisé + tooltip) si le client n'a pas accepté la newsletter — la
 * case unique couvre newsletter + relances panier + retour en stock (RGPD).
 */

import { useState } from "react";
import SendMailModal from "./SendMailModal";

interface Props {
  userId: string;
  userLabel: string;
  userEmail: string;
  acceptsNewsletter: boolean;
}

export default function SendMailButton({
  userId,
  userLabel,
  userEmail,
  acceptsNewsletter,
}: Props) {
  const [open, setOpen] = useState(false);

  if (!acceptsNewsletter) {
    return (
      <button
        type="button"
        disabled
        title="Ce client n'a pas accepté de recevoir des emails marketing (RGPD). Envoi bloqué."
        aria-label="Envoi bloqué — client désinscrit de la newsletter"
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-body font-bold bg-bg-tertiary text-text-muted border border-border cursor-not-allowed"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18.36 6.64a9 9 0 11-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
        Désinscrit
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
        <SendMailModal
          userId={userId}
          userLabel={userLabel}
          userEmail={userEmail}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
