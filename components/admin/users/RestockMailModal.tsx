"use client";

/**
 * Modale plein écran pour éditer le mail de notification « retour en stock ».
 * Pattern miroir de `AbandonedCartMailModal` / `InactiveClientMailModal`,
 * mais simplifié : le scénario RESTOCK n'a qu'un seul modèle (pas de stades),
 * donc pas de pills de sélection — on ouvre directement sur le template.
 */

import { useEffect, useState } from "react";
import NewsletterHtmlEditorClient from "@/components/admin/newsletter/NewsletterHtmlEditorClient";
import {
  getNewsletterTemplate,
  type NewsletterTemplateFull,
} from "@/app/actions/admin/newsletter-templates";

interface Props {
  templateId: string;
  templateName: string;
  onClose: () => void;
}

export default function RestockMailModal({
  templateId,
  templateName,
  onClose,
}: Props) {
  const [template, setTemplate] = useState<NewsletterTemplateFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getNewsletterTemplate(templateId)
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
  }, [templateId]);

  return (
    <div className="fixed inset-0 z-[100] bg-bg-primary flex flex-col">
      <div className="shrink-0 border-b border-border bg-gradient-to-r from-violet-50 to-bg-primary">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10.5px] font-body font-bold uppercase tracking-[0.14em] text-violet-800">
            Retour en stock
          </span>
          <div className="h-4 w-px bg-border" />
          <span className="text-[12px] font-body font-semibold text-text-primary truncate flex-1 min-w-0">
            {templateName}
          </span>
          <span
            className="shrink-0 text-[11px] font-body italic text-text-muted"
            title="Fermez via le bouton ← Retour ci-dessous — il vous alerte si vous avez des modifs non enregistrées."
          >
            ← Retour depuis l&apos;éditeur ci-dessous
          </span>
        </div>
      </div>

      {/* overflow-y-auto : indispensable pour l'éditeur HTML (min-h-screen). */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-bg-secondary">
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
          <NewsletterHtmlEditorClient
            key={template.id}
            template={template}
            onLeave={onClose}
          />
        ) : null}
      </div>
    </div>
  );
}
