import {
  hasError,
  type MarketplaceRefreshItem,
  type MarketplaceTarget,
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
  if (item.marketplace === "efashion") return item.efashionOutcome;
  return item.faireOutcome;
}

export function getLocalOutcomeForGroup(
  group: ProductGroup,
): TargetOutcome | undefined {
  for (const item of group.items) {
    if (item.options.local && item.localOutcome) return item.localOutcome;
  }
  return undefined;
}

/**
 * Retourne la date de départ planifiée d'un groupe (la plus proche parmi les
 * items encore en QUEUED), ou null si aucun item planifié / si tous sont déjà
 * partis.
 */
export function getGroupScheduledFor(group: ProductGroup): Date | null {
  let earliest: Date | null = null;
  for (const item of group.items) {
    if (item.status !== "queued") continue;
    if (!item.scheduledFor) continue;
    const d = new Date(item.scheduledFor);
    if (!earliest || d < earliest) earliest = d;
  }
  return earliest;
}

/**
 * True si le groupe est en attente d'une heure de départ future (au moins un
 * item queued avec scheduledFor > now).
 */
export function groupIsScheduled(group: ProductGroup, now: Date = new Date()): boolean {
  const s = getGroupScheduledFor(group);
  return s !== null && s > now;
}

/**
 * Retourne la liste des échecs marketplace du groupe, triés dans l'ordre
 * pfs → ankorstore → efashion → faire. Utilisé par le tooltip d'erreur au
 * survol d'une ligne produit dans le widget de synchro.
 */
export interface GroupError {
  marketplace: MarketplaceTarget;
  message: string;
}
const MARKETPLACE_ERROR_ORDER: Record<MarketplaceTarget, number> = {
  pfs: 0,
  ankorstore: 1,
  efashion: 2,
  faire: 3,
  orderchamp: 4,
  microstore: 5,
};
export function getGroupErrors(group: ProductGroup): GroupError[] {
  const sorted = [...group.items].sort(
    (a, b) => MARKETPLACE_ERROR_ORDER[a.marketplace] - MARKETPLACE_ERROR_ORDER[b.marketplace],
  );
  const errors: GroupError[] = [];
  for (const item of sorted) {
    const outcome = getMarketplaceOutcome(item);
    if (outcome && !outcome.ok) {
      errors.push({
        marketplace: item.marketplace,
        message: outcome.message || "Erreur non renseignée",
      });
    }
  }
  return errors;
}
