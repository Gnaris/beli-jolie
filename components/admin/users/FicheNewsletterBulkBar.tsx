"use client";

/**
 * Barre flottante d'envoi groupé de newsletter aux fiches sélectionnées.
 * Apparaît quand ≥ 1 fiche (avec email) est cochée.
 *
 * Depuis 2026-09-11 : au clic « Envoyer », on ENQUEUE un `BulkMailJob` puis
 * on ouvre automatiquement le widget « Envoi de mails » du rail droit — la
 * cliente voit la progression ligne par ligne (En attente / En cours / Envoyé
 * / Échoué + message d'erreur). Plus d'attente bloquante dans la modale.
 */

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { sendNewsletterToFiches } from "@/app/actions/admin/send-newsletter-fiches";
import { useMailSelection } from "./MailSelectionContext";
import { useRightRail } from "@/components/admin/widgets-rail";

interface Props {
  templates: Array<{ id: string; name: string; subject: string; blocksCount: number }>;
}

export default function FicheNewsletterBulkBar({ templates }: Props) {
  const { selectedIds, clear } = useMailSelection();
  const { open: openWidget } = useRightRail();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const [enqueuing, setEnqueuing] = useState(false);
  const toast = useToast();

  if (selectedIds.length === 0) return null;

  const options: SelectOption[] = templates.map((t) => ({
    value: t.id,
    label: `📢  ${t.name} — ${t.blocksCount} bloc${t.blocksCount > 1 ? "s" : ""}`,
    disabled: t.blocksCount === 0,
  }));

  const selectedTemplate = templates.find((t) => t.id === templateId);

  async function onSend() {
    if (!templateId) return;
    setEnqueuing(true);
    const res = await sendNewsletterToFiches({ templateId, ficheIds: selectedIds });
    setEnqueuing(false);
    if (!res.success) {
      toast.error("Envoi refusé", res.error);
      return;
    }
    const msg = [
      `${res.queued} mail${res.queued > 1 ? "s" : ""} en file d'attente`,
      res.excluded > 0 ? `${res.excluded} sans email exclu${res.excluded > 1 ? "s" : ""}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    toast.success("Envoi lancé", msg);
    clear();
    setOpen(false);
    // Ouvre automatiquement le widget « Envoi de mails » pour montrer la
    // progression ligne par ligne — cœur de la nouvelle expérience.
    openWidget("bulk-mail");
  }

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 min-w-[320px]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-fuchsia-500 flex items-center justify-center font-heading font-bold text-sm">
            {selectedIds.length}
          </div>
          <div className="text-[13px] font-body">
            fiche{selectedIds.length > 1 ? "s" : ""} sélectionnée{selectedIds.length > 1 ? "s" : ""}
          </div>
        </div>
        <div className="w-px h-6 bg-white/20" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-lg text-xs font-body font-bold bg-gradient-to-br from-fuchsia-500 to-pink-600 hover:opacity-90 inline-flex items-center gap-2"
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

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => !enqueuing && setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-bg-primary shadow-2xl border border-border overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative overflow-hidden shrink-0">
              <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-600 via-pink-600 to-rose-700" />
              <div className="relative p-5 text-white">
                <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold opacity-80">Envoi newsletter</div>
                <h2 className="mt-2 font-heading font-bold text-xl">
                  Envoyer à {selectedIds.length} fiche{selectedIds.length > 1 ? "s" : ""}
                </h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
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
                      className="mt-2 inline-block text-[11px] text-fuchsia-700 font-semibold hover:underline"
                    >
                      + Gérer mes modèles
                    </Link>
                  </>
                )}
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[12px] text-text-secondary leading-relaxed">
                Le même mail sera envoyé à <strong>{selectedIds.length} fiche{selectedIds.length > 1 ? "s" : ""}</strong>. Les fiches sans email sont exclues.
                Suivi live dans le widget « Envoi de mails » (icône enveloppe fuchsia en bas à droite).
              </div>
            </div>

            <div className="px-5 py-4 bg-bg-secondary border-t border-border flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={enqueuing}
                className="px-4 py-2 rounded-lg text-sm font-body font-medium text-text-secondary hover:bg-bg-primary border border-border"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={!templateId || enqueuing}
                className="px-5 py-2.5 rounded-lg text-sm font-body font-bold bg-gradient-to-br from-fuchsia-600 to-pink-600 text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2"
              >
                {enqueuing
                  ? "Mise en file…"
                  : `Lancer l'envoi à ${selectedIds.length} fiche${selectedIds.length > 1 ? "s" : ""} →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
