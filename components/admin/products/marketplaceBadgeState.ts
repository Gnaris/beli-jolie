import type {
  MarketplaceRefreshItem,
  MarketplaceTarget,
  TargetOutcome,
} from "./MarketplaceRefreshContext";

export interface MarketplaceBadgeState {
  loading: boolean;
  online: boolean;
  /**
   * True : produit lié au marketplace ET un changement local n'a pas été
   * propagé. Affiché par un badge orange « Synchronisation nécessaire ».
   * Priorité d'affichage : loading > syncRequired > online > offline.
   */
  syncRequired: boolean;
  justPublishedOk: boolean;
}

function outcomeForTarget(
  item: MarketplaceRefreshItem,
  target: MarketplaceTarget,
): TargetOutcome | undefined {
  if (target === "ankorstore") return item.ankorsOutcome;
  if (target === "efashion") return item.efashionOutcome;
  return item.pfsOutcome;
}

export function findLatestOpForProduct(
  items: ReadonlyArray<MarketplaceRefreshItem>,
  productId: string,
  target: MarketplaceTarget,
): MarketplaceRefreshItem | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.productId === productId && it.marketplace === target) return it;
  }
  return undefined;
}

export function computeMarketplaceBadgeState(
  serverProductId: string | null,
  op: MarketplaceRefreshItem | undefined,
  target: MarketplaceTarget,
  syncRequired: boolean = false,
): MarketplaceBadgeState {
  if (!op) {
    const online = !!serverProductId;
    return {
      loading: false,
      online,
      // syncRequired n'a de sens que si on est effectivement lié au marketplace
      syncRequired: online && syncRequired,
      justPublishedOk: false,
    };
  }

  const loading =
    op.status === "queued" ||
    op.status === "in_progress" ||
    op.status === "awaiting_callback";

  const outcome = outcomeForTarget(op, target);
  const justPublishedOk =
    op.mode === "publish" && op.status === "done" && outcome?.ok === true;

  const online = !!serverProductId || justPublishedOk;

  return {
    loading,
    online,
    // Pendant qu'un op tourne ou vient de finir OK, on ne montre pas l'alerte
    // orange — soit la sync est en cours, soit elle vient d'aboutir.
    syncRequired: online && syncRequired && !loading && !justPublishedOk,
    justPublishedOk,
  };
}
