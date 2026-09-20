"use client";

/**
 * Modale plein écran pour éditer les mails des stades de relance inactivité.
 * Miroir strict de AbandonedCartMailModal — même UX, palette violette.
 */

import { useEffect, useState } from "react";
import NewsletterEditorClient from "@/components/admin/users/NewsletterEditorClient";
import {
  getNewsletterTemplate,
  type NewsletterTemplateFull,
} from "@/app/actions/admin/newsletter-templates";
import type { InactiveClientStageDTO } from "@/app/actions/admin/inactive-client";

interface Props {
  stages: InactiveClientStageDTO[];
  initialStageId: string;
  onClose: () => void;
}

export default function InactiveClientMailModal({
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

  return (
    <div className="fixed inset-0 z-[100] bg-bg-primary flex flex-col">
      <div className="shrink-0 border-b border-border bg-gradient-to-r from-violet-50 to-bg-primary">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10.5px] font-body font-bold uppercase tracking-[0.14em] text-violet-800">
            Relance inactivité
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
                      ? "bg-gradient-to-br from-violet-600 to-violet-700 text-white shadow-sm"
                      : "bg-bg-primary border border-border text-text-secondary hover:border-violet-300 hover:text-violet-800"
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
          <span
            className="shrink-0 text-[11px] font-body italic text-text-muted"
            title="Fermez via le bouton ← Retour ci-dessous — il vous alerte si vous avez des modifs non enregistrées."
          >
            ← Retour depuis l&apos;éditeur ci-dessous
          </span>
        </div>
      </div>

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
          <NewsletterEditorClient
            key={template.id}
            template={template}
            onLeave={onClose}
            enforceScenario="INACTIVE_CLIENT"
          />
        ) : null}
      </div>
    </div>
  );
}
