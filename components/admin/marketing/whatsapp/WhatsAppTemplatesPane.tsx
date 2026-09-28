"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { deleteWhatsAppTemplate, type WhatsAppTemplateDTO } from "@/app/actions/admin/whatsapp-templates";
import WhatsAppTemplateDrawer from "./WhatsAppTemplateDrawer";

export interface WhatsAppPreviewClient {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
}

interface Props {
  templates: WhatsAppTemplateDTO[];
  previewOverrides: Record<string, string>;
  clients: WhatsAppPreviewClient[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export default function WhatsAppTemplatesPane({ templates, previewOverrides, clients }: Props) {
  const [editing, setEditing] = useState<WhatsAppTemplateDTO | "new" | null>(null);
  const [, startTransition] = useTransition();
  const confirm = useConfirm();
  const toast = useToast();

  async function handleDelete(t: WhatsAppTemplateDTO) {
    const ok = await confirm.confirm({
      type: "danger",
      title: "Supprimer ce modèle ?",
      message: `« ${t.title} » sera supprimé définitivement. L'historique des envois passés reste consultable.`,
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;

    startTransition(async () => {
      const r = await deleteWhatsAppTemplate(t.id);
      if (r.success) {
        toast.success("Modèle supprimé");
      } else {
        toast.error("Échec", r.error);
      }
    });
  }

  if (templates.length === 0) {
    return (
      <>
        <div className="bg-bg-primary rounded-2xl border border-border shadow-sm py-16 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-5 bg-emerald-100 border border-emerald-200">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-emerald-600">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12 2.05C6.507 2.05 2.05 6.508 2.05 12c0 1.968.568 3.802 1.548 5.36L2 22l4.75-1.575A9.94 9.94 0 0 0 12 21.95c5.492 0 9.95-4.458 9.95-9.95S17.492 2.05 12 2.05" />
            </svg>
          </div>
          <h3 className="font-heading text-xl font-bold text-text-primary mb-2">Aucun modèle pour l&apos;instant</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto mb-6">
            Créez votre premier modèle pour gagner du temps quand vous discutez avec vos clients sur WhatsApp.
          </p>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 text-white text-[13px] font-semibold shadow-sm hover:opacity-90"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Créer un modèle
          </button>
        </div>

        {editing !== null && (
          <WhatsAppTemplateDrawer
            template={editing === "new" ? null : editing}
            previewOverrides={previewOverrides}
            clients={clients}
            onClose={() => setEditing(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 text-white text-[13px] font-semibold shadow-sm hover:opacity-90"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nouveau modèle
        </button>
      </div>

      {/* Desktop */}
      <div className="hidden lg:block bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-secondary">
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Titre</th>
                <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Extrait</th>
                <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Envois</th>
                <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Mis à jour</th>
                <th className="px-5 py-3 text-right text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setEditing(t)}
                  className="border-b border-border last:border-0 hover:bg-bg-secondary/60 cursor-pointer transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-body font-semibold text-text-primary truncate max-w-xs">
                      {t.title}
                    </p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-[12px] font-body text-text-muted truncate max-w-md">
                      {truncate(t.body, 80)}
                    </p>
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    {t.sendCount === 0 ? (
                      <p className="text-[13px] font-body text-text-muted/50">—</p>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[11.5px] font-semibold">
                        {t.sendCount} envoi{t.sendCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <span className="text-[13px] font-body text-text-secondary">{formatDate(t.updatedAt)}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditing(t); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-body font-medium text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
                      >
                        Éditer
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDelete(t); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-body font-medium text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile */}
      <div className="lg:hidden space-y-2.5">
        {templates.map((t) => (
          <div
            key={t.id}
            className="rounded-2xl border border-border bg-bg-primary p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-body font-semibold text-text-primary truncate">{t.title}</p>
                <p className="text-[12px] font-body text-text-muted mt-1 line-clamp-2">
                  {truncate(t.body, 120)}
                </p>
                <p className="text-[11px] font-body text-text-muted mt-2">
                  Mis à jour {formatDate(t.updatedAt)}
                  {t.sendCount > 0 && <> · {t.sendCount} envoi{t.sendCount > 1 ? "s" : ""}</>}
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(t)}
                className="flex-1 inline-flex items-center justify-center gap-1 px-3 h-9 rounded-lg border border-border bg-bg-primary text-text-secondary text-[12px] font-body font-semibold"
              >
                Éditer
              </button>
              <button
                type="button"
                onClick={() => handleDelete(t)}
                className="inline-flex items-center justify-center gap-1 px-3 h-9 rounded-lg border border-red-200 bg-red-50 text-red-700 text-[12px] font-body font-semibold"
              >
                Supprimer
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing !== null && (
        <WhatsAppTemplateDrawer
          template={editing === "new" ? null : editing}
          previewOverrides={previewOverrides}
          clients={clients}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
