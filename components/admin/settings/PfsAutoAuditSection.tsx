"use client";

/**
 * Bloc Paramètres → Marketplaces → PFS → Audit automatique.
 *
 * Toggle ON/OFF + intervalle (heures, min 1) + email destinataire des alertes.
 * En cas de moindre erreur pendant un run auto, le toggle est repositionné
 * automatiquement à OFF côté serveur — la cliente doit revenir ici pour le
 * réactiver, ce qui lui garantit qu'elle est au courant du blocage.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  getPfsAuditAutoConfigAction,
  setPfsAuditAutoConfigAction,
  type PfsAuditAutoConfig,
} from "@/app/actions/admin/pfs-audit-auto";

const MIN_INTERVAL_SECONDS = 30;

function computeTotalSeconds(d: number, h: number, m: number, s: number): number {
  return Math.max(0, Math.floor(d)) * 86400
    + Math.max(0, Math.floor(h)) * 3600
    + Math.max(0, Math.floor(m)) * 60
    + Math.max(0, Math.floor(s));
}

function formatSeconds(total: number): string {
  if (total <= 0) return "0 s";
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} j`);
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0) parts.push(`${seconds} s`);
  return parts.join(" ") || "0 s";
}

interface PfsAutoAuditSectionProps {
  /** Renvoyé par MarketplaceConfig au parent — cache le bloc tant que PFS n'est pas configuré + marque choisie. */
  disabled: boolean;
  disabledReason?: string;
}

function formatLastRun(ms: number | null): string {
  if (!ms) return "Jamais lancé automatiquement.";
  const d = new Date(ms);
  return `Dernier lancement automatique : ${d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function PfsAutoAuditSection({ disabled, disabledReason }: PfsAutoAuditSectionProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<PfsAuditAutoConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState(0);
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [alertEmail, setAlertEmail] = useState("");

  const totalSeconds = useMemo(
    () => computeTotalSeconds(days, hours, minutes, seconds),
    [days, hours, minutes, seconds],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getPfsAuditAutoConfigAction();
    if (r.success) {
      setConfig(r.config);
      setEnabled(r.config.enabled);
      setDays(r.config.breakdown.days);
      setHours(r.config.breakdown.hours);
      setMinutes(r.config.breakdown.minutes);
      setSeconds(r.config.breakdown.seconds);
      setAlertEmail(r.config.alertEmail);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (disabled) return;
    if (totalSeconds < MIN_INTERVAL_SECONDS) {
      toast.error("Intervalle trop court", `Minimum ${MIN_INTERVAL_SECONDS} secondes.`);
      return;
    }
    setSaving(true);
    try {
      const r = await setPfsAuditAutoConfigAction({
        enabled,
        intervalSeconds: totalSeconds,
        alertEmail,
      });
      if (r.success) {
        toast.success(
          "Enregistré",
          enabled
            ? `Audit PFS automatique activé (toutes les ${formatSeconds(totalSeconds)}).`
            : "Audit PFS automatique désactivé.",
        );
        // Signale aux autres composants (bandeau timer du drawer, badges…)
        // qu'ils doivent re-fetch immédiatement — évite d'attendre le prochain
        // poll 30 s pour voir la nouvelle valeur.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("pfs-audit-config-changed"));
        }
        await load();
      } else {
        toast.error("Impossible d'enregistrer", r.error);
      }
    } finally {
      setSaving(false);
    }
  }, [disabled, enabled, totalSeconds, alertEmail, toast, load]);

  return (
    <div className="space-y-3">
      {disabled && (
        <p className="font-body text-xs text-text-muted italic">
          {disabledReason ?? "Configurez d'abord vos identifiants PFS et sélectionnez une marque."}
        </p>
      )}

      <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-bg-secondary/60 border border-border-light">
        <div className="flex-1 min-w-0">
          <div className="font-body text-sm font-medium text-text-primary">
            Activer l'audit automatique
          </div>
          <div className="font-body text-xs text-text-muted mt-0.5">
            Vérifie tous vos produits PFS à intervalle régulier, applique les corrections corrigeables et propage les changements vers Ankorstore / eFashion / Faire.
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={loading || saving || disabled}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-bg-tertiary peer-focus:ring-2 peer-focus:ring-bg-dark/25 rounded-full peer peer-checked:bg-emerald-600 peer-disabled:opacity-50 transition-colors">
            <div
              className={`absolute top-[3px] left-[3px] bg-white rounded-full h-5 w-5 transition-transform shadow ${
                enabled ? "translate-x-5" : ""
              }`}
            />
          </div>
        </label>
      </div>

      <div className="rounded-xl border border-border-light bg-bg-secondary/40 p-3.5 space-y-3">
        <div>
          <label className="font-body text-xs font-medium text-text-primary block mb-1.5">
            Toutes les…
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <span className="font-body text-[10.5px] text-text-muted mb-0.5">Jours</span>
              <input
                type="number"
                min={0}
                max={90}
                step={1}
                value={days}
                onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))}
                disabled={loading || saving || disabled}
                className="w-20 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-bg-dark/15 transition-shadow disabled:opacity-50"
              />
            </div>
            <div className="flex flex-col">
              <span className="font-body text-[10.5px] text-text-muted mb-0.5">Heures</span>
              <input
                type="number"
                min={0}
                max={23}
                step={1}
                value={hours}
                onChange={(e) => setHours(Math.max(0, Number(e.target.value) || 0))}
                disabled={loading || saving || disabled}
                className="w-20 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-bg-dark/15 transition-shadow disabled:opacity-50"
              />
            </div>
            <div className="flex flex-col">
              <span className="font-body text-[10.5px] text-text-muted mb-0.5">Minutes</span>
              <input
                type="number"
                min={0}
                max={59}
                step={1}
                value={minutes}
                onChange={(e) => setMinutes(Math.max(0, Number(e.target.value) || 0))}
                disabled={loading || saving || disabled}
                className="w-20 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-bg-dark/15 transition-shadow disabled:opacity-50"
              />
            </div>
            <div className="flex flex-col">
              <span className="font-body text-[10.5px] text-text-muted mb-0.5">Secondes</span>
              <input
                type="number"
                min={0}
                max={59}
                step={1}
                value={seconds}
                onChange={(e) => setSeconds(Math.max(0, Number(e.target.value) || 0))}
                disabled={loading || saving || disabled}
                className="w-20 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-bg-dark/15 transition-shadow disabled:opacity-50"
              />
            </div>
          </div>
          <p className="font-body text-xs text-text-muted mt-1.5">
            Minimum 30 secondes.
            {totalSeconds >= MIN_INTERVAL_SECONDS && (
              <> Soit un audit toutes les <strong>{formatSeconds(totalSeconds)}</strong>.</>
            )}
          </p>
        </div>

        <div>
          <label className="font-body text-xs font-medium text-text-primary block mb-1.5">
            Adresse email d'alerte
          </label>
          <input
            type="email"
            value={alertEmail}
            onChange={(e) => setAlertEmail(e.target.value)}
            placeholder="votre@email.com (laissez vide pour utiliser votre email admin)"
            disabled={loading || saving || disabled}
            className="w-full h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-bg-dark/15 transition-shadow disabled:opacity-50"
          />
          <p className="font-body text-xs text-text-muted mt-1.5">
            En cas d'erreur ou de blocage pendant un audit auto, on désactive tout et on vous prévient ici.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-bg-primary border border-border-light">
        <span className="font-body text-xs text-text-muted">
          {config ? formatLastRun(config.lastRunAt) : "Chargement…"}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || saving || disabled}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-bg-dark/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
