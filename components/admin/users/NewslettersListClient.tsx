"use client";

/**
 * Liste des modèles de newsletter enregistrés + actions (créer, dupliquer,
 * renommer, supprimer). Chaque ligne renvoie vers l'éditeur.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  createNewsletterTemplate,
  deleteNewsletterTemplate,
  duplicateNewsletterTemplate,
  type NewsletterTemplateSummary,
} from "@/app/actions/admin/newsletter-templates";

interface Props {
  templates: NewsletterTemplateSummary[];
}

export default function NewslettersListClient({ templates }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  function onCreate() {
    const name = newName.trim() || "Nouveau modèle";
    startTransition(async () => {
      const res = await createNewsletterTemplate(name);
      if (!res.success) {
        toast.error("Création impossible", res.error);
        return;
      }
      toast.success("Modèle créé", `« ${name} » a été créé.`);
      setNewName("");
      router.push(`/admin/utilisateurs/newsletters/${res.id}`);
    });
  }

  function onDuplicate(id: string, name: string) {
    startTransition(async () => {
      const res = await duplicateNewsletterTemplate(id);
      if (!res.success) {
        toast.error("Duplication impossible", res.error);
        return;
      }
      toast.success("Modèle dupliqué", `« ${name} » a été dupliqué.`);
      router.refresh();
    });
  }

  async function onDelete(id: string, name: string) {
    const ok = await confirm({
      title: "Supprimer ce modèle ?",
      message: `Le modèle « ${name} » sera supprimé définitivement. Cette action est irréversible.`,
      confirmLabel: "Supprimer",
      type: "danger",
    });
    if (ok !== true) return;
    startTransition(async () => {
      const res = await deleteNewsletterTemplate(id);
      if (!res.success) {
        toast.error("Suppression impossible", res.error);
        return;
      }
      toast.success("Modèle supprimé");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Création rapide */}
      <div className="bg-bg-primary rounded-2xl border border-border shadow-sm p-5">
        <div className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
          Créer un nouveau modèle
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ex: Nouveautés d'automne 2026"
            className="flex-1 px-3 py-2.5 rounded-lg border border-border bg-bg-primary text-sm text-text-primary focus:outline-none focus:border-slate-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreate();
            }}
          />
          <button
            type="button"
            onClick={onCreate}
            disabled={pending}
            className="px-4 py-2.5 rounded-lg text-sm font-body font-bold bg-gradient-to-br from-violet-600 to-violet-700 text-white shadow-sm hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
          >
            + Créer le modèle
          </button>
        </div>
      </div>

      {/* Liste */}
      {templates.length === 0 ? (
        <div className="bg-bg-primary rounded-2xl border border-border shadow-sm py-12 px-6 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4 bg-violet-100 text-violet-700 text-2xl">
            📢
          </div>
          <h3 className="font-heading text-xl font-bold text-text-primary mb-2">Aucun modèle pour l&apos;instant</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            Créez votre premier modèle avec le champ ci-dessus. Vous pourrez ensuite le composer bloc par bloc (bannière, produits, texte, bouton…).
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div
              key={t.id}
              className="bg-bg-primary rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col"
            >
              <Link
                href={`/admin/utilisateurs/newsletters/${t.id}`}
                className="p-5 flex-1 hover:bg-bg-secondary/40 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-100 to-violet-200 flex items-center justify-center text-xl shrink-0">
                    📢
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-heading font-bold text-[15px] text-text-primary truncate">{t.name}</div>
                    <div className="text-[12px] text-text-muted mt-0.5 truncate">Sujet : {t.subject}</div>
                    <div className="text-[11px] text-text-muted mt-2">
                      {t.blocksCount} bloc{t.blocksCount > 1 ? "s" : ""} · Modifié le{" "}
                      {new Date(t.updatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                    {t.lastSentAt && (
                      <div className="text-[11px] text-emerald-700 font-medium mt-1">
                        ✓ Dernier envoi : {new Date(t.lastSentAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
              <div className="px-3 py-2 bg-bg-secondary border-t border-border flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => onDuplicate(t.id, t.name)}
                  disabled={pending}
                  className="px-2.5 py-1.5 rounded-md text-[11px] font-body font-semibold text-text-secondary hover:bg-bg-primary"
                >
                  Dupliquer
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(t.id, t.name)}
                  disabled={pending}
                  className="px-2.5 py-1.5 rounded-md text-[11px] font-body font-semibold text-red-600 hover:bg-red-50"
                >
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
