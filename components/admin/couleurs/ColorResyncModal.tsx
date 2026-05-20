"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshEnqueueInput,
} from "@/components/admin/products/MarketplaceRefreshContext";
import type { AffectedProduct } from "@/app/actions/admin/color-merge";

export interface ColorResyncModalProps {
  open: boolean;
  onClose: () => void;
  products: AffectedProduct[];
  title: string;
  subtitle: string;
  pfsAvailable: boolean;
  ankorstoreAvailable: boolean;
  pfsDefaultChecked: boolean;
  ankorstoreDefaultChecked: boolean;
}

export default function ColorResyncModal({
  open,
  onClose,
  products,
  title,
  subtitle,
  pfsAvailable,
  ankorstoreAvailable,
  pfsDefaultChecked,
  ankorstoreDefaultChecked,
}: ColorResyncModalProps) {
  const toast = useToast();
  const { enqueue } = useMarketplaceRefreshQueue();
  const [pfsChecked, setPfsChecked] = useState(pfsDefaultChecked && pfsAvailable);
  const [ankorsChecked, setAnkorsChecked] = useState(
    ankorstoreDefaultChecked && ankorstoreAvailable,
  );

  // Resynchroniser les cases sur les defaults quand la modale réouvre avec
  // de nouveaux flags (ex : édition différente).
  useEffect(() => {
    if (open) {
      setPfsChecked(pfsDefaultChecked && pfsAvailable);
      setAnkorsChecked(ankorstoreDefaultChecked && ankorstoreAvailable);
    }
  }, [open, pfsDefaultChecked, pfsAvailable, ankorstoreDefaultChecked, ankorstoreAvailable]);

  if (!open) return null;

  function launch() {
    if (!pfsChecked && !ankorsChecked) {
      toast.error("Aucune marketplace sélectionnée");
      return;
    }
    const inputs: MarketplaceRefreshEnqueueInput[] = [];
    for (const p of products) {
      if (pfsChecked) {
        inputs.push({
          productId: p.productId,
          reference: p.reference,
          productName: p.productName,
          firstImage: p.firstImage,
          options: { local: false, pfs: true, ankorstore: false },
          mode: "publish",
          marketplace: "pfs",
        });
      }
      if (ankorsChecked) {
        inputs.push({
          productId: p.productId,
          reference: p.reference,
          productName: p.productName,
          firstImage: p.firstImage,
          options: { local: false, pfs: false, ankorstore: true },
          mode: "publish",
          marketplace: "ankorstore",
        });
      }
    }
    enqueue(inputs);
    toast.info(
      "Ajoutés à la file",
      `${products.length} produit${products.length > 1 ? "s" : ""} seront re-poussés en arrière-plan (voir le widget en bas à droite).`,
    );
    onClose();
  }

  const noneAvailable = !pfsAvailable && !ankorstoreAvailable;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-bg-primary rounded-2xl shadow-lg max-w-lg w-full p-6 border border-border">
        <h2 className="font-heading text-lg font-semibold text-text-primary">{title}</h2>
        <p className="mt-2 text-sm text-text-secondary font-body">{subtitle}</p>

        <div className="mt-4 space-y-3">
          {pfsAvailable && (
            <label className="flex items-center gap-2 text-sm font-body cursor-pointer">
              <input
                type="checkbox"
                checked={pfsChecked}
                onChange={(e) => setPfsChecked(e.target.checked)}
                className="w-4 h-4"
              />
              <span>Re-pousser sur Paris Fashion Shop</span>
            </label>
          )}
          {ankorstoreAvailable && (
            <label className="flex items-center gap-2 text-sm font-body cursor-pointer">
              <input
                type="checkbox"
                checked={ankorsChecked}
                onChange={(e) => setAnkorsChecked(e.target.checked)}
                className="w-4 h-4"
              />
              <span>Re-pousser sur Ankorstore</span>
            </label>
          )}
          {noneAvailable && (
            <p className="text-xs text-text-muted font-body italic">
              Aucune marketplace n'est configurée. La modification a bien été enregistrée localement.
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-body text-text-secondary hover:text-text-primary rounded-lg"
          >
            Plus tard
          </button>
          {!noneAvailable && (
            <button
              type="button"
              onClick={launch}
              className="px-4 py-2 text-sm font-body bg-text-primary text-text-inverse rounded-lg hover:opacity-90"
            >
              Lancer la re-sync
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
