"use client";

/**
 * Bouton « Journal » affiché dans la colonne Action de la Vue Mails
 * (/admin/clients?view=mails), à côté de « Envoyer un mail ».
 * Ouvre <EmailJournalModal> qui liste tous les emails envoyés à ce client.
 */

import { lazy, Suspense, useState } from "react";

const EmailJournalModal = lazy(() => import("./EmailJournalModal"));

interface Props {
  userId: string;
  userLabel: string;
  userEmail: string;
}

export default function EmailJournalButton({
  userId,
  userLabel,
  userEmail,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-body font-bold bg-bg-primary border border-border text-text-primary hover:bg-bg-secondary transition-colors"
        aria-label={`Voir le journal des emails de ${userLabel}`}
        title="Historique des emails envoyés à ce client"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <circle cx="3" cy="6" r="1" />
          <circle cx="3" cy="12" r="1" />
          <circle cx="3" cy="18" r="1" />
        </svg>
        Journal
      </button>
      {open && (
        <Suspense fallback={null}>
          <EmailJournalModal
            userId={userId}
            userLabel={userLabel}
            userEmail={userEmail}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
