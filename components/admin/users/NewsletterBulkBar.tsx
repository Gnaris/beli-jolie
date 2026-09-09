"use client";

/**
 * Barre flottante en bas de la Vue Mails qui apparaît quand au moins un client
 * est coché. Permet d'ouvrir la modale d'envoi de newsletter groupé.
 *
 * La sélection est gérée dans un contexte partagé (SelectionProvider) qui
 * enveloppe le contenu de la Vue Mails.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { sendNewsletterToUsers } from "@/app/actions/admin/send-newsletter";
import { useMailSelection } from "./MailSelectionContext";

interface Props {
  templates: Array<{ id: string; name: string; subject: string; blocksCount: number }>;
}

export default function NewsletterBulkBar({ templates }: Props) {
  const { selectedIds, clear } = useMailSelection();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const toast = useToast();
  const router = useRouter();

  if (selectedIds.length === 0) return null;

  const options: SelectOption[] = templates.map((t) => ({
    value: t.id,
    label: `📢  ${t.name} — ${t.blocksCount} bloc${t.blocksCount > 1 ? "s" : ""}`,
    disabled: t.blocksCount === 0,
  }));

  const selectedTemplate = templates.find((t) => t.id === templateId);

  async function onSend() {
    if (!templateId) return;
    setSending(true);
    setResult(null);
    const res = await sendNewsletterToUsers({ templateId, userIds: selectedIds });
    setSending(false);
    if (!res.success) {
      toast.error("Envoi refusé", res.error);
      return;
    }
    setResult({ sent: res.sent, failed: res.failed });
    toast.success(
      "Newsletter envoyée",
      `${res.sent} mail${res.sent > 1 ? "s" : ""} envoyé${res.sent > 1 ? "s" : ""} · ${res.failed} échec${res.failed > 1 ? "s" : ""}`,
    );
    clear();
    router.refresh();
    setTimeout(() => {
      setOpen(false);
      setResult(null);
    }, 2000);
  }

  return (
    <>
      {/* Barre flottante */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 min-w-[320px]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center font-heading font-bold text-sm">
            {selectedIds.length}
          </div>
          <div className="text-[13px] font-body">
            client{selectedIds.length > 1 ? "s" : ""} sélectionné{selectedIds.length > 1 ? "s" : ""}
          </div>
        </div>
        <div className="w-px h-6 bg-white/20" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-lg text-xs font-body font-bold bg-gradient-to-br from-violet-500 to-violet-600 hover:opacity-90 inline-flex items-center gap-2"
        >
          📢 Envoyer une newsletter
        </button>
        <button
          type="button"
          onClick={clear}
          className="px-3 py-2 rounded-lg text-xs font-body font-semibold text-white/70 hover:bg-white/10"
        >
          Tout désélectionner
        </button>
      </div>

      {/* Modale d'envoi */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => !sending && setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-bg-primary shadow-2xl border border-border overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative overflow-hidden shrink-0">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-700 via-violet-800 to-violet-900" />
              <div className="relative p-5 text-white">
                <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold opacity-80">Envoi newsletter</div>
                <h2 className="mt-2 font-heading font-bold text-xl">Envoyer à {selectedIds.length} client{selectedIds.length > 1 ? "s" : ""}</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {result ? (
                <div className="text-center py-6">
                  <div className="text-4xl mb-3">✅</div>
                  <div className="font-heading font-bold text-lg text-text-primary mb-1">Envoi terminé</div>
                  <div className="text-sm text-text-secondary">
                    {result.sent} mail{result.sent > 1 ? "s" : ""} envoyé{result.sent > 1 ? "s" : ""}
                    {result.failed > 0 && ` · ${result.failed} échec${result.failed > 1 ? "s" : ""}`}
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
                      Choisir un modèle
                    </label>
                    {templates.length === 0 ? (
                      <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 text-sm text-amber-800">
                        Aucun modèle enregistré.{" "}
                        <Link href="/admin/marketing/mails" className="underline font-semibold">
                          Créer un modèle →
                        </Link>
                      </div>
                    ) : (
                      <>
                        <CustomSelect
                          value={templateId}
                          onChange={setTemplateId}
                          options={options}
                          placeholder="Sélectionner un modèle…"
                        />
                        {selectedTemplate && (
                          <div className="mt-2 text-[12px] text-text-muted leading-relaxed">
                            <div><span className="font-semibold text-text-secondary">Sujet :</span> {selectedTemplate.subject}</div>
                          </div>
                        )}
                        <Link
                          href="/admin/marketing/mails"
                          className="mt-2 inline-block text-[11px] text-violet-700 font-semibold hover:underline"
                        >
                          + Gérer mes modèles
                        </Link>
                      </>
                    )}
                  </div>

                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[12px] text-text-secondary leading-relaxed">
                    Le même mail sera envoyé à <strong>{selectedIds.length} client{selectedIds.length > 1 ? "s" : ""}</strong>. Chaque envoi sera tracé et la date apparaîtra dans la colonne « Newsletter » de la Vue Mails.
                  </div>
                </>
              )}
            </div>

            {!result && (
              <div className="px-5 py-4 bg-bg-secondary border-t border-border flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={sending}
                  className="px-4 py-2 rounded-lg text-sm font-body font-medium text-text-secondary hover:bg-bg-primary border border-border"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!templateId || sending}
                  className="px-5 py-2.5 rounded-lg text-sm font-body font-bold bg-gradient-to-br from-violet-600 to-violet-700 text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2"
                >
                  {sending ? "Envoi en cours…" : `Envoyer à ${selectedIds.length} client${selectedIds.length > 1 ? "s" : ""} →`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
