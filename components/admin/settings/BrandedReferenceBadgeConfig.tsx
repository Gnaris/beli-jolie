"use client";

import { useState, useTransition } from "react";
import { updateBrandedReferenceBadge } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface Props {
  initialEnabled: boolean;
}

export default function BrandedReferenceBadgeConfig({ initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await updateBrandedReferenceBadge(next);
      if (result.success) {
        toast.success(
          "Enregistré",
          next
            ? "Le badge « Réf » sera ajouté à la prochaine modification / synchronisation / rafraîchissement de chaque produit."
            : "Le badge « Réf » sera retiré à la prochaine modification / synchronisation / rafraîchissement de chaque produit.",
        );
      } else {
        // rollback UI
        setEnabled(!next);
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-body text-sm text-text-primary font-medium">
            {enabled
              ? "Badge activé"
              : "Badge désactivé"}
          </p>
          <p className="font-body text-xs text-text-secondary mt-0.5">
            {enabled
              ? "La 1ʳᵉ image de chaque produit affiche la référence en haut à droite."
              : "Aucun badge n'est apposé sur les photos produits."}
          </p>
        </div>

        <button
          type="button"
          disabled={isPending}
          onClick={handleToggle}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1A1A1A] disabled:opacity-50 ${
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

      <div className="rounded-xl bg-bg-secondary border border-border px-4 py-3">
        <p className="font-body text-[12px] text-text-secondary leading-relaxed">
          <strong className="text-text-primary">Comment ça marche :</strong> quand vous
          activez le badge, chaque produit reçoit une image supplémentaire en
          position 1 : c'est la 1ʳᵉ photo de sa couleur principale, avec la
          référence apposée en haut à droite. Cette image apparaît sur la
          boutique publique, sur <strong>PFS</strong> et sur <strong>eFashion</strong>.
        </p>
        <p className="font-body text-[12px] text-text-secondary leading-relaxed mt-2">
          <strong className="text-text-primary">Ankorstore et Faire sont exclus :</strong>{" "}
          ces deux marketplaces n'affichent pas le badge dans leurs vignettes
          (bug de leur côté, on a testé plusieurs formats et tailles). Les
          photos envoyées à Ankor et Faire restent donc sans badge.
        </p>
        <p className="font-body text-[12px] text-text-secondary leading-relaxed mt-2">
          Les produits déjà en ligne <strong>ne sont pas modifiés</strong>{" "}
          immédiatement — le badge est ajouté (ou retiré) à leur prochaine
          modification, synchronisation ou rafraîchissement. Si la couleur
          principale a déjà 5 photos, la 5ᵉ est automatiquement supprimée pour
          faire place au badge.
        </p>
      </div>
    </div>
  );
}
