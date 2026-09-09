"use client";

/**
 * Modale plein écran pour éditer les mails des stades du panier abandonné.
 *
 * Bandeau en haut avec les chips « Stade 1 · 2 · 3… » pour switcher entre les
 * stades sans changer d'URL. En dessous, l'éditeur newsletter classique
 * (`NewsletterEditorClient`) monté avec `onLeave` = fermer la modale.
 *
 * Le switch entre stades recharge le template complet via `getNewsletterTemplate`
 * (server action) — pas de router.push, pas de URL change. Si l'éditeur a des
 * modifs non-sauvegardées, un `dirty guard` propre est délégué à
 * NewsletterEditorClient (modale « quitter sans enregistrer » interne).
 */

import { useEffect, useState } from "react";
import NewsletterEditorClient from "@/components/admin/users/NewsletterEditorClient";
import {
  getNewsletterTemplate,
  type NewsletterTemplateFull,
} from "@/app/actions/admin/newsletter-templates";
import type { AbandonedCartStageDTO } from "@/app/actions/admin/abandoned-cart";

interface Props {
  stages: AbandonedCartStageDTO[];
  /** ID du stade ouvert à l'affichage initial. */
  initialStageId: string;
  onClose: () => void;
}

export default function AbandonedCartMailModal({
  stages,
  initialStageId,
  onClose,
}: Props) {
  const [activeStageId, setActiveStageId] = useState(initialStageId);
  const [template, setTemplate] = useState<NewsletterTemplateFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeStage = stages.find((s) => s.id === activeStageId);

  useEffect(() => {
    if (!activeStage) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // On remonte le composant éditeur (key change) pour repartir de zéro.
    getNewsletterTemplate(activeStage.templateId)
      .then((tpl) => {
        if (cancelled) return;
        if (!tpl) {
          setError("Modèle introuvable.");
          setTemplate(null);
        } else {
          setTemplate(tpl);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStage]);

  // Ferme la modale à l'ESC — l'éditeur intercepte lui-même les modifs non-
  // sauvegardées (leaveWithoutSaving demande confirmation si dirty=true).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-bg-primary flex flex-col">
      {/* ─── Bandeau switcher stades ─── */}
      <div className="shrink-0 border-b border-border bg-gradient-to-r from-amber-50 to-bg-primary">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10.5px] font-body font-bold uppercase tracking-[0.14em] text-amber-800">
            Panier abandonné
          </span>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
            {stages.map((s) => {
              const isActive = s.id === activeStageId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveStageId(s.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-body font-semibold transition-all ${
                    isActive
                      ? "bg-gradient-to-br from-amber-600 to-amber-700 text-white shadow-sm"
                      : "bg-bg-primary border border-border text-text-secondary hover:border-amber-300 hover:text-amber-800"
                  }`}
                  title={s.templateName}
                >
                  Stade {s.stageIndex}
                  {!s.templateHasUnsubscribeLink && (
                    <span
                      className={`inline-flex w-4 h-4 items-center justify-center rounded-full text-[9px] ${
                        isActive ? "bg-white/20 text-white" : "bg-red-100 text-red-700"
                      }`}
                      title="Lien de désinscription manquant"
                    >
                      ⚠
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-body font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            title="Fermer (Échap)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
            Fermer
          </button>
        </div>
      </div>

      {/* ─── Corps : éditeur newsletter monté sur le stade actif ─── */}
      <div className="flex-1 min-h-0 overflow-hidden bg-bg-secondary">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm font-body text-text-muted">
              Chargement du modèle…
            </p>
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm font-body text-red-700">{error}</p>
          </div>
        ) : template ? (
          // key = template.id : force le remount de l'éditeur quand on switche
          // de stade, sinon les states internes (blocs sélectionnés, etc.)
          // resteraient bloqués sur l'ancien template.
          <NewsletterEditorClient
            key={template.id}
            template={template}
            onLeave={onClose}
          />
        ) : null}
      </div>
    </div>
  );
}
