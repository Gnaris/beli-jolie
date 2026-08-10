"use client";

/**
 * Toggle « Infos / Mails » au-dessus de la liste des clients inscrits.
 *
 * Bascule via URL param `?view=infos` (défaut) ou `?view=mails`. Les 2 URLs
 * sont pré-calculées côté serveur (préservent les autres filtres) et passées
 * en prop pour éviter tout recalcul client.
 */

import Link from "next/link";

interface Props {
  view: "infos" | "mails";
  infosHref: string;
  mailsHref: string;
}

export default function UsersViewToggle({ view, infosHref, mailsHref }: Props) {
  return (
    <div className="inline-flex items-center rounded-xl border border-border bg-bg-primary p-1 shadow-sm">
      <Link
        href={infosHref}
        prefetch={false}
        aria-current={view === "infos" ? "page" : undefined}
        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-body font-semibold rounded-lg transition-all ${
          view === "infos"
            ? "bg-gradient-to-br from-text-primary to-text-secondary text-white shadow-sm"
            : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        Infos
      </Link>
      <Link
        href={mailsHref}
        prefetch={false}
        aria-current={view === "mails" ? "page" : undefined}
        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-body font-semibold rounded-lg transition-all ${
          view === "mails"
            ? "bg-gradient-to-br from-text-primary to-text-secondary text-white shadow-sm"
            : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        Mails
      </Link>
    </div>
  );
}
