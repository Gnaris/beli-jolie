"use client";

/**
 * Sous-modale « Détail du mail » ouverte depuis <EmailJournalModal>.
 * Affiche les métadonnées ligne/colonne + le contenu HTML tel que reçu
 * par le client (sandbox iframe pour éviter tout effet de bord CSS/JS).
 * Bouton « Renvoyer » actif quand le mail est en échec OU sur demande.
 */

import { useEffect, useState, useTransition } from "react";
import {
  getEmailSendDetail,
  resendEmail,
  type EmailSendDetail,
} from "@/app/actions/admin/email-journal";
import { useToast } from "@/components/ui/Toast";
import { getScenarioLabel } from "@/lib/email-scenarios";

interface Props {
  emailSendId: string;
  onClose: () => void;
  onResent: () => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function EmailDetailModal({ emailSendId, onClose, onResent }: Props) {
  const [detail, setDetail] = useState<EmailSendDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [resending, startResend] = useTransition();
  const toast = useToast();

  useEffect(() => {
    startLoading(async () => {
      const res = await getEmailSendDetail(emailSendId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setError(null);
      setDetail(res.detail);
    });
  }, [emailSendId]);

  const handleResend = () => {
    startResend(async () => {
      const res = await resendEmail(emailSendId);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      onResent();
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between px-8 py-6 border-b border-border">
          <div>
            <h3 className="text-lg font-heading font-bold text-text-primary">Détail du mail</h3>
            {detail && (
              <p className="text-sm text-text-muted mt-1">
                Envoyé le {formatDateTime(detail.sentAt)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-3xl leading-none w-10 h-10 flex items-center justify-center shrink-0"
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        {loading && !detail && (
          <div className="px-8 py-12 text-center text-sm text-text-muted">Chargement…</div>
        )}

        {error && (
          <div className="px-8 py-5 text-sm text-rose-700 bg-rose-50 border-b border-rose-200">
            {error}
          </div>
        )}

        {detail && (
          <>
            {/* Détails ligne / colonne — tout aligné à gauche */}
            <div className="px-8 py-6 border-b border-border text-sm">
              <dl className="grid grid-cols-[120px_1fr] gap-y-3 gap-x-4 text-left">
                <dt className="text-left text-text-muted m-0">Type</dt>
                <dd className="text-left text-text-primary m-0">
                  <span className="inline-flex items-center text-xs px-2.5 py-1 rounded bg-bg-secondary border border-border">
                    {getScenarioLabel(detail.scenarioKey)}
                  </span>
                  {detail.resendOfId && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600" title="Ceci est un renvoi manuel">
                      renvoi
                    </span>
                  )}
                </dd>

                <dt className="text-left text-text-muted m-0">Statut</dt>
                <dd className="text-left m-0">
                  {detail.status === "FAILED" ? (
                    <span className="inline-flex items-center text-xs px-3 py-1 rounded-full bg-rose-100 text-rose-700 font-medium">
                      ❌ Échec
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-xs px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                      ✅ Envoyé
                    </span>
                  )}
                </dd>

                {detail.fromEmail && (
                  <>
                    <dt className="text-left text-text-muted m-0">De</dt>
                    <dd className="text-left text-text-primary m-0 break-all">
                      {detail.fromName ? `${detail.fromName} <${detail.fromEmail}>` : detail.fromEmail}
                    </dd>
                  </>
                )}

                <dt className="text-left text-text-muted m-0">À</dt>
                <dd className="text-left text-text-primary m-0 break-all">{detail.recipientEmail}</dd>

                <dt className="text-left text-text-muted m-0">Sujet</dt>
                <dd className="text-left text-text-primary font-medium break-words m-0">{detail.subject}</dd>

                {detail.errorMessage && (
                  <>
                    <dt className="text-left text-text-muted m-0">Erreur</dt>
                    <dd className="text-left text-rose-700 text-xs font-mono break-all m-0">
                      {detail.errorMessage}
                    </dd>
                  </>
                )}

                {detail.attempts > 1 && (
                  <>
                    <dt className="text-left text-text-muted m-0">Tentatives</dt>
                    <dd className="text-left text-text-primary m-0">{detail.attempts}</dd>
                  </>
                )}
              </dl>
            </div>

            {/* Contenu du mail */}
            <div className="px-8 py-3 text-xs uppercase tracking-[0.12em] text-text-muted font-semibold border-b border-border">
              Contenu envoyé
            </div>
            <div className="flex-1 overflow-auto bg-bg-secondary p-6">
              {detail.htmlBody ? (
                <iframe
                  srcDoc={detail.htmlBody}
                  sandbox=""
                  className="w-full min-h-[520px] bg-white border border-border rounded-lg"
                  title="Aperçu du mail envoyé"
                />
              ) : (
                <div className="text-center text-sm text-text-muted p-12">
                  Le contenu de ce mail n'a pas été conservé (mail historique).
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-end gap-3 px-8 py-5 border-t border-border bg-bg-secondary">
              <button
                type="button"
                onClick={onClose}
                className="text-xs px-3 h-8 rounded bg-bg-primary border border-border text-text-primary hover:bg-bg-secondary transition-colors"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={resending || !detail.htmlBody}
                className="text-xs px-3 h-8 rounded bg-gradient-to-br from-slate-800 to-slate-900 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                title={!detail.htmlBody ? "Contenu original absent — renvoi impossible" : "Renvoyer ce mail au client"}
              >
                {resending ? "Envoi…" : "↻ Renvoyer ce mail"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
