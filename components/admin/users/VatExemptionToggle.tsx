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
        toast.success(
          "Client exonéré de TVA",
          "La TVA ne sera plus appliquée à ses commandes (sauf retrait en boutique).",
        );
      } else {
        toast.success(
          "Exonération retirée",
          "La TVA française sera de nouveau appliquée.",
        );
      }
    });
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-border table-header">
        <h2 className="font-heading text-base font-semibold text-text-primary">
          Application de la TVA
        </h2>
        <p className="text-xs text-text-muted font-body mt-0.5">
          Par défaut, tous les clients UE paient 20 % de TVA française. L&apos;exonération
          n&apos;est possible que pour les sociétés établies dans l&apos;UE hors France
          avec un numéro de TVA intracommunautaire valide.
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="text-sm font-body">
          <span className="text-text-muted">Pays de la société : </span>
          <span className="text-text-primary font-medium">
            {country?.name ?? countryCode ?? "Non renseigné"}
          </span>
        </div>

        {!eligible && (
          <div className="bg-bg-secondary border border-border rounded-lg p-3 text-sm font-body text-text-secondary">
            {countryCode === "FR" && (
              <>La TVA française (20 %) s&apos;applique systématiquement aux clients français.</>
            )}
            {!countryCode && (
              <>L&apos;adresse de la société n&apos;est pas renseignée — impossible de gérer la TVA.</>
            )}
            {countryCode && countryCode !== "FR" && (
              <>
                Ce client n&apos;est pas dans l&apos;UE (ou est en DOM-TOM) : la TVA ne s&apos;applique pas
                à ses livraisons. <strong>Sauf en cas de retrait en boutique</strong>, où 20 %
                de TVA sont appliqués automatiquement.
              </>
            )}
          </div>
        )}

        {eligible && (
          <div className="flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={exempt}
              disabled={isPending}
              onClick={() => toggle(!exempt)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-text-primary focus:ring-offset-2 disabled:opacity-50 ${
                exempt ? "bg-success" : "bg-bg-tertiary"
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                  exempt ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-body font-medium text-text-primary">
                Exonérer ce client de la TVA française
              </p>
              {exempt && validatedAtState && (
                <p className="text-xs text-text-muted font-body mt-1">
                  Validé le{" "}
                  {validatedAtState.toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                  {validatedByLabel ? ` par ${validatedByLabel}` : ""} — auto-liquidation TVA
                  (article 196 directive 2006/112/CE).
                </p>
              )}
              {!exempt && (
                <p className="text-xs text-text-muted font-body mt-1">
                  Active uniquement après avoir vérifié manuellement que le numéro de TVA
                  correspond bien à cette entreprise (carte VIES ci-dessus).
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
