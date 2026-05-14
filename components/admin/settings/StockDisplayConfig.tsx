"use client";

import { useState, useTransition } from "react";
import { updateStockDisplayConfig } from "@/app/actions/admin/site-config";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  showOutOfStockVariants: boolean;
}

export default function StockDisplayConfig({ showOutOfStockVariants }: Props) {
  const [variants, setVariants] = useState(showOutOfStockVariants);
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const hasChanges = variants !== showOutOfStockVariants;

  function handleSave() {
    setMsg(null);
    showLoading();
    startTransition(async () => {
      try {
        const res = await updateStockDisplayConfig({
          showOutOfStockVariants: variants,
        });
        setMsg(res.success ? { ok: true, text: "Enregistré" } : { ok: false, text: res.error ?? "Erreur" });
        if (res.success) setTimeout(() => setMsg(null), 3000);
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Toggle — Variantes en rupture
          Note : l'ancien toggle "Afficher les produits en rupture totale" a ete
          retire — un produit dont toutes les variantes sont a 0 est
          automatiquement archive a l'enregistrement et donc deja masque du
          catalogue par le filtre ARCHIVED. */}
      <label className="flex items-start gap-3 cursor-pointer select-none group">
        <div className="relative mt-0.5 shrink-0">
          <input
            type="checkbox"
            checked={variants}
            onChange={(e) => setVariants(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-[22px] bg-[#D1D5DB] rounded-full peer-checked:bg-bg-dark transition-colors" />
          <div className="absolute top-[3px] left-[3px] w-4 h-4 bg-bg-primary rounded-full shadow-sm transition-transform peer-checked:translate-x-[18px]" />
        </div>
        <div>
          <p className="text-sm font-medium text-text-primary font-body">
            Afficher les variantes en rupture
          </p>
          <p className="text-xs text-text-secondary font-body mt-0.5">
            Si désactivé, les variantes individuelles (couleur/taille) à stock 0 seront masquées de la fiche produit et du catalogue.
          </p>
        </div>
      </label>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !hasChanges}
          className="btn-primary text-sm disabled:opacity-40"
        >
          {isPending ? "Enregistrement..." : "Enregistrer"}
        </button>
        {msg && (
          <span className={`text-xs font-body ${msg.ok ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
