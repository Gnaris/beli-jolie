export interface MarketplaceIds {
  pfsProductId: string | null;
  ankorsProductId: string | null;
  efashionReferenceBase: string | null;
}

export interface MarketplaceSyncFlagPatch {
  pfsSyncRequired?: true;
  ankorsSyncRequired?: true;
  efashionSyncRequired?: true;
}

function hasId(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function computeMarketplaceSyncFlags(
  ids: MarketplaceIds,
): MarketplaceSyncFlagPatch {
  const patch: MarketplaceSyncFlagPatch = {};
  if (hasId(ids.pfsProductId)) patch.pfsSyncRequired = true;
  if (hasId(ids.ankorsProductId)) patch.ankorsSyncRequired = true;
  if (hasId(ids.efashionReferenceBase)) patch.efashionSyncRequired = true;
  return patch;
}
