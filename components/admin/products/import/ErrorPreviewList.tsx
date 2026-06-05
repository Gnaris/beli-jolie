"use client";

import { useState } from "react";

interface ErrorPreviewEntry {
  label: string;
  sublabel?: string;
  errors: string[];
}

interface Props {
  preview: ErrorPreviewEntry[];
  totalErrors: number;
}

/**
 * Liste pliable des erreurs détectées pendant l'import. Affichée en temps
 * réel pendant le traitement (polling) puis figée à la fin. La cliente voit
 * exactement quels produits/fichiers ont échoué et pourquoi, sans devoir
 * attendre la fin pour aller consulter l'historique.
 *
 * `preview` est limité côté serveur à 50 entrées max ; si `totalErrors`
 * dépasse 50, on affiche une mention « + X autres ».
 */
export default function ErrorPreviewList({ preview, totalErrors }: Props) {
  const [open, setOpen] = useState(false);

  if (preview.length === 0) return null;

  const extra = Math.max(0, totalErrors - preview.length);

  return (
    <div className="border border-red-200 bg-red-50/50 rounded-xl overflow-hidden text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-red-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-sm font-medium text-red-800 font-body">
            {totalErrors} erreur{totalErrors > 1 ? "s" : ""} détectée{totalErrors > 1 ? "s" : ""}
          </span>
        </div>
        <svg className={`w-4 h-4 text-red-600 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-red-200 bg-bg-primary max-h-80 overflow-y-auto">
          <ul className="divide-y divide-red-100">
            {preview.map((entry, i) => (
              <li key={`${entry.label}-${i}`} className="px-4 py-2.5 text-left">
                <p className="text-sm font-medium text-text-primary font-body break-all">
                  {entry.label}
                  {entry.sublabel && (
                    <span className="ml-2 text-xs text-text-muted font-normal">{entry.sublabel}</span>
                  )}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {entry.errors.map((err, j) => (
                    <li key={j} className="text-xs text-red-700 font-body">• {err}</li>
                  ))}
                </ul>
              </li>
            ))}
            {extra > 0 && (
              <li className="px-4 py-2 text-xs text-text-muted italic font-body">
                + {extra} autre{extra > 1 ? "s" : ""} erreur{extra > 1 ? "s" : ""} non affichée{extra > 1 ? "s" : ""} ici — consultez l&apos;historique pour la liste complète.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
