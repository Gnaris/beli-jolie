"use client";

import { useState, useTransition } from "react";
import { setMaintenanceMode } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Props {
  currentValue: boolean;
  isAuto?: boolean;
}

export default function MaintenanceModeToggle({ currentValue, isAuto = false }: Props) {
  const [enabled, setEnabled] = useState(currentValue);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();

  async function handleToggle() {
    const newValue = !enabled;
    const ok = await confirm({
      type: newValue ? "danger" : "info",
      title: newValue ? "Activer la maintenance ?" : "Désactiver la maintenance ?",
      message: newValue
        ? "Le site deviendra immédiatement inaccessible aux clients. Seul l'administrateur pourra continuer à le parcourir."
        : "Le site redeviendra accessible à tous les clients connectés.",
      confirmLabel: newValue ? "Activer" : "Désactiver",
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await setMaintenanceMode(newValue);
      if (result.success) {
        setEnabled(newValue);
        toast.success(
          newValue ? "Maintenance activée" : "Site en ligne",
          newValue
            ? "Les clients ne peuvent plus accéder au site."
            : "Le site est de nouveau accessible aux clients.",
        );
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  return (
    <>
      {/* Toggle row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-body text-sm text-text-primary font-medium">
            {enabled ? "Maintenance activée" : "Site en ligne"}
          </p>
          <p className="font-body text-xs text-text-secondary mt-0.5">
            {enabled
              ? "Seul l'administrateur peut accéder au site."
              : "Le site est accessible à tous les clients."}
          </p>
        </div>

        {/* Toggle button */}
        <button
          type="button"
          disabled={isPending}
          onClick={handleToggle}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1A1A1A] disabled:opacity-50 ${
            enabled ? "bg-[#EF4444]" : "bg-[#D1D1D1]"
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

      {/* Status indicator */}
      <div className="mt-4 flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${enabled ? "bg-[#EF4444] animate-pulse" : "bg-[#22C55E]"}`}
        />
        <span className="font-body text-sm text-text-secondary">
          {enabled
            ? isAuto
              ? "Maintenance automatique (erreurs détectées)"
              : "Maintenance active"
            : "Opérationnel"}
        </span>
      </div>
    </>
  );
}
