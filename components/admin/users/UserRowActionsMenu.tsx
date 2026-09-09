"use client";

/**
 * Bouton d'action dans la colonne « Action » de /admin/clients.
 * Simple lien vers la fiche client — pas de menu déroulant.
 */

import Link from "next/link";

interface Props {
  userId: string;
  userLabel: string;
  userEmail: string;
  isPending: boolean;
}

export default function UserRowActionsMenu({ userId, isPending }: Props) {
  return (
    <Link
      href={`/admin/clients/${userId}`}
      className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold text-text-primary border border-border hover:bg-bg-secondary transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      {isPending ? "Examiner" : "Voir"}
    </Link>
  );
}
