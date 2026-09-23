"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { updateClientMinOrderOverride } from "@/app/actions/admin/updateClientMinOrder";

interface Props {
  userId: string;
  initialOverrideHt: number | null;
  /** Seuil global qui s'appliquerait à ce client sans override. Informatif. */
  globalMinHt: number;
  /** Étiquette lisible du seuil global (ex. « 100 € HT · toutes commandes »). */
  globalMinLabel: string;
}

/**
 * Bloc « Minimum de commande » sur la fiche client admin.
 *
 * Un seul levier : override permanent — vide = suit le global, 0 = aucun
 * minimum pour ce client (VIP), > 0 = seuil personnel. L'admin ajuste
 * quand elle veut.
 */
export default function ClientMinOrderPanel(props: Props) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const initialOverride =
    props.initialOverrideHt == null ? "" : String(props.initialOverrideHt);

  const [override, setOverride] = useState<string>(initialOverride);

  const parsedOverride = override.trim() === "" ? null : Number(override);
  const overrideInvalid =
    parsedOverride != null && (!Number.isFinite(parsedOverride) || parsedOverride < 0);
  const overrideDirty = (parsedOverride ?? null) !== (props.initialOverrideHt ?? null);

  function save() {
    if (overrideInvalid) return;
    startTransition(async () => {
      const res = await updateClientMinOrderOverride(props.userId, {
        minimumOrderOverrideHt: parsedOverride,
      });
      if (res.success) {
        toast.success(
          "Minimum enregistré",
          parsedOverride == null
            ? "Ce client suit à nouveau le minimum global."
            : parsedOverride === 0
              ? "Aucun minimum ne s'applique à ce client."
              : `Minimum de ${parsedOverride} € HT pour ce client.`,
        );
      } else {
        toast.error("Erreur", res.error);
      }
    });
  }

  const effectiveText = (() => {
    if (parsedOverride === 0) return "Aucun minimum pour ce client";
    if (parsedOverride != null && parsedOverride > 0)
      return `${parsedOverride} € HT (minimum personnel)`;
    return props.globalMinHt > 0
      ? props.globalMinLabel
      : "Aucun minimum (pas de règle globale)";
  })();

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold text-text-primary">
            Minimum de commande
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Ce client peut passer des commandes à partir de ce montant HT.
          </p>
        </div>
        <span className="badge badge-info text-[11px] shrink-0">Actuel : {effectiveText}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1 block">
            Minimum personnalisé (HT)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              placeholder="Vide = valeur globale"
              className={`field-input h-11 w-40 ${overrideInvalid ? "border-error" : ""}`}
            />
            <span className="text-sm text-text-muted">€ HT</span>
          </div>
          <p className="text-[11px] text-text-muted mt-2 leading-relaxed">
            Laisser vide pour appliquer le minimum global. <strong>0</strong> = ce
            client n&apos;a aucun minimum (VIP). La valeur reste active tant que
            vous ne la retirez pas — le client peut passer autant de commandes
            qu&apos;il veut à ce seuil.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={isPending || overrideInvalid || !overrideDirty}
          className="h-11 px-5 rounded-xl bg-bg-dark text-text-inverse text-sm font-semibold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
