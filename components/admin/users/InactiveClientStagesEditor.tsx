"use client";

/**
 * Éditeur de la config de relance inactivité. Miroir strict de
 * AbandonedCartStagesEditor — même UX, palette violette. Le compte à rebours
 * de chaque stade est calculé côté worker (pas de nextStageAt persisté), donc
 * les hints diffèrent légèrement :
 *   - « Envoi après X jours d'inactivité » (au lieu de « après dernière modif panier »)
 *   - Pas de reset du timer sur modif — le worker recalcule chaque tick.
 */

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";
import InactiveClientMailModal from "@/components/admin/users/InactiveClientMailModal";
import {
  addInactiveClientStage,
  deleteInactiveClientStage,
  setInactiveClientAutomationEnabled,
  updateInactiveClientStageDelay,
  type InactiveClientConfigDTO,
  type InactiveClientStageDTO,
} from "@/app/actions/admin/inactive-client";
import {
  formatDurationShort,
  fromSeconds,
  toSeconds,
  type DelayUnit,
} from "@/lib/inactive-client-config";

const UNIT_OPTIONS: { value: DelayUnit; label: string }[] = [
  { value: "seconds", label: "secondes" },
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "heures" },
  { value: "days", label: "jours" },
];

interface Props {
  initialConfig: InactiveClientConfigDTO;
}

export default function InactiveClientStagesEditor({ initialConfig }: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [config, setConfig] = useState(initialConfig);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);

  function toggleAutomation() {
    const next = !config.automationEnabled;
    startTransition(async () => {
      const res = await setInactiveClientAutomationEnabled(next);
      if (!res.success) {
        toast.error("Activation impossible", res.error);
        return;
      }
      setConfig(res.config);
      toast.success(
        next ? "Relances activées" : "Relances désactivées",
        next
          ? "Les clients inactifs recevront désormais les mails aux échéances configurées."
          : "Plus aucun mail de relance inactivité ne sera envoyé.",
      );
    });
  }

  function onAdd() {
    startTransition(async () => {
      const res = await addInactiveClientStage();
      if (!res.success) {
        toast.error("Ajout impossible", res.error);
        return;
      }
      setConfig(res.config);
      toast.success("Stade ajouté");
    });
  }

  async function onDelete(stage: InactiveClientStageDTO) {
    const ok = await confirm({
      title: `Supprimer le stade ${stage.stageIndex} ?`,
      message: `Le modèle de mail lié à ce stade (« ${stage.templateName} ») sera supprimé aussi. Les stades restants seront renumérotés. Cette action est irréversible.`,
      confirmLabel: "Supprimer",
      type: "danger",
    });
    if (ok !== true) return;
    startTransition(async () => {
      const res = await deleteInactiveClientStage(stage.id);
      if (!res.success) {
        toast.error("Suppression impossible", res.error);
        return;
      }
      setConfig(res.config);
      toast.success("Stade supprimé");
    });
  }

  function applyConfig(next: InactiveClientConfigDTO) {
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
              Quand c&apos;est activé, le site vérifie chaque minute quels
              clients n&apos;ont plus donné signe de vie depuis assez
              longtemps et envoie le mail du stade correspondant. Un client
              revenu sur le site met le timer en pause ; une commande passée
              après un mail réinitialise le cycle au Stade 1.
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
                : `${config.stages.length} stade${config.stages.length > 1 ? "s" : ""} · délai calculé depuis la dernière visite / commande / création du compte.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onAdd}
            disabled={pending}
            className="px-3 py-2 rounded-lg text-xs font-body font-bold bg-gradient-to-br from-violet-600 to-violet-700 text-white shadow-sm hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
          >
            + Ajouter un stade
          </button>
        </div>

        {config.stages.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <p className="text-sm font-body text-text-muted">
              Commencez en ajoutant votre premier stade — par exemple 30 jours
              après la dernière visite.
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
        <InactiveClientMailModal
          stages={config.stages}
          initialStageId={editingStageId}
          onClose={() => {
            setEditingStageId(null);
            void (async () => {
              try {
                const { getInactiveClientConfig } = await import(
                  "@/app/actions/admin/inactive-client"
                );
                const fresh = await getInactiveClientConfig();
                setConfig(fresh);
              } catch {
                /* silent */
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
            <strong>Point de départ du timer</strong> : le plus récent des
            trois : dernière visite sur le site, dernière commande, ou date de
            création du compte (pour un client qui n&apos;a jamais navigué).
          </p>
          <p>
            <strong>Reset du timer</strong> : dès que le client revient sur le
            site ou passe commande, il n&apos;est plus « en retard ». Le
            cycle repart proprement au Stade 1 s&apos;il redevient inactif
            plus tard.
          </p>
          <p>
            <strong>Ne rejoue jamais</strong> : dans un même cycle
            d&apos;inactivité, chaque stade n&apos;est envoyé qu&apos;une
            fois. Une fois le dernier stade envoyé, silence total jusqu&apos;à
            ce que le client redevienne actif.
          </p>
          <p>
            <strong>Désinscription</strong> : chaque mail contient un lien de
            désinscription (variable <code className="bg-white px-1 rounded">{`{unsubscribeLink}`}</code>{" "}
            obligatoire dans le pied de page). 1 clic désinscrit le client de
            toutes les relances marketing.
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
  stage: InactiveClientStageDTO;
  pending: boolean;
  onDelete: () => void;
  onConfigUpdated: (config: InactiveClientConfigDTO) => void;
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
    const res = await updateInactiveClientStageDelay(stage.id, seconds);
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
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-violet-200 flex items-center justify-center font-heading font-bold text-violet-800 text-sm">
          {stage.stageIndex}
        </div>
        <div>
          <p className="text-[11px] font-body font-bold uppercase tracking-[0.14em] text-text-muted">
            Stade {stage.stageIndex}
          </p>
          <p className="text-xs font-body text-text-secondary">
            {formatDurationShort(stage.delaySeconds)} d&apos;inactivité.
          </p>
        </div>
      </div>

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
          className="w-24 px-3 py-2 rounded-lg border border-border bg-bg-primary text-sm text-text-primary tabular-nums focus:outline-none focus:border-violet-500"
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
          // bg-bg-dark reste noir dans les 2 modes (clair/sombre) — évite le
          // bug bg-text-primary qui devient gris clair en dark mode et rend
          // le bouton illisible sur texte blanc.
          className="px-3 py-2 rounded-lg text-[11px] font-body font-bold bg-bg-dark text-text-inverse hover:opacity-90 disabled:opacity-30"
        >
          {saving ? "…" : dirty ? "Enregistrer" : savedFlash ? "✓ Enregistré" : "À jour"}
        </button>
      </div>

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
