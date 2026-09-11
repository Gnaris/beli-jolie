"use client";

/**
 * Modale d'envoi d'un mail newsletter à UNE fiche.
 * Version simplifiée de <SendMailModal> — pas de scénarios (panier/inactif/restock)
 * car les fiches n'ont ni compte, ni panier, ni favoris.
 */

import { useEffect, useMemo, useRef, useState, useTransition, type MouseEvent as ReactMouseEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { useRouter } from "next/navigation";
import {
  listNewsletterTemplates,
  type NewsletterTemplateSummary,
} from "@/app/actions/admin/newsletter-templates";
import { getNewsletterPreviewHtml } from "@/app/actions/admin/send-newsletter";
import { sendNewsletterToFiches } from "@/app/actions/admin/send-newsletter-fiches";
import { useRightRail } from "@/components/admin/widgets-rail";

interface Props {
  ficheId: string;
  ficheLabel: string;
  ficheEmail: string;
  onClose: () => void;
}

export default function FicheSendMailModal({ ficheId, ficheLabel, ficheEmail, onClose }: Props) {
  const toast = useToast();
  const router = useRouter();
  const { open: openWidget } = useRightRail();
  const [templates, setTemplates] = useState<NewsletterTemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateId, setTemplateId] = useState<string>("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, startSending] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listNewsletterTemplates();
      if (cancelled) return;
      setTemplates(list);
      setTemplatesLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!templateId) { setPreviewHtml(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    (async () => {
      const res = await getNewsletterPreviewHtml(templateId);
      if (cancelled) return;
      setPreviewLoading(false);
      if (res.success) setPreviewHtml(res.html);
      else { setPreviewHtml(null); toast.error("Aperçu impossible", res.error); }
    })();
    return () => { cancelled = true; };
  }, [templateId, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mouseDownOnBackdrop = useRef(false);
  const onBackdropDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    mouseDownOnBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdropUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (mouseDownOnBackdrop.current && e.target === e.currentTarget) onClose();
    mouseDownOnBackdrop.current = false;
  };

  const options: SelectOption[] = useMemo(
    () => templates.map((t) => ({
      value: t.id,
      label: `📢  ${t.name} — ${t.blocksCount} bloc${t.blocksCount > 1 ? "s" : ""}`,
      disabled: t.blocksCount === 0,
    })),
    [templates],
  );

  const selectedTpl = templates.find((t) => t.id === templateId);
  const canSend = !!templateId && !sending && !!selectedTpl && selectedTpl.blocksCount > 0;

  function onSend() {
    if (!templateId) return;
    startSending(async () => {
      const res = await sendNewsletterToFiches({ templateId, ficheIds: [ficheId] });
      if (!res.success) {
        toast.error("Envoi refusé", res.error);
        return;
      }
      toast.success("Envoi lancé", `Mail en file d'attente pour ${ficheLabel}.`);
      router.refresh();
      onClose();
      // Ouvre le widget pour voir la progression / le résultat.
      openWidget("bulk-mail");
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onMouseDown={onBackdropDown}
      onMouseUp={onBackdropUp}
    >
      <div className="w-full max-w-2xl rounded-2xl bg-bg-primary shadow-2xl border border-border overflow-hidden max-h-[92vh] flex flex-col">
        <div className="relative overflow-hidden shrink-0">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950" />
          <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full blur-3xl bg-violet-500/20 pointer-events-none" />
          <div className="relative p-6 text-white text-left">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/10 backdrop-blur text-[10px] font-body font-bold uppercase tracking-[0.18em]">
              <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
              Envoyer une newsletter
            </div>
            <h2 className="mt-3 font-heading font-bold text-2xl">Envoi d&apos;un mail à une fiche</h2>
            <div className="mt-2 text-sm text-white/70" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
              <span className="block">
                Destinataire : <span className="font-semibold text-white">{ficheLabel}</span>
              </span>
              <span className="block text-white/60 text-xs mt-0.5">{ficheEmail}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-4">
          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-5">
            <label className="block text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-3">
              Choisir un modèle
            </label>
            {templatesLoading ? (
              <div className="text-center py-6 text-[12px] text-text-muted">
                <div className="inline-block w-4 h-4 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin mr-2 align-middle" />
                Chargement des modèles…
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12.5px] text-amber-800">
                Aucun modèle de newsletter enregistré.{" "}
                <a href="/admin/marketing/mails" className="underline font-semibold" target="_blank" rel="noreferrer">
                  Créer un modèle →
                </a>
              </div>
            ) : (
              <>
                <CustomSelect
                  value={templateId}
                  onChange={setTemplateId}
                  options={options}
                  placeholder="Sélectionner un modèle…"
                  size="md"
                />
                {selectedTpl && (
                  <div className="text-[12px] text-text-secondary leading-relaxed mt-3">
                    <div><span className="font-semibold">Sujet du mail :</span> {selectedTpl.subject}</div>
                  </div>
                )}
              </>
            )}
          </div>

          {templateId && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
                Aperçu du mail
              </div>
              <div className="rounded-lg border border-border overflow-hidden bg-slate-100">
                <div className="px-3 py-2 bg-slate-50 border-b border-border text-[11px] text-text-muted">
                  Aperçu du modèle — exactement ce que recevra la fiche.
                </div>
                {previewLoading ? (
                  <div className="p-10 text-center text-[12px] text-text-muted">
                    <div className="inline-block w-5 h-5 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin mr-2 align-middle" />
                    Chargement de l&apos;aperçu…
                  </div>
                ) : previewHtml ? (
                  <iframe
                    title="Aperçu newsletter"
                    srcDoc={previewHtml}
                    className="w-full bg-white block"
                    style={{ height: 520, border: 0 }}
                    sandbox=""
                  />
                ) : (
                  <div className="p-10 text-center text-[12px] text-red-600">
                    Aperçu indisponible.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-bg-secondary border-t border-border flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 rounded-lg text-sm font-body font-medium text-text-secondary hover:bg-bg-primary border border-border transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="px-5 py-2.5 rounded-lg text-sm font-body font-bold bg-gradient-to-br from-slate-800 to-slate-900 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity inline-flex items-center gap-2"
          >
            {sending ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Envoi…
              </>
            ) : (
              <>
                Envoyer le mail
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
