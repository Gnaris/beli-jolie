"use client";

import { useCallback } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshEnqueueInput,
} from "@/components/admin/products/MarketplaceRefreshContext";
import {
  refreshProductOnMarketplaces,
  getRecentlyRefreshedProducts,
  type MarketplaceRefreshOptions,
} from "@/app/actions/admin/marketplace-refresh";
import { useRefreshWarning } from "@/components/admin/products/RecentlyRefreshedWarningModal";

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
  const { ask: askWarning } = useRefreshWarning();

  // Vérifie le garde-fou « refresh récent ». Retourne la liste finale à traiter,
  // ou `null` si l'utilisatrice a annulé.
  const applyRecentWarning = useCallback(
    async (products: RefreshableProduct[]): Promise<RefreshableProduct[] | null> => {
      const productIds = products.map((p) => p.productId);
      const check = await getRecentlyRefreshedProducts(productIds);
      if (!check.enabled || check.items.length === 0) {
        return products;
      }
      const choice = await askWarning({
        totalSelected: products.length,
        thresholdDays: check.thresholdDays,
        recentItems: check.items,
      });
      if (choice === "cancel") return null;
      if (choice === "force_all") return products;
      // skip_recent → on retire les produits récents
      const recentIds = new Set(check.items.map((i) => i.productId));
      return products.filter((p) => !recentIds.has(p.productId));
    },
    [askWarning],
  );

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
      const filtered = await applyRecentWarning([product]);
      if (filtered === null) return false;
      if (filtered.length === 0) {
        toast.info("Rien à rafraîchir", "Le produit a été ignoré (rafraîchi récemment).");
        return false;
      }
      const target = filtered[0]!;
      const options = await askOptions(1, target.productName);
      if (!options) return false;

      // If only local (no marketplace), run directly — it's instant
      if (options.local && !options.pfs && !options.ankorstore) {
        try {
          await refreshProductOnMarketplaces(target.productId, options);
          toast.success("Produit remis en Nouveauté");
        } catch (err) {
          toast.error("Échec", err instanceof Error ? err.message : String(err));
        }
        return true;
      }

      // Enqueue for background processing — 1 item per marketplace ciblée.
      // Each item carries ONLY its marketplace flag so the server endpoint
      // doesn't double-trigger the other marketplace through
      // `refreshProductOnMarketplaces` (which reads options.pfs AND
      // options.ankorstore). The `local` flag is attached to the first item
      // only so the lastRefreshedAt bump runs exactly once.
      const inputs: MarketplaceRefreshEnqueueInput[] = [];
      let localConsumed = false;
      if (options.pfs) {
        inputs.push({
          productId: target.productId,
          reference: target.reference,
          productName: target.productName,
          firstImage: target.firstImage ?? null,
          options: { local: options.local && !localConsumed, pfs: true, ankorstore: false },
          marketplace: "pfs",
        });
        localConsumed = options.local;
      }
      if (options.ankorstore) {
        inputs.push({
          productId: target.productId,
          reference: target.reference,
          productName: target.productName,
          firstImage: target.firstImage ?? null,
          options: { local: options.local && !localConsumed, pfs: false, ankorstore: true },
          marketplace: "ankorstore",
        });
      }
      enqueue(inputs);
      toast.info("Ajouté à la file", `${target.reference} sera rafraîchi en arrière-plan.`);
      return true;
    },
    [applyRecentWarning, askOptions, enqueue, toast],
  );

  const refreshBulk = useCallback(
    async (products: RefreshableProduct[]): Promise<boolean> => {
      if (products.length === 0) return false;
      if (products.length > 100) {
        toast.error("Trop de produits", "Vous ne pouvez rafraîchir que 100 produits à la fois.");
        return false;
      }
      const filtered = await applyRecentWarning(products);
      if (filtered === null) return false;
      if (filtered.length === 0) {
        toast.info("Rien à rafraîchir", "Tous les produits sélectionnés ont été rafraîchis récemment.");
        return false;
      }
      const options = await askOptions(filtered.length, filtered[0]?.productName);
      if (!options) return false;

      if (options.local && !options.pfs && !options.ankorstore) {
        // Run sequentially for local-only — quick operations
        try {
          for (const p of filtered) {
            await refreshProductOnMarketplaces(p.productId, options);
          }
          toast.success(`${filtered.length} produit${filtered.length > 1 ? "s" : ""} remis en Nouveauté`);
        } catch (err) {
          toast.error("Échec", err instanceof Error ? err.message : String(err));
        }
        return true;
      }

      // Each item carries ONLY its marketplace flag (see refreshSingle for the
      // reason). `local` is consumed by the first item of each product.
      const inputs: MarketplaceRefreshEnqueueInput[] = [];
      for (const p of filtered) {
        let localConsumed = false;
        if (options.pfs) {
          inputs.push({
            productId: p.productId,
            reference: p.reference,
            productName: p.productName,
            firstImage: p.firstImage ?? null,
            options: { local: options.local && !localConsumed, pfs: true, ankorstore: false },
            marketplace: "pfs",
          });
          localConsumed = options.local;
        }
        if (options.ankorstore) {
          inputs.push({
            productId: p.productId,
            reference: p.reference,
            productName: p.productName,
            firstImage: p.firstImage ?? null,
            options: { local: options.local && !localConsumed, pfs: false, ankorstore: true },
            marketplace: "ankorstore",
          });
        }
      }
      enqueue(inputs);
      toast.info(
        "Ajoutés à la file",
        `${filtered.length} produit${filtered.length > 1 ? "s" : ""} seront rafraîchis en arrière-plan.`,
      );
      return true;
    },
    [applyRecentWarning, askOptions, enqueue, toast],
  );

  return { refreshSingle, refreshBulk };
}
