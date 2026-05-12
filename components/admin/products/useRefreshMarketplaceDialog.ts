"use client";

import { useCallback } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshEnqueueInput,
} from "@/components/admin/products/MarketplaceRefreshContext";
import { refreshProductOnMarketplaces, type MarketplaceRefreshOptions } from "@/app/actions/admin/marketplace-refresh";

export interface RefreshableProduct {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
}

export interface UseRefreshMarketplaceDialogOptions {
  /** Affiche la case Paris Fashion Shop. Défaut true. */
  showPfs?: boolean;
  /** Affiche la case Ankorstore. Défaut false. */
  showAnkorstore?: boolean;
}

export function useRefreshMarketplaceDialog(opts?: UseRefreshMarketplaceDialogOptions) {
  const showPfs = opts?.showPfs ?? true;
  const showAnkorstore = opts?.showAnkorstore ?? false;

  const { confirm } = useConfirm();
  const toast = useToast();
  const { enqueue } = useMarketplaceRefreshQueue();

  const askOptions = useCallback(
    async (count: number, firstProductName?: string): Promise<MarketplaceRefreshOptions | null> => {
      const localRef = { current: false };
      const pfsRef = { current: false };
      const ankorstoreRef = { current: false };

      const title = count === 1 ? "Rafraîchir ce produit ?" : `Rafraîchir ${count} produits ?`;
      const message =
        count === 1 && firstProductName
          ? `Choisissez où rafraîchir « ${firstProductName} » :`
          : count === 1
            ? "Choisissez où rafraîchir le produit :"
            : "Les options s'appliquent à tous les produits cochés.";

      const checkboxes = [
        {
          id: "local",
          label: "Remettre en Nouveauté sur la boutique",
          defaultChecked: false,
          onChange: (v: boolean) => {
            localRef.current = v;
          },
        },
      ];
      if (showPfs) {
        checkboxes.push({
          id: "pfs",
          label: "Rafraîchir sur Paris Fashion Shop (crée le nouveau, supprime l'ancien)",
          defaultChecked: false,
          onChange: (v: boolean) => {
            pfsRef.current = v;
          },
        });
      }
      if (showAnkorstore) {
        checkboxes.push({
          id: "ankorstore",
          label: "Rafraîchir sur Ankorstore (crée le nouveau, archive l'ancien)",
          defaultChecked: false,
          onChange: (v: boolean) => {
            ankorstoreRef.current = v;
          },
        });
      }

      const ok = await confirm({
        type: "warning",
        title,
        message,
        checkboxesLabel: "Options",
        checkboxes,
        requireAtLeastOneChecked: true,
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
    [confirm, toast, showPfs, showAnkorstore],
  );

  const refreshSingle = useCallback(
    async (product: RefreshableProduct): Promise<boolean> => {
      const options = await askOptions(1, product.productName);
      if (!options) return false;

      // If only local (no marketplace), run directly — it's instant
      if (options.local && !options.pfs && !options.ankorstore) {
        try {
          await refreshProductOnMarketplaces(product.productId, options);
          toast.success("Produit remis en Nouveauté");
        } catch (err) {
          toast.error("Échec", err instanceof Error ? err.message : String(err));
        }
        return true;
      }

      // Enqueue for background processing — 1 item per marketplace ciblée
      const inputs: MarketplaceRefreshEnqueueInput[] = [];
      if (options.pfs) {
        inputs.push({
          productId: product.productId,
          reference: product.reference,
          productName: product.productName,
          firstImage: product.firstImage ?? null,
          options,
          marketplace: "pfs",
        });
      }
      if (options.ankorstore) {
        inputs.push({
          productId: product.productId,
          reference: product.reference,
          productName: product.productName,
          firstImage: product.firstImage ?? null,
          options,
          marketplace: "ankorstore",
        });
      }
      enqueue(inputs);
      toast.info("Ajouté à la file", `${product.reference} sera rafraîchi en arrière-plan.`);
      return true;
    },
    [askOptions, enqueue, toast],
  );

  const refreshBulk = useCallback(
    async (products: RefreshableProduct[]): Promise<boolean> => {
      if (products.length === 0) return false;
      if (products.length > 100) {
        toast.error("Trop de produits", "Vous ne pouvez rafraîchir que 100 produits à la fois.");
        return false;
      }
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

      const inputs: MarketplaceRefreshEnqueueInput[] = [];
      for (const p of products) {
        if (options.pfs) {
          inputs.push({
            productId: p.productId,
            reference: p.reference,
            productName: p.productName,
            firstImage: p.firstImage ?? null,
            options,
            marketplace: "pfs",
          });
        }
        if (options.ankorstore) {
          inputs.push({
            productId: p.productId,
            reference: p.reference,
            productName: p.productName,
            firstImage: p.firstImage ?? null,
            options,
            marketplace: "ankorstore",
          });
        }
      }
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
