"use client";

import { useState, useTransition } from "react";
import { toggleMarketplaceMaintenance } from "@/app/actions/admin/platform-maintenance";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type MarketplaceKey = "pfs" | "ankorstore" | "efashion" | "faire";

interface Props {
  marketplace: MarketplaceKey;
  label: string;
  gradient: string;
  letter: string;
  currentValue: boolean;
}

export default function MarketplaceMaintenanceToggle({
  marketplace,
  label,
  gradient,
  letter,
  currentValue,
}: Props) {
  const [enabled, setEnabled] = useState(currentValue);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();

  async function handleToggle() {
    const newValue = !enabled;
    const ok = await confirm({
      type: newValue ? "danger" : "info",
      title: newValue ? `Mettre ${label} en maintenance ?` : `Sortir ${label} de maintenance ?`,
      message: newValue
        ? `Toutes les boutiques (${label}) seront immédiatement bloquées : plus de publication, synchronisation, refresh ni suppression sur ${label}. Le badge apparaîtra hachuré sur tous les produits.`
        : `${label} redeviendra accessible pour toutes les boutiques.`,
      confirmLabel: newValue ? "Mettre en maintenance" : "Réactiver",
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await toggleMarketplaceMaintenance(marketplace, newValue);
      if (result.success) {
        setEnabled(newValue);
        toast.success(
          newValue ? `${label} en maintenance` : `${label} réactivée`,
          newValue
            ? `Les boutiques ne peuvent plus interagir avec ${label}.`
            : `Les boutiques peuvent à nouveau interagir avec ${label}.`,
        );
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-border bg-bg-primary">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="inline-flex items-center justify-center w-9 h-9 rounded-full text-white text-sm font-extrabold flex-shrink-0"
          style={{ background: gradient }}
          aria-hidden
        >
          {letter}
        </span>
        <div className="min-w-0">
          <p className="font-body text-sm font-medium text-text-primary truncate">{label}</p>
          <p className="font-body text-xs text-text-secondary mt-0.5">
            {enabled ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse" />
                En maintenance — toutes les boutiques bloquées
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                Opérationnelle
              </span>
            )}
          </p>
        </div>
      </div>

      <button
        type="button"
        disabled={isPending}
        onClick={handleToggle}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1A1A1A] disabled:opacity-50 flex-shrink-0 ${
          enabled ? "bg-[#EF4444]" : "bg-[#D1D1D1]"
        }`}
        aria-checked={enabled}
        role="switch"
        aria-label={enabled ? `Sortir ${label} de maintenance` : `Mettre ${label} en maintenance`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-bg-primary shadow-sm transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
