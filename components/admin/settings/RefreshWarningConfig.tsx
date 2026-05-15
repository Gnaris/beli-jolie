"use client";

import { useState, useTransition } from "react";
import { updateRefreshWarning } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface Props {
  initialEnabled: boolean;
  initialDays: number;
}

export default function RefreshWarningConfig({ initialEnabled, initialDays }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [days, setDays] = useState<string>(String(initialDays));
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function persist(nextEnabled: boolean, nextDays: number) {
    startTransition(async () => {
      const result = await updateRefreshWarning(nextEnabled, nextDays);
      if (result.success) {
        toast.success("Enregistré", "Le garde-fou a été mis à jour.");
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    const num = parseInt(days, 10);
    if (Number.isFinite(num) && num >= 1 && num <= 365) {
      persist(next, num);
    }
  }

  function handleDaysSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseInt(days, 10);
    if (!Number.isFinite(num) || num < 1 || num > 365) {
      toast.error("Valeur invalide", "Saisissez un nombre entre 1 et 365.");
      return;
    }
    persist(enabled, num);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-body text-sm text-text-primary font-medium">
            {enabled ? "Garde-fou activé" : "Garde-fou désactivé"}
          </p>
          <p className="font-body text-xs text-text-secondary mt-0.5">
            {enabled
              ? "Vous serez prévenue avant de rafraîchir un produit déjà rafraîchi récemment."
              : "Aucun avertissement, le rafraîchissement se lance directement."}
          </p>
        </div>

        <button
          type="button"
          disabled={isPending}
          onClick={handleToggle}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1A1A1A] disabled:opacity-50 ${
            enabled ? "bg-[#22C55E]" : "bg-[#D1D1D1]"
          }`}
          aria-checked={enabled}
          role="switch"
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-bg-primary shadow-sm transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <form onSubmit={handleDaysSubmit} className="space-y-3">
        <div>
          <label htmlFor="refreshWarningDays" className="field-label">
            Période d&apos;avertissement
          </label>
          <p className="text-xs text-text-secondary font-body mb-2">
            Vous serez prévenue si un produit a été rafraîchi il y a moins de ce nombre de jours.
          </p>
          <div className="relative max-w-[220px]">
            <input
              id="refreshWarningDays"
              type="number"
              min="1"
              max="365"
              step="1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="field-input pr-16"
              disabled={isPending || !enabled}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary font-body pointer-events-none">
              jours
            </span>
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending || !enabled}
          className="btn-primary"
        >
          {isPending ? "Enregistrement..." : "Enregistrer"}
        </button>
      </form>
    </div>
  );
}
