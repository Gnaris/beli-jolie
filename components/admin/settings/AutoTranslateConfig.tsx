"use client";

import { useState, useTransition } from "react";
import { updateAutoTranslate } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  enabled: boolean;
}

export default function AutoTranslateConfig({ enabled: initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  function handleToggle() {
    const newValue = !enabled;
    setEnabled(newValue);
    showLoading();
    startTransition(async () => {
      try {
        const result = await updateAutoTranslate(newValue);
        if (result.success) {
          toast.success(
            newValue ? "Activé" : "Désactivé",
            newValue
              ? "Les traductions seront générées automatiquement."
              : "Les traductions automatiques sont désactivées."
          );
        } else {
          setEnabled(!newValue); // revert
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <p className="font-body text-sm font-medium text-text-primary">
          Traduction automatique
        </p>
        <p className="font-body text-xs text-text-secondary mt-0.5">
          Traduit automatiquement les noms et descriptions des produits, couleurs, catégories,
          compositions, collections, pays, saisons et tags lors de leur création.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={handleToggle}
        disabled={isPending}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 focus:ring-offset-2 disabled:opacity-50 ${
          enabled ? "bg-bg-dark" : "bg-[#D1D1D1]"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-bg-primary shadow ring-0 transition duration-200 ease-in-out ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
