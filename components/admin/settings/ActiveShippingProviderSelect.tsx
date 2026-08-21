"use client";

import { useState, useTransition } from "react";
import { setActiveShippingProvider } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import CustomSelect from "@/components/ui/CustomSelect";

interface Props {
  initialProvider: "easy_express" | "smarty365";
  hasEasyExpressKey: boolean;
  hasSmarty365Key: boolean;
}

export default function ActiveShippingProviderSelect({
  initialProvider,
  hasEasyExpressKey,
  hasSmarty365Key,
}: Props) {
  const [provider, setProvider] = useState<"easy_express" | "smarty365">(initialProvider);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  function handleChange(next: string) {
    const value = next === "smarty365" ? "smarty365" : "easy_express";
    if (value === provider) return;

    if (value === "smarty365" && !hasSmarty365Key) {
      toast.warning("Clé manquante", "Renseignez d'abord la clé Smarty365 dans la carte au-dessus.");
      return;
    }
    if (value === "easy_express" && !hasEasyExpressKey) {
      toast.warning("Clé manquante", "Renseignez d'abord la clé Easy-Express dans la carte au-dessus.");
      return;
    }

    showLoading();
    startTransition(async () => {
      try {
        const res = await setActiveShippingProvider(value);
        if (res.success) {
          setProvider(value);
          toast.success(
            "Fournisseur mis à jour",
            value === "smarty365"
              ? "Les nouvelles commandes verront les tarifs Smarty365."
              : "Les nouvelles commandes verront les tarifs Easy-Express.",
          );
        } else {
          toast.error("Erreur", res.error);
        }
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-bg-secondary/40 px-4 py-3 text-xs font-body text-text-secondary">
        <p>
          Ce réglage détermine <strong className="text-text-primary">quelle liste de tarifs</strong>
          {" "}est proposée à vos clientes au moment du panier, et par défaut quel fournisseur
          génère le bordereau en admin.
        </p>
        <p className="mt-1.5">
          Les commandes déjà passées gardent leur fournisseur d&apos;origine — basculer
          n&apos;affectera que les nouvelles commandes.
        </p>
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-2">
          Fournisseur actif
        </label>
        <CustomSelect
          value={provider}
          onChange={handleChange}
          disabled={pending}
          options={[
            { value: "easy_express", label: "Easy-Express" },
            { value: "smarty365", label: "Smarty365" },
          ]}
        />
      </div>
    </div>
  );
}
