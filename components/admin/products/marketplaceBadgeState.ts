import type {
  MarketplaceRefreshItem,
  MarketplaceTarget,
  TargetOutcome,
} from "./MarketplaceRefreshContext";

export interface MarketplaceBadgeState {
  loading: boolean;
  online: boolean;
  justPublishedOk: boolean;
}

function outcomeForTarget(
  item: MarketplaceRefreshItem,
  target: MarketplaceTarget,
): TargetOutcome | undefined {
  return target === "ankorstore" ? item.ankorsOutcome : item.pfsOutcome;
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
): MarketplaceBadgeState {
  if (!op) {
    return {
      loading: false,
      online: !!serverProductId,
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

  return {
    loading,
    online: !!serverProductId || justPublishedOk,
    justPublishedOk,
  };
}
