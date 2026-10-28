"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useToast } from "@/components/ui/Toast";
import {
  updateInactiveRevokeSettings,
  type InactiveRevokeSettingsDTO,
} from "@/app/actions/admin/inactive-client-revoke";

interface Props {
  initial: InactiveRevokeSettingsDTO;
}

interface DraftState {
  enabled: boolean;
  warningDays: string; // input texte pour permettre champ vide
  graceDays: string;
  probationDays: string;
}

function toDraft(settings: InactiveRevokeSettingsDTO): DraftState {
  return {
    enabled: settings.enabled,
    warningDays: settings.warningDays === null ? "" : String(settings.warningDays),
    graceDays: settings.graceDays === null ? "" : String(settings.graceDays),
    probationDays:
      settings.probationDays === null ? "" : String(settings.probationDays),
  };
}

export default function InactiveRevokeConfig({ initial }: Props) {
  const [draft, setDraft] = useState<DraftState>(toDraft(initial));
  const [saved, setSaved] = useState<DraftState>(toDraft(initial));
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const toast = useToast();

  const dirty =
    draft.enabled !== saved.enabled ||
    draft.warningDays.trim() !== saved.warningDays.trim() ||
    draft.graceDays.trim() !== saved.graceDays.trim() ||
    draft.probationDays.trim() !== saved.probationDays.trim();

  function parseIntOrNull(raw: string): number | null {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    return n;
  }

  function handleSave() {
    showLoading();
    startTransition(async () => {
      try {
        const res = await updateInactiveRevokeSettings({
          enabled: draft.enabled,
          warningDays: parseIntOrNull(draft.warningDays),
          graceDays: parseIntOrNull(draft.graceDays),
          probationDays: parseIntOrNull(draft.probationDays),
        });
        if (res.success) {
          setSaved(toDraft(res.settings));
          setDraft(toDraft(res.settings));
          toast.success("Paramètres enregistrés");
        } else {
          toast.error("Erreur", res.error);
        }
      } finally {
        hideLoading();
      }
    });
  }

  const canEnable =
    parseIntOrNull(draft.warningDays) !== null &&
    parseIntOrNull(draft.graceDays) !== null;

  const warningN = parseIntOrNull(draft.warningDays);
  const graceN = parseIntOrNull(draft.graceDays);
  const probationN = parseIntOrNull(draft.probationDays);

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] text-amber-900 font-body leading-relaxed">
        <strong>En résumé</strong> — vous dormez tranquille, le site surveille
        à votre place les clients qui ne commandent plus. Il envoie d'abord
        un mail d'alerte pour les faire revenir, puis — s'ils restent
        silencieux — met leur compte en pause tout seul.
      </div>

      <div className="rounded-xl border border-border bg-bg-primary p-5 space-y-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 rounded border-border accent-slate-900"
            checked={draft.enabled}
            onChange={(e) =>
              setDraft((d) => ({ ...d, enabled: e.target.checked }))
            }
          />
          <div className="flex-1">
            <div className="font-medium text-text-primary">
              Activer la mise en pause automatique
            </div>
            <div className="text-[13px] text-text-muted">
              Une fois cochée, le site vérifie tout seul chaque heure si des
              clients doivent recevoir un rappel ou être mis en pause.
            </div>
            {draft.enabled && !canEnable ? (
              <div className="mt-2 text-[12px] text-amber-700">
                Renseignez d'abord les deux premiers délais ci-dessous.
              </div>
            ) : null}
          </div>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1">
              <span className="inline-block w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold text-center leading-5 mr-1.5">
                1
              </span>
              Après combien de jours sans commande envoyer un mail
              d'avertissement ?
            </label>
            <input
              type="number"
              min={1}
              max={36500}
              step={1}
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-slate-900"
              value={draft.warningDays}
              placeholder="ex. 365 (1 an)"
              onChange={(e) =>
                setDraft((d) => ({ ...d, warningDays: e.target.value }))
              }
            />
            <div className="mt-1 text-[12px] text-text-muted leading-relaxed">
              Un client qui n'a pas commandé pendant cette durée reçoit un
              email : « vous nous manquez, votre compte va être mis en pause
              bientôt ». La durée se compte depuis sa <strong>dernière
              commande</strong> (ou depuis son inscription s'il n'a jamais
              commandé).
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1">
              <span className="inline-block w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold text-center leading-5 mr-1.5">
                2
              </span>
              Combien de jours lui laisser <em>après l'envoi du mail
              d'avertissement</em> avant la mise en pause&nbsp;?
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              step={1}
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-slate-900"
              value={draft.graceDays}
              placeholder="ex. 15"
              onChange={(e) =>
                setDraft((d) => ({ ...d, graceDays: e.target.value }))
              }
            />
            <div className="mt-1 text-[12px] text-text-muted leading-relaxed">
              Ce compteur démarre <strong>le jour où le mail d'avertissement
              est envoyé</strong> (pas depuis sa dernière commande). Si le
              client ne commande toujours pas pendant ces jours-là, son
              compte est automatiquement mis en pause.
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1">
              <span className="inline-block w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold text-center leading-5 mr-1.5">
                3
              </span>
              Quand vous réactivez un client, combien de jours lui laisser
              pour commander ?
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              step={1}
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-slate-900"
              value={draft.probationDays}
              placeholder="ex. 30"
              onChange={(e) =>
                setDraft((d) => ({ ...d, probationDays: e.target.value }))
              }
            />
            <div className="mt-1 text-[12px] text-text-muted leading-relaxed">
              Quand vous cliquez sur <strong>« Réactiver »</strong> sur la
              fiche d'un client en pause, il récupère son accès aux tarifs
              mais a seulement cette durée pour passer une commande. S'il ne
              commande pas, son compte retombe en pause automatiquement.
            </div>
          </div>
        </div>

        {/* Scénario en direct : s'affiche quand les 3 champs sont remplis */}
        {warningN !== null && graceN !== null && probationN !== null ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-3">
              Exemple avec vos réglages
            </div>
            <ol className="space-y-2.5 text-[13px] text-slate-700 leading-relaxed">
              <li className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold text-center leading-5 mt-0.5">
                  1
                </span>
                <span>
                  Un client n'a pas commandé depuis{" "}
                  <strong>{warningN} jours</strong>. → Le site lui envoie un
                  mail d'avertissement.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold text-center leading-5 mt-0.5">
                  2
                </span>
                <span>
                  <strong>À partir de la réception de ce mail</strong>, il a{" "}
                  <strong>{graceN} jours</strong> pour revenir commander.
                  S'il ne commande pas → son compte est mis en pause (plus
                  de tarifs visibles).
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold text-center leading-5 mt-0.5">
                  3
                </span>
                <span>
                  Un jour, vous décidez de le réactiver manuellement depuis
                  sa fiche. Il a alors <strong>{probationN} jours</strong>{" "}
                  pour passer commande. Sinon il repart directement en pause.
                </span>
              </li>
            </ol>
          </div>
        ) : null}

        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-[12px] text-slate-700">
          <strong>Personnaliser les mails envoyés :</strong> rendez-vous dans{" "}
          <Link
            href="/admin/contact-client?onglet=systeme"
            className="underline underline-offset-2 hover:text-slate-900"
          >
            Modèles de mails système
          </Link>{" "}
          pour modifier les trois mails concernés : avertissement, mise en
          pause et réactivation.
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={!dirty || isPending}
            onClick={() => setDraft(saved)}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-text-muted hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!dirty || isPending}
            onClick={handleSave}
            className="px-5 py-2 rounded-lg bg-slate-900 text-white text-[13px] font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
