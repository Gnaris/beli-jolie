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
  if (target === "faire") return item.faireOutcome;
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

// Fenêtre de grâce après une sync réussie pendant laquelle on cache le badge
// orange même si les props serveur disent encore syncRequired=true. Couvre le
// délai entre "op done" et l'aboutissement du router.refresh (~800 ms de debounce
// dans MarketplaceRefreshContext + aller-retour serveur). Au-delà, on refait
// confiance à syncRequired — si l'utilisatrice modifie le produit après coup,
// l'alerte orange réapparaît normalement.
const RECENT_SYNC_WINDOW_MS = 5_000;

export function computeMarketplaceBadgeState(
  serverProductId: string | null,
  op: MarketplaceRefreshItem | undefined,
  target: MarketplaceTarget,
  syncRequired: boolean = false,
  now: number = Date.now(),
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

  // Une opération réussie est considérée "récente" tant que router.refresh
  // n'a pas eu le temps de rapatrier l'état serveur (~800 ms de debounce +
  // aller-retour RSC). Au-delà de RECENT_SYNC_WINDOW_MS on refait confiance
  // au serverProductId — c'est indispensable pour que le badge tombe en
  // "non lié" après un délier : sinon l'ancienne op "publish done" continue
  // à forcer online=true et le badge reste vert alors que le produit est
  // délié.
  const isRecent =
    !!op.completedAt && now - Date.parse(op.completedAt) < RECENT_SYNC_WINDOW_MS;

  const justPublishedOk =
    op.mode === "publish" && op.status === "done" && outcome?.ok === true && isRecent;

  // Toute sync (publish/resync/refresh) réussie récemment doit masquer
  // l'orange le temps que router.refresh rapatrie syncRequired=false depuis le
  // serveur — évite le flash "Synchro nécessaire" entre la fin de l'op et le
  // rafraîchissement RSC.
  const completedRecentlyOk =
    op.status === "done" && outcome?.ok === true && isRecent;

  const online = !!serverProductId || justPublishedOk;

  return {
    loading,
    online,
    syncRequired:
      online && syncRequired && !loading && !justPublishedOk && !completedRecentlyOk,
    justPublishedOk,
  };
}
