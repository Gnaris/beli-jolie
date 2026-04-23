"use client";

import { useState, useTransition } from "react";
import { updateShippingMargin } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import CustomSelect from "@/components/ui/CustomSelect";

interface Props {
  initialType: "fixed" | "percent";
  initialValue: number;
}

export default function ShippingMarginConfig({ initialType, initialValue }: Props) {
  const [type, setType] = useState<"fixed" | "percent">(initialType);
  const [value, setValue] = useState(String(initialValue));
  const [isSaving, startSaving] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  function handleSave() {
    const numValue = parseFloat(value) || 0;
    if (numValue < 0) {
      toast.error("Erreur", "La valeur doit être positive.");
      return;
    }
    showLoading();
    startSaving(async () => {
      try {
        const result = await updateShippingMargin({ type, value: numValue });
        if (result.success) {
          toast.success("Enregistré", "La marge sur les frais de port a été mise à jour.");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary font-body">
        Cette marge est ajoutée automatiquement au prix de chaque transporteur proposé par Easy-Express.
        Mettez <strong>0</strong> pour ne rien ajouter.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="margin-type" className="block text-sm font-body font-medium text-text-primary mb-1.5">
            Type de marge
          </label>
          <CustomSelect
            id="margin-type"
            value={type}
            onChange={(v) => setType(v as "fixed" | "percent")}
            options={[
              { value: "fixed", label: "Montant fixe (€)" },
              { value: "percent", label: "Pourcentage (%)" },
            ]}
          />
        </div>
        <div>
          <label htmlFor="margin-value" className="block text-sm font-body font-medium text-text-primary mb-1.5">
            Valeur
          </label>
          <div className="relative">
            <input
              id="margin-value"
              type="number"
              step="0.01"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="field-input w-full pr-10"
              disabled={isSaving}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted font-body">
              {type === "fixed" ? "€" : "%"}
            </span>
          </div>
        </div>
      </div>

      {/* Preview */}
      {parseFloat(value) > 0 && (
        <div className="bg-bg-secondary border border-border rounded-lg px-4 py-3 text-sm font-body text-text-secondary">
          {type === "fixed"
            ? `Exemple : un transporteur à 8,00 € sera affiché à ${(8 + (parseFloat(value) || 0)).toFixed(2)} €`
            : `Exemple : un transporteur à 8,00 € sera affiché à ${(8 * (1 + (parseFloat(value) || 0) / 100)).toFixed(2)} €`}
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="btn-primary disabled:opacity-50"
      >
        {isSaving ? "Enregistrement..." : "Enregistrer"}
      </button>
    </div>
  );
}
