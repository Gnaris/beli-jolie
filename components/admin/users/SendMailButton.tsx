"use client";

/**
 * Bouton « Envoyer un mail » affiché dans la colonne Action de la Vue Mails
 * (/admin/utilisateurs?view=mails). Ouvre <SendMailModal>.
 */

import { useState } from "react";
import SendMailModal from "./SendMailModal";

interface Props {
  userId: string;
  userLabel: string;
  userEmail: string;
}

export default function SendMailButton({ userId, userLabel, userEmail }: Props) {
  const [open, setOpen] = useState(false);

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
