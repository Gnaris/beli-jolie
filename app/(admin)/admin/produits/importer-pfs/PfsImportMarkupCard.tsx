"use client";

import { useMemo, useState, useTransition } from "react";
import { MarkupRow, type MarkupState } from "@/components/admin/settings/MarkupRow";
import { applyMarketplaceMarkup } from "@/lib/marketplace-pricing-shared";
import { updatePfsImportPriceMarkup } from "@/app/actions/admin/pfs-import-markup";
import { useToast } from "@/components/ui/Toast";

const SAMPLE_PRICE = 10;

export function PfsImportMarkupCard({ initial }: { initial: MarkupState }) {
  const [state, setState] = useState<MarkupState>(initial);
  const [saved, setSaved] = useState<MarkupState>(initial);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const preview = useMemo(() => applyMarketplaceMarkup(SAMPLE_PRICE, state), [state]);
  const isNoop = state.value === 0;
  const isDirty =
    state.type !== saved.type ||
    state.value !== saved.value ||
    state.rounding !== saved.rounding;

  const onSave = () => {
    startTransition(async () => {
      const res = await updatePfsImportPriceMarkup(state);
      if (res.success) {
        setSaved(state);
        toast.success("Majoration enregistrée");
      } else {
        toast.error(res.error || "Erreur d'enregistrement");
      }
    });
  };

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.18em] text-text-secondary">
          Majoration à l&apos;import
        </h2>
        <p className="text-xs text-text-muted mt-1">
          S&apos;applique une seule fois, au moment où le produit arrive dans votre catalogue.
          Le prix reçu de Paris Fashion Shop est transformé selon ce réglage. Utile pour vendre moins cher
          (valeur négative) ou plus cher que sur PFS.
        </p>
      </div>

      <MarkupRow
        label="Prix PFS → prix boutique"
        state={state}
        onChange={setState}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl bg-bg-secondary/60 border border-border-light px-4 py-3">
        <div className="text-xs text-text-muted">
          Exemple :{" "}
          {isNoop ? (
            <span className="text-text-secondary font-medium">
              aucune majoration — les prix seront importés tels quels
            </span>
          ) : (
            <>
              un produit à <span className="font-mono text-text-primary">10,00 €</span> sur PFS deviendra{" "}
              <span
                data-testid="preview-result"
                className="font-mono font-semibold text-text-primary"
              >
                {preview.toFixed(2)} €
              </span>{" "}
              dans votre boutique
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || pending}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
