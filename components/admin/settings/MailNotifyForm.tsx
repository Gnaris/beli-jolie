"use client";

import { useState, useTransition } from "react";
import { updateMailNotifySettings, sendMailNotifyTest } from "@/app/actions/admin/mail-notify";
import { MIN_INTERVAL_MINUTES, toMinutes as computeMinutes, type MailNotifySettings, type MailNotifyUnit } from "@/lib/mail-notify-constants";

interface Props {
  initialSettings: MailNotifySettings;
}

const UNIT_LABELS: Record<MailNotifyUnit, string> = {
  minute: "minute(s)",
  hour: "heure(s)",
  day: "jour(s)",
};

export default function MailNotifyForm({ initialSettings }: Props) {
  const [form, setForm] = useState<MailNotifySettings>(initialSettings);
  const [isPending, startTransition] = useTransition();
  const [isTestPending, startTestTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function handleTestSend() {
    setMessage(null);
    startTestTransition(async () => {
      const result = await sendMailNotifyTest();
      if (result.success) {
        setMessage({
          type: "success",
          text: `✅ Mail de test envoyé à ${form.email} (${result.unread ?? 0} non lu${(result.unread ?? 0) > 1 ? "s" : ""} dans la boîte pro).`,
        });
      } else {
        setMessage({ type: "error", text: result.error || "Envoi du test impossible." });
      }
    });
  }

  function updateField<K extends keyof MailNotifySettings>(key: K, value: MailNotifySettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await updateMailNotifySettings(form);
      if (result.success) {
        setMessage({ type: "success", text: "Paramètres de notification enregistrés." });
      } else {
        setMessage({ type: "error", text: result.error || "Erreur" });
      }
    });
  }

  // Un des 2 modes doit être actif pour que l'email et les autres champs soient utilisables
  const anyEnabled = form.enabled || form.forwardEnabled;
  const emailDisabled = !anyEnabled;
  const intervalDisabled = !form.enabled;
  const currentMinutes = computeMinutes(form.intervalValue, form.intervalUnit);
  const intervalTooLow = form.enabled && currentMinutes < MIN_INTERVAL_MINUTES;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Toggle notifications résumé ────────────────────────────────── */}
      <label className="flex items-start gap-3 cursor-pointer p-4 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => updateField("enabled", e.target.checked)}
          className="mt-1 w-4 h-4 rounded border-zinc-300 accent-emerald-600"
        />
        <div className="flex-1">
          <div className="text-sm font-semibold text-zinc-900">Notifications de résumé</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            À intervalle régulier, un mail vous prévient combien de messages non lus sont dans la boîte pro.
          </div>
        </div>
      </label>

      {/* ── Toggle forward ────────────────────────────────────────────── */}
      <label className="flex items-start gap-3 cursor-pointer p-4 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors">
        <input
          type="checkbox"
          checked={form.forwardEnabled}
          onChange={(e) => updateField("forwardEnabled", e.target.checked)}
          className="mt-1 w-4 h-4 rounded border-zinc-300 accent-emerald-600"
        />
        <div className="flex-1">
          <div className="text-sm font-semibold text-zinc-900">Transférer chaque mail reçu</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Chaque nouveau mail arrivé dans la boîte pro est aussi transféré vers votre adresse perso, avec le message original en pièce jointe.
          </div>
        </div>
      </label>

      {/* ── Email destinataire (commun aux 2 options) ─────────────────── */}
      <div>
        <label className="field-label">Adresse email où recevoir</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => updateField("email", e.target.value)}
          placeholder="Ex: mon-mail-perso@gmail.com"
          disabled={emailDisabled}
          className={`field-input ${emailDisabled ? "bg-zinc-50 text-zinc-400 cursor-not-allowed" : ""}`}
        />
        <p className="text-[11px] text-zinc-500 mt-1">
          Idéalement une adresse que vous consultez souvent (Gmail, Outlook…). Utilisée pour les 2 options (résumé + transfert).
        </p>
      </div>

      {/* ── Intervalle du résumé ─────────────────────────────────────── */}
      <div>
        <label className={`field-label ${intervalDisabled ? "text-zinc-400" : ""}`}>Fréquence du résumé</label>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${intervalDisabled ? "text-zinc-400" : "text-zinc-600"}`}>Tous les</span>
          <input
            type="number"
            min={1}
            value={form.intervalValue}
            onChange={(e) => updateField("intervalValue", Math.max(1, parseInt(e.target.value, 10) || 1))}
            disabled={intervalDisabled}
            className={`field-input w-24 ${intervalDisabled ? "bg-zinc-50 text-zinc-400 cursor-not-allowed" : ""}`}
          />
          <select
            value={form.intervalUnit}
            onChange={(e) => updateField("intervalUnit", e.target.value as MailNotifyUnit)}
            disabled={intervalDisabled}
            className={`field-input w-auto ${intervalDisabled ? "bg-zinc-50 text-zinc-400 cursor-not-allowed" : ""}`}
          >
            {(Object.keys(UNIT_LABELS) as MailNotifyUnit[]).map((u) => (
              <option key={u} value={u}>{UNIT_LABELS[u]}</option>
            ))}
          </select>
        </div>
        {intervalTooLow && (
          <p className="text-[11px] text-red-600 mt-2 font-medium">
            ⚠ Minimum {MIN_INTERVAL_MINUTES} minutes — sinon Gmail/Outlook considèrent les mails comme du spam et bannissent l'expéditeur.
          </p>
        )}
        {form.enabled && !intervalTooLow && (
          <p className="text-[11px] text-zinc-500 mt-2">
            Ex : « Tous les 30 minutes » → vous recevrez un mail toutes les 30 min uniquement s'il y a au moins 1 mail non lu.
          </p>
        )}
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm font-body ${
          message.type === "success"
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap justify-between items-center gap-3">
        <button
          type="button"
          onClick={handleTestSend}
          disabled={isTestPending || !form.enabled || !form.email}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white text-zinc-700 font-medium text-sm px-4 py-2 hover:bg-zinc-50 hover:border-zinc-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={!form.enabled ? "Activez d'abord les notifications de résumé" : !form.email ? "Renseignez d'abord un email" : "Force un envoi immédiat pour vérifier la config"}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
          {isTestPending ? "Envoi en cours…" : "Envoyer un test maintenant"}
        </button>
        <button type="submit" disabled={isPending || intervalTooLow} className="btn-primary">
          {isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      <div className="text-[11px] text-zinc-500 leading-relaxed border-t border-zinc-100 pt-3">
        💡 <strong>Défaut recommandé :</strong> résumé tous les <strong>30 minutes</strong> (minimum autorisé), et transfert activé si vous voulez tout voir en direct dans votre boîte perso. Vous pouvez cumuler les deux options.
      </div>
    </form>
  );
}
