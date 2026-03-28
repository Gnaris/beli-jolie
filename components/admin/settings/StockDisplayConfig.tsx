"use client";

import { useState, useTransition } from "react";
import { updateStockDisplayConfig } from "@/app/actions/admin/site-config";

interface Props {
  showOutOfStockVariants: boolean;
  showOutOfStockProducts: boolean;
}

export default function StockDisplayConfig({ showOutOfStockVariants, showOutOfStockProducts }: Props) {
  const [variants, setVariants] = useState(showOutOfStockVariants);
  const [products, setProducts] = useState(showOutOfStockProducts);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const hasChanges = variants !== showOutOfStockVariants || products !== showOutOfStockProducts;

  function handleSave() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateStockDisplayConfig({
        showOutOfStockVariants: variants,
        showOutOfStockProducts: products,
      });
      setMsg(res.success ? { ok: true, text: "Enregistré" } : { ok: false, text: res.error ?? "Erreur" });
      if (res.success) setTimeout(() => setMsg(null), 3000);
    });
  }

  return (
    <div className="space-y-4">
      {/* Toggle 1 — Produits en rupture */}
      <label className="flex items-start gap-3 cursor-pointer select-none group">
        <div className="relative mt-0.5 shrink-0">
          <input
            type="checkbox"
            checked={products}
            onChange={(e) => setProducts(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-[22px] bg-[#D1D5DB] rounded-full peer-checked:bg-bg-dark transition-colors" />
          <div className="absolute top-[3px] left-[3px] w-4 h-4 bg-bg-primary rounded-full shadow-sm transition-transform peer-checked:translate-x-[18px]" />
        </div>
        <div>
          <p className="text-sm font-medium text-text-primary font-body">
            Afficher les produits en rupture totale
          </p>
          <p className="text-xs text-text-secondary font-body mt-0.5">
            Si désactivé, les produits dont <strong>toutes</strong> les variantes sont à stock 0 seront masqués du catalogue et de l&apos;accueil.
          </p>
        </div>
      </label>

      {/* Toggle 2 — Variantes en rupture */}
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
