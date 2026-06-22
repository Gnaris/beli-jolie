"use client";

import { useCallback } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshEnqueueInput,
} from "@/components/admin/products/MarketplaceRefreshContext";
import { useEfashionShootingBatch } from "@/components/admin/products/EfashionShootingBatchContext";
import {
  refreshProductOnMarketplaces,
  getRecentlyRefreshedProducts,
  type MarketplaceRefreshOptions,
} from "@/app/actions/admin/marketplace-refresh";
import { useRefreshWarning } from "@/components/admin/products/RecentlyRefreshedWarningModal";
import { useIneligibleRefresh } from "@/components/admin/products/IneligibleRefreshModal";
import {
  getRefreshIneligibilityReason,
  labelForIneligibility,
} from "@/lib/refresh-eligibility";

export interface RefreshableProduct {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  wasImported: boolean;
  /** Verrou manuel : si true, le produit est traité comme inéligible
   *  au rafraîchissement (priorité sur le statut). */
  locked?: boolean;
}

export interface UseRefreshMarketplaceDialogOptions {
  /** Affiche la case Paris Fashion Shop. Défaut true. */
  showPfs?: boolean;
  /** Affiche la case Ankorstore. Défaut false. */
  showAnkorstore?: boolean;
  /** Affiche la case eFashion Paris. Défaut false. */
  showEfashion?: boolean;
  /** Affiche la case Faire. Défaut false. */
  showFaire?: boolean;
}

export function useRefreshMarketplaceDialog(opts?: UseRefreshMarketplaceDialogOptions) {
  const showPfs = opts?.showPfs ?? true;
  const showAnkorstore = opts?.showAnkorstore ?? false;
  const showEfashion = opts?.showEfashion ?? false;
  const showFaire = opts?.showFaire ?? false;

  const { confirm } = useConfirm();
  const toast = useToast();
  const { enqueue, inFlightProductIds } = useMarketplaceRefreshQueue();
  const { addProduct: addToEfashionShootingBatch } = useEfashionShootingBatch();
  const { ask: askWarning } = useRefreshWarning();
  const { ask: askIneligible } = useIneligibleRefresh();

  // Sépare la sélection en éligibles / non éligibles selon le statut local
  // (ONLINE + complet). Vérifié en premier car instantané et déterministe.
  const splitByEligibility = useCallback(
    (products: RefreshableProduct[]) => {
      const eligible: RefreshableProduct[] = [];
      const ineligible: Array<RefreshableProduct & { reason: ReturnType<typeof getRefreshIneligibilityReason> }> = [];
      for (const p of products) {
        const reason = getRefreshIneligibilityReason({
          status: p.status,
          isIncomplete: p.isIncomplete,
          wasImported: p.wasImported,
          locked: p.locked,
        });
        if (reason) {
          ineligible.push({ ...p, reason });
        } else {
          eligible.push(p);
        }
      }
      return { eligible, ineligible };
    },
    [],
  );

  // Retire les produits déjà en cours de rafraîchissement (queued, in_progress
  // ou awaiting_callback dans la file marketplace). Retourne la liste filtrée
  // et le nombre ignoré pour le toast d'information.
  const filterOutInFlight = useCallback(
    (products: RefreshableProduct[]): { kept: RefreshableProduct[]; skipped: number } => {
      const kept: RefreshableProduct[] = [];
      let skipped = 0;
      for (const p of products) {
        if (inFlightProductIds.has(p.productId)) {
          skipped++;
        } else {
          kept.push(p);
        }
      }
      return { kept, skipped };
    },
    [inFlightProductIds],
  );

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
      const efashionRef = { current: false };
      const faireRef = { current: false };

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
      if (showEfashion) {
        checkboxes.push({
          id: "efashion",
          label: "Rafraîchir sur eFashion Paris (renvoie infos, photos, prix et stock)",
          defaultChecked: false,
          onChange: (v: boolean) => {
            efashionRef.current = v;
          },
        });
      }
      if (showFaire) {
        checkboxes.push({
          id: "faire",
          label: "Rafraîchir sur Faire (crée le nouveau, supprime l'ancien)",
          defaultChecked: false,
          onChange: (v: boolean) => {
            faireRef.current = v;
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
        efashion: efashionRef.current,
        faire: faireRef.current,
      };

      if (
        !options.local &&
        !options.pfs &&
        !options.ankorstore &&
        !options.efashion &&
        !options.faire
      ) {
        toast.error("Aucune option sélectionnée.");
        return null;
      }
      return options;
    },
    [confirm, toast, showPfs, showAnkorstore, showEfashion, showFaire],
  );

  const refreshSingle = useCallback(
    async (product: RefreshableProduct): Promise<boolean> => {
      // 1) Garde-fou statut : un seul produit non éligible → toast direct,
      // pas la peine d'ouvrir la modale.
      const { eligible, ineligible } = splitByEligibility([product]);
      if (eligible.length === 0) {
        const reason = ineligible[0]?.reason;
        toast.error(
          "Impossible de rafraîchir",
          reason
            ? `Ce produit est ${labelForIneligibility(reason).toLowerCase()}.`
            : "Ce produit n'est pas éligible au rafraîchissement.",
        );
        return false;
      }
      // 2) Bloque si le produit est déjà en cours de rafraîchissement.
      const inFlight = filterOutInFlight(eligible);
      if (inFlight.kept.length === 0) {
        toast.info(
          "Déjà en cours",
          "Ce produit est déjà en cours de rafraîchissement.",
        );
        return false;
      }
      // 3) Garde-fou « refresh récent » + dialog d'options + enqueue.
      const filtered = await applyRecentWarning(inFlight.kept);
      if (filtered === null) return false;
      if (filtered.length === 0) {
        toast.info("Rien à rafraîchir", "Le produit a été ignoré (rafraîchi récemment).");
        return false;
      }
      const target = filtered[0]!;
      const options = await askOptions(1, target.productName);
      if (!options) return false;

      // If only local (no marketplace), run directly — it's instant
      if (
        options.local &&
        !options.pfs &&
        !options.ankorstore &&
        !options.efashion &&
        !options.faire
      ) {
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
        localConsumed = options.local;
      }
      if (options.efashion) {
        // eFashion : un refresh crée une nouvelle fiche côté eFashion → 1
        // ticket de shooting. On ajoute dans la file shooting batch pour
        // regrouper avec d'autres demandes en un seul ticket.
        void addToEfashionShootingBatch(target.productId, "REFRESH");
        // Si options.local a été demandé et pas encore consommé par PFS ou
        // Ankorstore, on enqueue un job dédié "boutique seule" pour ne pas
        // perdre le bump local.
        if (options.local && !localConsumed) {
          inputs.push({
            productId: target.productId,
            reference: target.reference,
            productName: target.productName,
            firstImage: target.firstImage ?? null,
            options: { local: true, pfs: false, ankorstore: false, efashion: false },
            marketplace: "pfs",
          });
          localConsumed = true;
        }
      }
      if (options.faire) {
        inputs.push({
          productId: target.productId,
          reference: target.reference,
          productName: target.productName,
          firstImage: target.firstImage ?? null,
          options: {
            local: options.local && !localConsumed,
            pfs: false,
            ankorstore: false,
            efashion: false,
            faire: true,
          },
          marketplace: "faire",
        });
        localConsumed = options.local;
      }
      enqueue(inputs);
      if (options.efashion) {
        toast.info(
          "Ajouté au shooting eFashion",
          `${target.reference} attend votre validation manuelle dans la fenêtre eFashion en bas à droite.`,
        );
      } else {
        toast.info("Ajouté à la file", `${target.reference} sera rafraîchi en arrière-plan.`);
      }
      return true;
    },
    [applyRecentWarning, askOptions, enqueue, addToEfashionShootingBatch, toast, filterOutInFlight, splitByEligibility],
  );

  const refreshBulk = useCallback(
    async (products: RefreshableProduct[]): Promise<boolean> => {
      if (products.length === 0) return false;
      if (products.length > 100) {
        toast.error("Trop de produits", "Vous ne pouvez rafraîchir que 100 produits à la fois.");
        return false;
      }
      // 1) Garde-fou statut : ouvre la modale « non éligibles » si mix,
      // toast direct si tout est inéligible.
      const { eligible, ineligible } = splitByEligibility(products);
      if (eligible.length === 0) {
        toast.error(
          "Aucun produit éligible",
          `Les ${products.length} produits sélectionnés sont archivés, hors ligne, en brouillon ou en cours d'importation.`,
        );
        return false;
      }
      if (ineligible.length > 0) {
        const choice = await askIneligible({
          totalSelected: products.length,
          ineligibleItems: ineligible.map((p) => ({
            productId: p.productId,
            reference: p.reference,
            productName: p.productName,
            firstImage: p.firstImage ?? null,
            reason: p.reason!,
          })),
        });
        if (choice === "cancel") return false;
      }
      // 2) Retire les produits déjà en cours de rafraîchissement.
      const { kept: notInFlight, skipped: skippedInFlight } = filterOutInFlight(eligible);
      if (notInFlight.length === 0) {
        toast.info(
          "Déjà en cours",
          `Tous les produits sélectionnés (${skippedInFlight}) sont déjà en cours de rafraîchissement.`,
        );
        return false;
      }
      if (skippedInFlight > 0) {
        toast.info(
          "Produits ignorés",
          `${skippedInFlight} produit${skippedInFlight > 1 ? "s" : ""} déjà en cours de rafraîchissement — ${notInFlight.length} restant${notInFlight.length > 1 ? "s" : ""}.`,
        );
      }
      // 2) Garde-fou « refresh récent ».
      const filtered = await applyRecentWarning(notInFlight);
      if (filtered === null) return false;
      if (filtered.length === 0) {
        toast.info("Rien à rafraîchir", "Tous les produits sélectionnés ont été rafraîchis récemment.");
        return false;
      }
      const options = await askOptions(filtered.length, filtered[0]?.productName);
      if (!options) return false;

      if (
        options.local &&
        !options.pfs &&
        !options.ankorstore &&
        !options.efashion &&
        !options.faire
      ) {
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
          localConsumed = options.local;
        }
        if (options.efashion) {
          // Refresh = ticket de shooting → file batch (validation manuelle)
          void addToEfashionShootingBatch(p.productId, "REFRESH");
          if (options.local && !localConsumed) {
            inputs.push({
              productId: p.productId,
              reference: p.reference,
              productName: p.productName,
              firstImage: p.firstImage ?? null,
              options: { local: true, pfs: false, ankorstore: false, efashion: false },
              marketplace: "pfs",
            });
            localConsumed = true;
          }
        }
        if (options.faire) {
          inputs.push({
            productId: p.productId,
            reference: p.reference,
            productName: p.productName,
            firstImage: p.firstImage ?? null,
            options: {
              local: options.local && !localConsumed,
              pfs: false,
              ankorstore: false,
              efashion: false,
              faire: true,
            },
            marketplace: "faire",
          });
          localConsumed = options.local;
        }
      }
      enqueue(inputs);
      if (options.efashion) {
        toast.info(
          "Ajoutés au shooting eFashion",
          `${filtered.length} produit${filtered.length > 1 ? "s" : ""} attendent votre validation dans la fenêtre eFashion en bas à droite.`,
        );
      } else {
        toast.info(
          "Ajoutés à la file",
          `${filtered.length} produit${filtered.length > 1 ? "s" : ""} seront rafraîchis en arrière-plan.`,
        );
      }
      return true;
    },
    [applyRecentWarning, askOptions, enqueue, addToEfashionShootingBatch, toast, filterOutInFlight, splitByEligibility, askIneligible],
  );

  return { refreshSingle, refreshBulk };
}
