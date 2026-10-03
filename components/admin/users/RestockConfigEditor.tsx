"use client";

/**
 * Éditeur de la config de notification « retour en stock ».
 *
 * Contrairement aux relances panier/inactivité (stades multiples), le retour
 * en stock n'a qu'UN envoi par cycle. L'UI est donc simplifiée :
 *   - un toggle d'activation globale,
 *   - un champ unique « compteur avant envoi » (minutes/heures/jours),
 *   - une carte du modèle de mail avec lien d'édition.
 *
 * La règle anti-spam vit côté `restock-trigger` : plusieurs produits qui
 * reviennent en stock dans la fenêtre du compteur partent dans le même mail.
 */

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";
import RestockMailModal from "@/components/admin/users/RestockMailModal";
import {
  setRestockAutomationEnabled,
  setRestockDelaySeconds,
  type RestockConfigDTO,
} from "@/app/actions/admin/restock";
import {
  RESTOCK_MIN_DELAY_SECONDS,
  RESTOCK_MAX_DELAY_SECONDS,
} from "@/lib/restock-config";
import {
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
  initialConfig: RestockConfigDTO;
}

export default function RestockConfigEditor({ initialConfig }: Props) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialConfig.automationEnabled);
  const [delaySec, setDelaySec] = useState(initialConfig.delaySeconds);
  const [draftValue, setDraftValue] = useState(() => fromSeconds(initialConfig.delaySeconds).value);
  const [draftUnit, setDraftUnit] = useState<DelayUnit>(
    () => fromSeconds(initialConfig.delaySeconds).unit as DelayUnit,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const template = initialConfig.template;

  const templateReady = Boolean(template?.hasUnsubscribeLink);

  function onToggle() {
    const next = !enabled;
    startTransition(async () => {
      const res = await setRestockAutomationEnabled(next);
      if (!res.success) {
        toast.error("Activation impossible", res.error);
        return;
      }
      setEnabled(next);
      toast.success(
        next ? "Notifications activées" : "Notifications désactivées",
        next
          ? "Les clients concernés par un retour en stock recevront un mail récapitulatif."
          : "Plus aucun mail de retour en stock ne sera envoyé (les nouveaux retours n'alimentent plus la file).",
      );
    });
  }

  function onCommitDelay() {
    let seconds = toSeconds(draftValue, draftUnit);
    if (seconds < RESTOCK_MIN_DELAY_SECONDS) seconds = RESTOCK_MIN_DELAY_SECONDS;
    if (seconds > RESTOCK_MAX_DELAY_SECONDS) seconds = RESTOCK_MAX_DELAY_SECONDS;
    if (seconds === delaySec) return;
    startTransition(async () => {
      const res = await setRestockDelaySeconds(seconds);
      if (!res.success) {
        toast.error("Enregistrement impossible", res.error);
        return;
      }
      setDelaySec(seconds);
      const refreshed = fromSeconds(seconds);
      setDraftValue(refreshed.value);
      setDraftUnit(refreshed.unit as DelayUnit);
      const rescheduled = res.rescheduledCount;
      const extra =
        rescheduled > 0
          ? ` ${rescheduled} compteur${rescheduled > 1 ? "s" : ""} déjà en cours reprogrammé${rescheduled > 1 ? "s" : ""} sur le nouveau délai.`
          : "";
      toast.success(
        "Compteur mis à jour",
        `Envoi ${formatDurationShort(seconds)} après le 1ᵉʳ retour en stock.${extra}`,
      );
    });
  }

  return (
    <div className="space-y-6">
      {/* Toggle activation */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-heading font-bold text-text-primary">
              Automatisation
            </h2>
            <p className="text-sm font-body text-text-secondary mt-1 max-w-xl">
              Dès qu'un produit repasse en stock, un compteur se lance pour chaque client qui l'avait en favoris ou qui l'avait déjà commandé. Si d'autres produits reviennent avant la fin du compteur, ils s'ajoutent au mail en préparation — un seul mail récap est envoyé par client et par cycle.
            </p>
            {!templateReady && (
              <p className="text-xs font-body text-amber-700 mt-3">
                ⚠ Le modèle de mail n'est pas prêt (lien de désinscription manquant). Vous ne pourrez pas activer tant qu'il n'est pas corrigé.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onToggle}
            disabled={pending || (!enabled && !templateReady)}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
              enabled ? "bg-emerald-500" : "bg-zinc-300"
            } ${pending ? "opacity-50 cursor-wait" : ""} disabled:opacity-50 disabled:cursor-not-allowed`}
            aria-label={enabled ? "Désactiver l'automatisation" : "Activer l'automatisation"}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Compteur délai */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm">
        <h2 className="text-base font-heading font-bold text-text-primary">
          Combien de temps attendre avant d'envoyer le mail ?
        </h2>
        <p className="text-sm font-body text-text-secondary mt-1 max-w-xl">
          À partir du 1ᵉʳ produit qui revient en stock pour un client, on attend ce délai avant de lui envoyer le mail. Pendant ce temps, tous les autres produits qui reviennent sont ajoutés à la liste. Valeur recommandée : <strong>24 heures</strong>.
        </p>
        <div className="flex items-end gap-3 mt-4">
          <div>
            <label className="block text-xs font-body text-text-muted uppercase tracking-wider mb-1">
              Valeur
            </label>
            <input
              type="number"
              min={1}
              value={draftValue}
              onChange={(e) => setDraftValue(Math.max(1, Number(e.target.value) || 1))}
              className="w-24 h-10 px-3 rounded-lg border border-border bg-bg-primary text-sm font-body text-text-primary"
              disabled={pending}
            />
          </div>
          <div className="flex-1 max-w-[160px]">
            <label className="block text-xs font-body text-text-muted uppercase tracking-wider mb-1">
              Unité
            </label>
            <CustomSelect
              value={draftUnit}
              onChange={(v) => setDraftUnit(v as DelayUnit)}
              options={UNIT_OPTIONS}
              disabled={pending}
            />
          </div>
          <button
            type="button"
            onClick={onCommitDelay}
            disabled={pending || toSeconds(draftValue, draftUnit) === delaySec}
            className="h-10 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Enregistrer
          </button>
        </div>
        <p className="text-xs font-body text-text-muted mt-3">
          Compteur actuel : <strong className="text-text-primary">{formatDurationShort(delaySec)}</strong>.
          Aucune limite imposée (vous pouvez descendre à 1 seconde pour tester,
          mais à ce rythme-là les clients recevront un mail par retour en stock —
          à vos risques).
        </p>
      </div>

      {/* Carte du template */}
      {template && (
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-base font-heading font-bold text-text-primary">
            Modèle de mail
          </h2>
          <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-body font-semibold text-text-primary truncate">
                {template.name}
              </p>
              <p className="text-xs font-body text-text-muted mt-1 truncate">
                Sujet : {template.subject}
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-body font-semibold ${
                  template.hasUnsubscribeLink
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    template.hasUnsubscribeLink ? "bg-emerald-500" : "bg-amber-500"
                  }`} />
                  {template.hasUnsubscribeLink
                    ? "Lien de désinscription OK"
                    : "Lien de désinscription manquant"}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-body font-semibold ${
                  template.hasAnyLoop
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    template.hasAnyLoop ? "bg-emerald-500" : "bg-amber-500"
                  }`} />
                  {template.hasAnyLoop
                    ? "Au moins une section (favoris / commandés)"
                    : "Aucune section — le mail arriverait vide"}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="shrink-0 h-10 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-semibold hover:opacity-90 inline-flex items-center"
            >
              Modifier le mail
            </button>
          </div>
          <p className="text-xs font-body text-text-muted mt-3">
            Le mail propose deux sections distinctes (favoris et déjà commandés). Les deux sont facultatives mais recommandées — vous décidez laquelle afficher en éditant le modèle.
          </p>
        </div>
      )}

      {modalOpen && template && (
        <RestockMailModal
          templateId={template.id}
          templateName={template.name}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
