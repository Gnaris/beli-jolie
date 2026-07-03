"use client";

import { useState, useTransition } from "react";
import { setVatExemption } from "@/app/actions/admin/setVatExemption";
import { useToast } from "@/components/ui/Toast";
import { isEuNonFrance, getCountry } from "@/lib/vat";

interface Props {
  userId: string;
  initialExempt: boolean;
  validatedAt: Date | null;
  validatedByLabel: string | null;
  countryCode: string | null;
}

/**
 * Bandeau compact « Application de la TVA » — style Ardoise inline.
 * Affiche l'état par pays (FR / UE hors FR / hors UE / non renseigné)
 * et propose le switch d'exonération quand le client est éligible.
 */
export default function VatExemptionToggle({
  userId,
  initialExempt,
  validatedAt,
  validatedByLabel,
  countryCode,
}: Props) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [exempt, setExempt] = useState(initialExempt);
  const [validatedAtState, setValidatedAtState] = useState<Date | null>(validatedAt);

  const country = getCountry(countryCode);
  const eligible = isEuNonFrance(countryCode);

  function toggle(next: boolean) {
    startTransition(async () => {
      const result = await setVatExemption(userId, next);
      if (!result.success) {
        toast.error("Mise à jour impossible", result.error);
        return;
      }
      setExempt(next);
      setValidatedAtState(next ? new Date() : null);
      if (next) {
        toast.success("Client exonéré de TVA", "La TVA ne sera plus appliquée à ses commandes (sauf retrait en boutique).");
      } else {
        toast.success("Exonération retirée", "La TVA française sera de nouveau appliquée.");
      }
    });
  }

  // Statut affiché
  let statusLabel: string;
  let statusHint: string;
  if (!countryCode) {
    statusLabel = "Adresse non renseignée";
    statusHint = "Impossible de gérer la TVA sans adresse.";
  } else if (countryCode === "FR") {
    statusLabel = "TVA française (20 %) appliquée";
    statusHint = "S'applique systématiquement aux clients français.";
  } else if (eligible) {
    statusLabel = exempt ? "Client exonéré (auto-liquidation)" : "TVA française (20 %) appliquée";
    statusHint = exempt && validatedAtState
      ? `Validé le ${validatedAtState.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}${validatedByLabel ? ` par ${validatedByLabel}` : ""}.`
      : `Pays : ${country?.name ?? countryCode}. Activez uniquement si le n° VIES correspond à cette entreprise.`;
  } else {
    statusLabel = "Hors UE — pas de TVA sur livraisons";
    statusHint = `Pays : ${country?.name ?? countryCode}. TVA appliquée uniquement si retrait en boutique.`;
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-4 flex items-start sm:items-center gap-3 sm:gap-4 flex-wrap">
        <span className="w-10 h-10 rounded-xl bg-bg-tertiary flex items-center justify-center text-text-primary shrink-0">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">Application de la TVA</p>
          <p className="text-xs text-text-secondary mt-0.5">
            <span className="font-medium">{statusLabel}</span>
            <span className="text-text-muted"> — {statusHint}</span>
          </p>
        </div>
        {eligible && (
          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
            <span className="text-[11px] text-text-muted">Exonérer</span>
            <button
              type="button"
              role="switch"
              aria-checked={exempt}
              disabled={isPending}
              onClick={() => toggle(!exempt)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                exempt ? "bg-text-primary" : "bg-border-strong"
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
                exempt ? "translate-x-5" : "translate-x-0.5"
              }`} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
