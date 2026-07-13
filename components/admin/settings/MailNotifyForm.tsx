"use client";

import { useState, useTransition } from "react";
import { updateMailNotifySettings, sendMailNotifyTest } from "@/app/actions/admin/mail-notify";
import {
  MIN_INTERVAL_MINUTES,
  toMinutes as computeMinutes,
  type MailNotifyMode,
  type MailNotifySettings,
  type MailNotifyUnit,
} from "@/lib/mail-notify-constants";

interface Props {
  initialSettings: MailNotifySettings;
}

const UNIT_LABELS: Record<MailNotifyUnit, string> = {
  minute: "minute(s)",
  hour: "heure(s)",
  day: "jour(s)",
};

export default function MailNotifyForm({ initialSettings }: Props) {
  const [mode, setMode] = useState<MailNotifyMode>(initialSettings.mode);
  const [intervalValue, setIntervalValue] = useState<number>(
    initialSettings.intervalValue
  );
  const [intervalUnit, setIntervalUnit] = useState<MailNotifyUnit>(
    initialSettings.intervalUnit
  );
  const [isPending, startTransition] = useTransition();
  const [isTestPending, startTestTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const personalEmail = initialSettings.personalEmail;
  const hasPersonalEmail = !!personalEmail;

  const currentMinutes = computeMinutes(intervalValue, intervalUnit);
  const intervalTooLow = mode === "summary" && currentMinutes < MIN_INTERVAL_MINUTES;

  function handleTestSend() {
    setMessage(null);
    startTestTransition(async () => {
      const result = await sendMailNotifyTest();
      if (result.success) {
        setMessage({
          type: "success",
          text: `Mail de test envoyé à ${personalEmail}${
            result.unread !== undefined
              ? ` (${result.unread} non lu${result.unread > 1 ? "s" : ""} dans la boîte pro)`
              : ""
          }.`,
        });
      } else {
        setMessage({ type: "error", text: result.error || "Envoi du test impossible." });
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await updateMailNotifySettings({
        mode,
        intervalValue,
        intervalUnit,
      });
      if (result.success) {
        setMessage({ type: "success", text: "Paramètres enregistrés." });
      } else {
        setMessage({ type: "error", text: result.error || "Erreur" });
      }
    });
  }

  const summarySelected = mode === "summary";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {!hasPersonalEmail && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          Aucune adresse perso vérifiée. Configurez-la d'abord dans la carte «
          Adresse e-mail où recevoir » en haut de cette page.
        </div>
      )}

      <div className="text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">
        Choisissez un mode
      </div>

      {/* Mode : off */}
      <ModeOption
        value="off"
        selected={mode === "off"}
        onSelect={() => setMode("off")}
        title="Aucune notification"
        description="Rien envoyé sur votre perso. Vous consultez la boîte pro depuis le webmail uniquement."
        color="slate"
      />

      {/* Mode : summary */}
      <ModeOption
        value="summary"
        selected={summarySelected}
        onSelect={() => setMode("summary")}
        title="Résumé périodique"
        description="Un e-mail à intervalle régulier avec le nombre de mails non lus. Idéal si vous consultez peu."
        color="violet"
        disabled={!hasPersonalEmail}
      >
        {summarySelected && (
          <div className="grid grid-cols-2 gap-3 mt-3 max-w-sm">
            <div>
              <label className="text-xs font-semibold text-text-primary mb-1 block">
                Fréquence
              </label>
              <input
                type="number"
                min={1}
                value={intervalValue}
                onChange={(e) =>
                  setIntervalValue(Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm bg-bg-primary focus:ring-2 focus:ring-violet-500 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-primary mb-1 block">
                Unité
              </label>
              <select
                value={intervalUnit}
                onChange={(e) => setIntervalUnit(e.target.value as MailNotifyUnit)}
                className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm bg-bg-primary focus:ring-2 focus:ring-violet-500 focus:border-violet-500 focus:outline-none"
              >
                {(Object.keys(UNIT_LABELS) as MailNotifyUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {summarySelected && intervalTooLow && (
          <p className="text-[11px] text-red-600 mt-2 font-medium">
            Minimum {MIN_INTERVAL_MINUTES} minutes — sinon Gmail/Outlook risquent de bannir l'expéditeur pour spam.
          </p>
        )}
      </ModeOption>

      {/* Mode : forward */}
      <ModeOption
        value="forward"
        selected={mode === "forward"}
        onSelect={() => setMode("forward")}
        title="Transfert instantané"
        description="Chaque mail reçu sur la boîte pro est retransféré immédiatement sur votre perso avec l'expéditeur, le sujet et le contenu complet."
        color="violet"
        disabled={!hasPersonalEmail}
      />

      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-body ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap justify-between items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleTestSend}
          disabled={isTestPending || mode === "off" || !hasPersonalEmail}
          className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-bg-primary text-text-primary font-medium text-sm px-4 py-2 hover:bg-bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.6}
              d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
            />
          </svg>
          {isTestPending ? "Envoi…" : "Envoyer un test"}
        </button>
        <button
          type="submit"
          disabled={isPending || intervalTooLow || (mode !== "off" && !hasPersonalEmail)}
          className="rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2 transition"
        >
          {isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

function ModeOption({
  value,
  selected,
  onSelect,
  title,
  description,
  color,
  disabled,
  children,
}: {
  value: string;
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  color: "violet" | "slate";
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const activeBorder =
    color === "violet"
      ? "border-violet-500 bg-violet-50/60"
      : "border-text-primary bg-bg-secondary";
  const accent = color === "violet" ? "accent-violet-600" : "accent-text-primary";

  return (
    <label
      className={`flex items-start gap-3 rounded-xl border-2 bg-bg-primary p-4 transition ${
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer hover:border-border-strong"
      } ${selected ? activeBorder : "border-border"}`}
    >
      <input
        type="radio"
        name="notif-mode"
        value={value}
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        className={`mt-1 h-5 w-5 flex-shrink-0 ${accent}`}
      />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-bold text-text-primary">{title}</span>
        <p className="text-xs text-text-muted mt-1 leading-snug">{description}</p>
        {children}
      </div>
    </label>
  );
}
