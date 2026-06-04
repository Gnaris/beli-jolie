import {
  hasError,
  type MarketplaceRefreshItem,
  type QueueItemStatus,
  type TargetOutcome,
} from "@/components/admin/products/MarketplaceRefreshContext";

export interface ProductGroup {
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  items: MarketplaceRefreshItem[];
}

export type StatusFilter = "all" | "in_progress" | "success" | "error";

const STATUS_PRIORITY: Record<QueueItemStatus, number> = {
  in_progress: 0,
  awaiting_callback: 1,
  queued: 2,
  done: 3,
};

export function groupItemsByProduct(items: MarketplaceRefreshItem[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>();
  for (const item of items) {
    const existing = map.get(item.productId);
    if (existing) {
      existing.items.push(item);
      if (!existing.firstImage && item.firstImage) existing.firstImage = item.firstImage;
    } else {
      map.set(item.productId, {
        productId: item.productId,
        reference: item.reference,
        productName: item.productName,
        firstImage: item.firstImage,
        items: [item],
      });
    }
  }
  return Array.from(map.values());
}

export function groupHasActive(group: ProductGroup): boolean {
  return group.items.some(
    (it) => it.status === "in_progress" || it.status === "awaiting_callback",
  );
}

export function groupHasError(group: ProductGroup): boolean {
  return group.items.some(hasError);
}

export function groupAllDone(group: ProductGroup): boolean {
  return group.items.every((it) => it.status === "done");
}

export function groupPriority(group: ProductGroup): number {
  const minStatus = group.items.reduce(
    (acc, it) => Math.min(acc, STATUS_PRIORITY[it.status]),
    STATUS_PRIORITY.done,
  );
  if (minStatus === STATUS_PRIORITY.done) {
    return groupHasError(group) ? minStatus - 0.5 : minStatus;
  }
  return minStatus;
}

export function sortGroups(groups: ProductGroup[]): ProductGroup[] {
  return [...groups].sort((a, b) => groupPriority(a) - groupPriority(b));
}

export function groupMatchesFilter(group: ProductGroup, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "in_progress") {
    return group.items.some(
      (it) =>
        it.status === "in_progress" ||
        it.status === "awaiting_callback" ||
        it.status === "queued",
    );
  }
  if (filter === "error") {
    return groupHasError(group);
  }
  return groupAllDone(group) && !groupHasError(group);
}

export function getMarketplaceOutcome(
  item: MarketplaceRefreshItem,
): TargetOutcome | undefined {
  if (item.marketplace === "pfs") return item.pfsOutcome;
  if (item.marketplace === "ankorstore") return item.ankorsOutcome;
  return item.efashionOutcome;
}

export function getLocalOutcomeForGroup(
  group: ProductGroup,
): TargetOutcome | undefined {
  for (const item of group.items) {
    if (item.options.local && item.localOutcome) return item.localOutcome;
  }
  return undefined;
}
