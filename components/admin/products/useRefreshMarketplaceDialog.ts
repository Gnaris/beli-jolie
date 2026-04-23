"use client";

import { useCallback } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  usePfsRefreshQueue,
  type PfsRefreshEnqueueInput,
} from "@/components/admin/products/PfsRefreshContext";
import { refreshProductOnMarketplaces, type MarketplaceRefreshOptions } from "@/app/actions/admin/marketplace-refresh";

export interface RefreshableProduct {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
}

export function useRefreshMarketplaceDialog() {
  const { confirm } = useConfirm();
  const toast = useToast();
  const { enqueue } = usePfsRefreshQueue();

  const askOptions = useCallback(
    async (count: number, firstProductName?: string): Promise<MarketplaceRefreshOptions | null> => {
      const localRef = { current: true };
      const pfsRef = { current: false };
      const ankorstoreRef = { current: false };

      const title = count === 1 ? "Rafraîchir ce produit ?" : `Rafraîchir ${count} produits ?`;
      const message =
        count === 1 && firstProductName
          ? `Choisissez où rafraîchir « ${firstProductName} » :`
          : count === 1
            ? "Choisissez où rafraîchir le produit :"
            : "Les options s'appliquent à tous les produits cochés.";

      const ok = await confirm({
        type: "warning",
        title,
        message,
        checkboxesLabel: "Options",
        checkboxes: [
          {
            id: "local",
            label: "Remettre en Nouveauté sur la boutique",
            defaultChecked: true,
            onChange: (v) => {
              localRef.current = v;
            },
          },
          {
            id: "pfs",
            label: "Rafraîchir sur Paris Fashion Shop (crée le nouveau, supprime l'ancien)",
            defaultChecked: false,
            onChange: (v) => {
              pfsRef.current = v;
            },
          },
          {
            id: "ankorstore",
            label: "Rafraîchir sur Ankorstore (envoi en aveugle — à vérifier sur leur dashboard)",
            defaultChecked: false,
            onChange: (v) => {
              ankorstoreRef.current = v;
            },
          },
        ],
        confirmLabel: "Rafraîchir",
      });
      if (!ok) return null;

      const options: MarketplaceRefreshOptions = {
        local: localRef.current,
        pfs: pfsRef.current,
        ankorstore: ankorstoreRef.current,
      };

      if (!options.local && !options.pfs && !options.ankorstore) {
        toast.error("Aucune option sélectionnée.");
        return null;
      }
      return options;
    },
    [confirm, toast],
  );

  const refreshSingle = useCallback(
    async (product: RefreshableProduct): Promise<boolean> => {
      const options = await askOptions(1, product.productName);
      if (!options) return false;

      // If only local (no PFS/Ankorstore), run directly — it's instant
      if (options.local && !options.pfs && !options.ankorstore) {
        try {
          await refreshProductOnMarketplaces(product.productId, options);
          toast.success("Produit remis en Nouveauté");
        } catch (err) {
          toast.error("Échec", err instanceof Error ? err.message : String(err));
        }
        return true;
      }

      // Enqueue for background processing
      const input: PfsRefreshEnqueueInput = {
        productId: product.productId,
        reference: product.reference,
        productName: product.productName,
        firstImage: product.firstImage ?? null,
        options,
      };
      enqueue([input]);
      toast.info("Ajouté à la file", `${product.reference} sera rafraîchi en arrière-plan.`);
      return true;
    },
    [askOptions, enqueue, toast],
  );

  const refreshBulk = useCallback(
    async (products: RefreshableProduct[]): Promise<boolean> => {
      if (products.length === 0) return false;
      const options = await askOptions(products.length, products[0]?.productName);
      if (!options) return false;

      if (options.local && !options.pfs && !options.ankorstore) {
        // Run sequentially for local-only — quick operations
        try {
          for (const p of products) {
            await refreshProductOnMarketplaces(p.productId, options);
          }
          toast.success(`${products.length} produit${products.length > 1 ? "s" : ""} remis en Nouveauté`);
        } catch (err) {
          toast.error("Échec", err instanceof Error ? err.message : String(err));
        }
        return true;
      }

      const inputs: PfsRefreshEnqueueInput[] = products.map((p) => ({
        productId: p.productId,
        reference: p.reference,
        productName: p.productName,
        firstImage: p.firstImage ?? null,
        options,
      }));
      enqueue(inputs);
      toast.info(
        "Ajoutés à la file",
        `${products.length} produit${products.length > 1 ? "s" : ""} seront rafraîchis en arrière-plan.`,
      );
      return true;
    },
    [askOptions, enqueue, toast],
  );

  return { refreshSingle, refreshBulk };
}
