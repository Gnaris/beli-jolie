"use client";

/**
 * Liste des modèles de newsletter enregistrés + actions.
 *
 * 2 sections :
 * - « Mails automatiques » (haut) : les 3 modèles liés aux scénarios
 *   transactionnels (panier abandonné, inactivité, retour en stock). Non
 *   supprimables. Bouton « Remettre le design par défaut ».
 * - « Mes modèles » (bas) : modèles libres, supprimables. Bouton
 *   « Utiliser comme… » pour prendre la place d'un modèle scénario.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";
import {
  assignTemplateToScenario,
  createNewsletterTemplate,
  deleteNewsletterTemplate,
  duplicateNewsletterTemplate,
  resetScenarioTemplateToDefault,
  type NewsletterTemplateSummary,
} from "@/app/actions/admin/newsletter-templates";
import {
  SCENARIO_KEYS,
  SCENARIO_LABELS,
  type ScenarioKey,
} from "@/lib/mail-scenario-defaults";

interface Props {
  templates: NewsletterTemplateSummary[];
}

const SCENARIO_STYLES: Record<
  ScenarioKey,
  { chipBg: string; chipText: string; icon: string; gradientFrom: string; gradientTo: string }
> = {
  ABANDONED_CART: {
    chipBg: "bg-amber-100",
    chipText: "text-amber-800",
    icon: "🛒",
    gradientFrom: "from-amber-100",
    gradientTo: "to-amber-200",
  },
  INACTIVE_CLIENT: {
    chipBg: "bg-sky-100",
    chipText: "text-sky-800",
    icon: "😴",
    gradientFrom: "from-sky-100",
    gradientTo: "to-sky-200",
  },
  RESTOCK: {
    chipBg: "bg-emerald-100",
    chipText: "text-emerald-800",
    icon: "🔔",
    gradientFrom: "from-emerald-100",
    gradientTo: "to-emerald-200",
  },
};

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export default function NewslettersListClient({ templates }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  const { scenarioTemplates, freeTemplates } = useMemo(() => {
    const scenarioMap = new Map<ScenarioKey, NewsletterTemplateSummary>();
    const free: NewsletterTemplateSummary[] = [];
    for (const t of templates) {
      if (t.scenarioKey && SCENARIO_KEYS.includes(t.scenarioKey)) {
        scenarioMap.set(t.scenarioKey, t);
      } else {
        free.push(t);
      }
    }
    return { scenarioTemplates: scenarioMap, freeTemplates: free };
  }, [templates]);

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
      router.push(`/admin/marketing/mails/newsletter/${res.id}`);
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

  async function onAssign(id: string, name: string, scenario: ScenarioKey) {
    const currentHolder = scenarioTemplates.get(scenario);
    const ok = await confirm({
      title: `Utiliser « ${name} » pour ${SCENARIO_LABELS[scenario]} ?`,
      message: currentHolder
        ? `Le modèle actuel (« ${currentHolder.name} ») redeviendra un modèle libre, supprimable si vous le souhaitez.`
        : `Ce modèle sera utilisé automatiquement pour tous les envois « ${SCENARIO_LABELS[scenario]} ».`,
      confirmLabel: "Utiliser ce modèle",
      type: "info",
    });
    if (ok !== true) return;
    startTransition(async () => {
      const res = await assignTemplateToScenario(id, scenario);
      if (!res.success) {
        toast.error("Assignation impossible", res.error);
        return;
      }
      toast.success(`« ${name} » utilisé pour ${SCENARIO_LABELS[scenario]}`);
      router.refresh();
    });
  }

  async function onResetToDefault(scenario: ScenarioKey, currentName: string) {
    const ok = await confirm({
      title: `Remettre le design par défaut ?`,
      message: `Le contenu du modèle « ${currentName} » sera remplacé par le design d'origine (${SCENARIO_LABELS[scenario]}). Cette action est irréversible.`,
      confirmLabel: "Remettre par défaut",
      type: "warning",
    });
    if (ok !== true) return;
    startTransition(async () => {
      const res = await resetScenarioTemplateToDefault(scenario);
      if (!res.success) {
        toast.error("Réinitialisation impossible", res.error);
        return;
      }
      toast.success("Design par défaut restauré");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* ─── Section 1 : Mails automatiques ─── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1 h-6 rounded-full bg-gradient-to-b from-violet-500 to-violet-700" />
          <h2 className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-secondary">
            Mails automatiques
          </h2>
        </div>
        <p className="text-xs text-text-muted mb-4 max-w-2xl">
          Ces 3 mails partent automatiquement quand vous les envoyez à un client. Vous pouvez les modifier ou les remplacer par un autre modèle — mais ils ne peuvent pas être supprimés.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SCENARIO_KEYS.map((scenario) => {
            const t = scenarioTemplates.get(scenario);
            const style = SCENARIO_STYLES[scenario];
            if (!t) {
              return (
                <div
                  key={scenario}
                  className="bg-bg-primary rounded-2xl border border-dashed border-border shadow-sm p-5 text-center text-text-muted text-sm"
                >
                  Modèle en cours de création…
                </div>
              );
            }
            // Panier abandonné + Relance inactivité : routes dédiées qui
            // gèrent les N stades + config d'automation. Les autres scénarios
            // pointent vers l'éditeur newsletter classique.
            const cardHref =
              scenario === "ABANDONED_CART"
                ? "/admin/marketing/mails/panier-abandonne"
                : scenario === "INACTIVE_CLIENT"
                  ? "/admin/marketing/mails/inactivite"
                  : `/admin/marketing/mails/newsletter/${t.id}`;
            return (
              <div
                key={t.id}
                className="bg-bg-primary rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col"
              >
                <Link
                  href={cardHref}
                  className="p-5 flex-1 hover:bg-bg-secondary/40 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-11 h-11 rounded-xl bg-gradient-to-br ${style.gradientFrom} ${style.gradientTo} flex items-center justify-center text-xl shrink-0`}
                    >
                      {style.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-body font-bold uppercase tracking-wider ${style.chipBg} ${style.chipText}`}
                        >
                          {SCENARIO_LABELS[scenario]}
                        </span>
                        {scenario === "ABANDONED_CART" && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-body font-bold uppercase tracking-wider bg-amber-100 text-amber-800">
                            Auto
                          </span>
                        )}
                      </div>
                      <div className="font-heading font-bold text-[15px] text-text-primary truncate">{t.name}</div>
                      <div className="text-[12px] text-text-muted mt-0.5 truncate">
                        {scenario === "ABANDONED_CART"
                          ? "Configurer les stades + délais"
                          : `Sujet : ${t.subject}`}
                      </div>
                      <div className="text-[11px] text-text-muted mt-2">
                        {t.blocksCount} bloc{t.blocksCount > 1 ? "s" : ""} · Modifié le {formatDate(t.updatedAt)}
                      </div>
                    </div>
                  </div>
                </Link>
                <div className="px-3 py-2 bg-bg-secondary border-t border-border flex justify-end gap-1">
                  {scenario === "ABANDONED_CART" || scenario === "INACTIVE_CLIENT" ? (
                    // Ces 2 scénarios ont une page dédiée qui pilote N stades
                    // + config d'automation. Le « remettre par défaut » se
                    // fait sur chaque stade depuis l'éditeur — ici on renvoie
                    // simplement vers la page dédiée.
                    <Link
                      href={
                        scenario === "ABANDONED_CART"
                          ? "/admin/marketing/mails/panier-abandonne"
                          : "/admin/marketing/mails/inactivite"
                      }
                      className="px-2.5 py-1.5 rounded-md text-[11px] font-body font-semibold text-text-secondary hover:bg-bg-primary"
                      title="Ouvrir la page dédiée qui gère les stades + l'automation"
                    >
                      → Voir la page dédiée
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onResetToDefault(scenario, t.name)}
                      disabled={pending}
                      className="px-2.5 py-1.5 rounded-md text-[11px] font-body font-semibold text-text-secondary hover:bg-bg-primary"
                      title="Remplace le contenu par le design d'origine"
                    >
                      ↺ Remettre par défaut
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Section 2 : Mes modèles ─── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1 h-6 rounded-full bg-gradient-to-b from-slate-400 to-slate-600" />
          <h2 className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-secondary">
            Mes modèles
          </h2>
        </div>

        {/* Création rapide */}
        <div className="bg-bg-primary rounded-2xl border border-border shadow-sm p-5 mb-4">
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

        {freeTemplates.length === 0 ? (
          <div className="bg-bg-primary rounded-2xl border border-border shadow-sm py-12 px-6 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4 bg-violet-100 text-violet-700 text-2xl">
              📢
            </div>
            <h3 className="font-heading text-xl font-bold text-text-primary mb-2">Aucun modèle libre pour l&apos;instant</h3>
            <p className="text-sm text-text-muted max-w-md mx-auto">
              Créez un modèle avec le champ ci-dessus. Vous pourrez ensuite l&apos;envoyer manuellement en newsletter, ou l&apos;utiliser à la place d&apos;un mail automatique.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {freeTemplates.map((t) => (
              <div
                key={t.id}
                className="bg-bg-primary rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col"
              >
                <Link
                  href={`/admin/marketing/mails/newsletter/${t.id}`}
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
                        {t.blocksCount} bloc{t.blocksCount > 1 ? "s" : ""} · Modifié le {formatDate(t.updatedAt)}
                      </div>
                      {t.lastSentAt && (
                        <div className="text-[11px] text-emerald-700 font-medium mt-1">
                          ✓ Dernier envoi : {new Date(t.lastSentAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
                <div className="px-3 py-2 bg-bg-secondary border-t border-border flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted font-body font-semibold shrink-0">Utiliser pour :</span>
                    <div className="flex-1 min-w-0">
                      <CustomSelect
                        value=""
                        onChange={(val) => {
                          if (val && SCENARIO_KEYS.includes(val as ScenarioKey)) {
                            onAssign(t.id, t.name, val as ScenarioKey);
                          }
                        }}
                        options={[
                          { value: "", label: "— choisir un mail automatique —" },
                          ...SCENARIO_KEYS.map((k) => ({ value: k, label: SCENARIO_LABELS[k] })),
                        ]}
                        size="sm"
                        disabled={pending}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-1">
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
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
