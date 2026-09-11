"use client";

/**
 * Éditeur de la config de relance panier abandonné.
 *
 * Section unique avec :
 *   - Toggle « Activer les relances » (grisé + explication si des templates
 *     ont perdu leur lien de désinscription).
 *   - Liste ordonnée des stades. Chaque stade = 1 ligne avec :
 *       n° de stade / champ délai (nombre + unité) / bouton « Modifier le
 *       mail » (ouvre l'éditeur newsletter du template lié) / badge d'alerte
 *       si le footer n'a plus {unsubscribeLink} / poubelle.
 *   - Bouton « + Ajouter un stade » (crée un nouveau template cloné du
 *     dernier stade + un délai par défaut = 2× le précédent).
 *
 * Chaque modification appelle une server action, la page revalide, et
 * l'éditeur ré-affiche l'état fraîchement chargé.
 */

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";
import AbandonedCartMailModal from "@/components/admin/users/AbandonedCartMailModal";
import {
  addAbandonedCartStage,
  deleteAbandonedCartStage,
  setAbandonedCartAutomationEnabled,
  updateAbandonedCartStageDelay,
  type AbandonedCartConfigDTO,
  type AbandonedCartStageDTO,
} from "@/app/actions/admin/abandoned-cart";
import {
  DELAY_UNIT_LABELS,
  formatDurationShort,
  fromSeconds,
  toSeconds,
  type DelayUnit,
} from "@/lib/abandoned-cart-config";

const UNIT_OPTIONS: { value: DelayUnit; label: string }[] = [
  { value: "seconds", label: "secondes" },
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "heures" },
  { value: "days", label: "jours" },
];

interface Props {
  initialConfig: AbandonedCartConfigDTO;
}

export default function AbandonedCartStagesEditor({ initialConfig }: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [config, setConfig] = useState(initialConfig);
  // ID du stade dont on édite le mail dans la modale. null = modale fermée.
  const [editingStageId, setEditingStageId] = useState<string | null>(null);

  function toggleAutomation() {
    const next = !config.automationEnabled;
    startTransition(async () => {
      const res = await setAbandonedCartAutomationEnabled(next);
      if (!res.success) {
        toast.error("Activation impossible", res.error);
        return;
      }
      setConfig(res.config);
      toast.success(
        next ? "Relances activées" : "Relances désactivées",
        next
          ? "Les clients recevront désormais les mails aux échéances configurées."
          : "Plus aucun mail de relance panier ne sera envoyé.",
      );
    });
  }

  function onAdd() {
    startTransition(async () => {
      const res = await addAbandonedCartStage();
      if (!res.success) {
        toast.error("Ajout impossible", res.error);
        return;
      }
      setConfig(res.config);
      toast.success("Stade ajouté");
    });
  }

  async function onDelete(stage: AbandonedCartStageDTO) {
    const ok = await confirm({
      title: `Supprimer le stade ${stage.stageIndex} ?`,
      message: `Le modèle de mail lié à ce stade (« ${stage.templateName} ») sera supprimé aussi. Les stades restants seront renumérotés. Cette action est irréversible.`,
      confirmLabel: "Supprimer",
      type: "danger",
    });
    if (ok !== true) return;
    startTransition(async () => {
      const res = await deleteAbandonedCartStage(stage.id);
      if (!res.success) {
        toast.error("Suppression impossible", res.error);
        return;
      }
      setConfig(res.config);
      toast.success("Stade supprimé");
    });
  }

  /** Appelé par les lignes de stade après une sauvegarde de délai réussie. */
  function applyConfig(next: AbandonedCartConfigDTO) {
    setConfig(next);
  }

  return (
    <div className="space-y-4">
      {/* ─── Toggle global d'activation ─── */}
      <div className="bg-bg-primary rounded-2xl border border-border shadow-sm p-5">
        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={toggleAutomation}
            disabled={pending || (!config.automationEnabled && (!config.allTemplatesLegal || config.stages.length === 0))}
            role="switch"
            aria-checked={config.automationEnabled}
            title={
              pending
                ? "Enregistrement en cours…"
                : !config.automationEnabled && config.stages.length === 0
                  ? "Ajoutez au moins un stade de relance ci-dessous avant d'activer."
                  : !config.automationEnabled && !config.allTemplatesLegal
                    ? "Un stade a perdu son lien de désinscription — ouvrez « Modifier le mail » et réinsérez la variable {unsubscribeLink} dans le pied de page."
                    : config.automationEnabled
                      ? "Cliquez pour désactiver les relances automatiques."
                      : "Cliquez pour activer les relances automatiques."
            }
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-text-primary disabled:opacity-40 disabled:cursor-not-allowed ${
              config.automationEnabled
                ? "bg-emerald-600"
                : "bg-bg-tertiary border border-border-strong"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                config.automationEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-body font-semibold text-text-primary">
              {config.automationEnabled
                ? "Relances automatiques activées"
                : "Relances automatiques désactivées"}
            </p>
            <p className="text-xs font-body text-text-muted mt-1 leading-relaxed">
              Quand c&apos;est activé, dès qu&apos;un client ajoute un article
              dans son panier, un timer démarre pour chaque stade ci-dessous.
              Toute modification du panier (ajout, retrait, quantité, couleur,
              taille) remet à zéro les stades non-encore envoyés. Les stades
              déjà envoyés ne se rejouent pas — un client ne recevra jamais 2
              fois le même mail.
            </p>
            {!config.allTemplatesLegal && config.stages.length > 0 && (
              <p className="text-xs font-body text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
                ⚠ Impossible d&apos;activer : au moins un stade a perdu son
                lien de désinscription <code className="bg-white px-1 rounded">{`{unsubscribeLink}`}</code>.
                Ouvrez le modèle concerné (bouton « Modifier le mail ») et
                remettez la variable dans le contenu du mail (généralement
                dans le pied de page).
              </p>
            )}
            {config.stages.length === 0 && (
              <p className="text-xs font-body text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                Ajoutez au moins un stade avant d&apos;activer les relances.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ─── Liste des stades ─── */}
      <div className="bg-bg-primary rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-heading text-sm font-bold text-text-primary">
              Stades de relance
            </h2>
            <p className="text-xs font-body text-text-muted mt-0.5">
              {config.stages.length === 0
                ? "Aucun stade configuré."
                : `${config.stages.length} stade${config.stages.length > 1 ? "s" : ""} · délai calculé depuis la dernière modification du panier.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onAdd}
            disabled={pending}
            className="px-3 py-2 rounded-lg text-xs font-body font-bold bg-gradient-to-br from-amber-600 to-amber-700 text-white shadow-sm hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
          >
            + Ajouter un stade
          </button>
        </div>

        {config.stages.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <p className="text-sm font-body text-text-muted">
              Commencez en ajoutant votre premier stade — par exemple 24 h
              après l&apos;abandon.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {config.stages.map((s) => (
              <StageRow
                key={s.id}
                stage={s}
                pending={pending}
                onDelete={() => onDelete(s)}
                onConfigUpdated={applyConfig}
                onEditMail={() => setEditingStageId(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ─── Modale d'édition du mail — switcher stades ─── */}
      {editingStageId && config.stages.some((s) => s.id === editingStageId) && (
        <AbandonedCartMailModal
          stages={config.stages}
          initialStageId={editingStageId}
          onClose={() => {
            setEditingStageId(null);
            // Après édition, on force un reload de la config : le lien de
            // désinscription peut avoir été ajouté/retiré, on veut le badge
            // à jour côté page.
            // On ne fait pas de router.refresh — on appelle plutôt la config
            // fraîche via l'action qui existe déjà côté toggle.
            void (async () => {
              try {
                const { getAbandonedCartConfig } = await import(
                  "@/app/actions/admin/abandoned-cart"
                );
                const fresh = await getAbandonedCartConfig();
                setConfig(fresh);
              } catch {
                /* silent : la modale s'est fermée, pas urgent */
              }
            })();
          }}
        />
      )}

      {/* ─── Aide contextuelle ─── */}
      <details className="bg-bg-secondary rounded-2xl border border-border p-4 text-xs font-body text-text-secondary">
        <summary className="cursor-pointer font-semibold text-text-primary">
          Comment ça marche ?
        </summary>
        <div className="mt-3 space-y-2 leading-relaxed">
          <p>
            <strong>Cible</strong> : uniquement les clients approuvés qui ont
            accepté la newsletter. Aucun mail n&apos;est envoyé à un visiteur
            non-connecté.
          </p>
          <p>
            <strong>Reset du timer</strong> : le compte à rebours du prochain
            stade non-envoyé repart de zéro à chaque modification du panier
            (ajout, retrait, quantité, couleur, taille).
          </p>
          <p>
            <strong>Ne rejoue jamais</strong> : si le client a reçu le Stade 1,
            il ne le recevra plus jamais — sauf s&apos;il passe commande (dans
            ce cas tout est réinitialisé pour le prochain cycle).
          </p>
          <p>
            <strong>Panier vide au moment de l&apos;envoi</strong> : le
            contenu du panier est vérifié en direct. Si tous les articles sont
            passés en rupture ou hors ligne entretemps, le mail n&apos;est pas
            envoyé.
          </p>
          <p>
            <strong>Désinscription</strong> : chaque mail contient un lien de
            désinscription (variable <code className="bg-white px-1 rounded">{`{unsubscribeLink}`}</code>{" "}
            obligatoire dans le pied de page). 1 clic désinscrit le client.
          </p>
        </div>
      </details>
    </div>
  );
}

function StageRow({
  stage,
  pending,
  onDelete,
  onConfigUpdated,
  onEditMail,
}: {
  stage: AbandonedCartStageDTO;
  pending: boolean;
  onDelete: () => void;
  onConfigUpdated: (config: AbandonedCartConfigDTO) => void;
  onEditMail: () => void;
}) {
  const initial = fromSeconds(stage.delaySeconds);
  const [value, setValue] = useState<number>(initial.value);
  const [unit, setUnit] = useState<DelayUnit>(initial.unit);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const toast = useToast();

  const dirty = toSeconds(value, unit) !== stage.delaySeconds;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    const seconds = toSeconds(value, unit);
    const res = await updateAbandonedCartStageDelay(stage.id, seconds);
    setSaving(false);
    if (!res.success) {
      toast.error("Délai refusé", res.error);
      return;
    }
    onConfigUpdated(res.config);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  return (
    <div className="p-5 flex flex-col lg:flex-row lg:items-center gap-4">
      {/* Numéro stade */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center font-heading font-bold text-amber-800 text-sm">
          {stage.stageIndex}
        </div>
        <div>
          <p className="text-[11px] font-body font-bold uppercase tracking-[0.14em] text-text-muted">
            Stade {stage.stageIndex}
          </p>
          <p className="text-xs font-body text-text-secondary">
            {formatDurationShort(stage.delaySeconds)} après la dernière modif.
          </p>
        </div>
      </div>

      {/* Délai éditable */}
      <div className="flex items-center gap-2 flex-1">
        <span className="text-xs font-body text-text-muted whitespace-nowrap">
          Envoyer après
        </span>
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => setValue(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          disabled={pending || saving}
          className="w-24 px-3 py-2 rounded-lg border border-border bg-bg-primary text-sm text-text-primary tabular-nums focus:outline-none focus:border-amber-500"
        />
        <div className="min-w-[130px]">
          <CustomSelect
            value={unit}
            onChange={(v) => setUnit(v as DelayUnit)}
            options={UNIT_OPTIONS}
            size="sm"
            disabled={pending || saving}
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving || pending}
          className="px-3 py-2 rounded-lg text-[11px] font-body font-bold bg-text-primary text-text-inverse hover:opacity-90 disabled:opacity-30"
        >
          {saving ? "…" : dirty ? "Enregistrer" : savedFlash ? "✓ Enregistré" : "À jour"}
        </button>
      </div>

      {/* Statut désinscription + actions */}
      <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
        {!stage.templateHasUnsubscribeLink && (
          <button
            type="button"
            onClick={onEditMail}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-[10.5px] font-body font-semibold text-red-700 hover:bg-red-100"
            title="Ouvrir le mail pour insérer {unsubscribeLink} dans le pied de page"
          >
            ⚠ Lien désinscription manquant — corriger
          </button>
        )}
        <button
          type="button"
          onClick={onEditMail}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-body font-semibold bg-bg-secondary border border-border text-text-primary hover:bg-bg-primary"
          title={stage.templateName}
        >
          ✏ Modifier le mail
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-body font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
          title="Supprimer ce stade (et son modèle de mail)"
        >
          🗑
        </button>
      </div>

      {/* Cache utile : nom du modèle & date maj */}
      <div className="lg:hidden text-[10.5px] font-body text-text-muted mt-1">
        Modèle « {stage.templateName} » — modifié le{" "}
        {new Date(stage.templateUpdatedAt).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "short",
        })}
        .
      </div>
    </div>
  );
}

/** Voir DELAY_UNIT_LABELS dans lib/abandoned-cart-config si tu ajoutes des unités. */
export { DELAY_UNIT_LABELS };
