"use client";

import { useState, useTransition } from "react";
import { setVatExemption } from "@/app/actions/admin/setVatExemption";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { isEuNonFrance, getCountry } from "@/lib/vat";

interface Props {
  userId: string;
  initialExempt: boolean;
  validatedAt: Date | null;
  validatedByLabel: string | null;
  countryCode: string | null;
}

export default function VatExemptionHeaderToggle({
  userId,
  initialExempt,
  validatedAt,
  validatedByLabel,
  countryCode,
}: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [exempt, setExempt] = useState(initialExempt);
  const [validatedAtState, setValidatedAtState] = useState<Date | null>(validatedAt);

  const country = getCountry(countryCode);
  const eligible = isEuNonFrance(countryCode);

  // Non éligible : petit chip informatif, pas de toggle.
  if (!eligible) {
    const label = !countryCode
      ? "Adresse non renseignée"
      : countryCode === "FR"
        ? "TVA française (20 %)"
        : `Hors UE — ${country?.name ?? countryCode}`;
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-tertiary text-text-secondary text-[11px] font-medium border border-border"
        title="TVA non gérable pour ce pays"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 22a10 10 0 100-20 10 10 0 000 20z" />
        </svg>
        {label}
      </span>
    );
  }

  async function handleClick() {
    const next = !exempt;
    const validatedLine = validatedAtState && validatedByLabel
      ? ` Précédente validation : ${validatedAtState.toLocaleDateString("fr-FR", {
          day: "numeric", month: "long", year: "numeric",
        })} par ${validatedByLabel}.`
      : "";

    const ok = await confirm.confirm({
      type: next ? "info" : "warning",
      title: next ? "Activer l'exonération TVA ?" : "Désactiver l'exonération TVA ?",
      message: next
        ? `Les prochaines commandes de ${country?.name ?? "ce client"} seront facturées sans TVA (livraison intra-UE avec TVA VIES validée).${validatedLine}`
        : `La TVA française (20 %) sera de nouveau appliquée sur toutes les commandes de ce client.${validatedLine}`,
      confirmLabel: next ? "Activer l'exonération" : "Réappliquer la TVA",
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await setVatExemption(userId, next);
      if (!result.success) {
        toast.error("Mise à jour impossible", result.error);
        return;
      }
      setExempt(next);
      setValidatedAtState(next ? new Date() : null);
      toast.success(
        next ? "Client exonéré de TVA" : "Exonération retirée",
        next
          ? "La TVA ne sera plus appliquée à ses commandes (sauf retrait en boutique)."
          : "La TVA française sera de nouveau appliquée.",
      );
    });
  }

  return (
    <div className="inline-flex items-center gap-2 pl-3 border-l border-border">
      <span className="text-[11px] text-text-secondary select-none">
        {exempt ? "TVA exonérée" : "TVA assujettie"}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={exempt}
        disabled={isPending}
        onClick={handleClick}
        title="Cliquer pour basculer l'exonération TVA intra-UE"
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          exempt ? "bg-text-primary" : "bg-border-strong"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
            exempt ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
