/**
 * Modèle du tiroir « Synchro marketplaces » — pur, sans React, testable.
 *
 * L'ancienne vue affichait 1 ligne par item (une par push d'une marketplace),
 * donc un même produit apparaissait en morceaux : PFS en « Terminés », Ankor
 * en « En cours », eFashion en « Erreurs ». La cliente voulait tout regrouper
 * — une carte par produit, avec 4 badges d'état (P/A/E/F) sur la même ligne.
 *
 * Ce module produit ce regroupement + calcule l'état affiché de chaque case
 * marketplace pour chaque produit.
 */

import {
  isItemActive,
  type MarketplaceRefreshItem,
  type MarketplaceTarget,
  type TargetOutcome,
} from "@/components/admin/products/MarketplaceRefreshContext";

export type CellKind = "not-targeted" | "queued" | "active" | "done" | "error";

export interface MarketplaceCell {
  kind: CellKind;
  outcome?: TargetOutcome;
  /** Item qui pilote l'état affiché (le plus récent des items ciblant cette marketplace). */
  driver?: MarketplaceRefreshItem;
}

export type GroupSection = "errors" | "active" | "scheduled" | "queued" | "done";

export interface ProductGroup {
  productId: string;
  productName: string;
  reference: string;
  firstImage: string | null;
  latestActivityAt: string | null;
  items: MarketplaceRefreshItem[];
  cells: Record<MarketplaceTarget, MarketplaceCell>;
  section: GroupSection;
  /** Plus proche date de départ planifié (ISO), si le produit est en attente
   *  dans un lot étalé. `null` si aucun scheduledFor futur. */
  earliestScheduledFor: string | null;
}

export const MARKETPLACE_ORDER: MarketplaceTarget[] = [
  "pfs",
  "ankorstore",
  "efashion",
  "faire",
];

const OUTCOME_KEY: Record<MarketplaceTarget, keyof MarketplaceRefreshItem> = {
  pfs: "pfsOutcome",
  ankorstore: "ankorsOutcome",
  efashion: "efashionOutcome",
  faire: "faireOutcome",
};

function outcomeFor(
  item: MarketplaceRefreshItem,
  target: MarketplaceTarget,
): TargetOutcome | undefined {
  return item[OUTCOME_KEY[target]] as TargetOutcome | undefined;
}

/**
 * Récence : timestamp de complétion (ou 0 si en cours). Les items actifs
 * l'emportent toujours sur les items terminés du même produit / marketplace,
 * car ils représentent le dernier retry en vol.
 */
function itemRecency(item: MarketplaceRefreshItem): number {
  if (isItemActive(item)) return Number.POSITIVE_INFINITY;
  if (item.completedAt) {
    const t = Date.parse(item.completedAt);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function cellForMarketplace(
  productItems: MarketplaceRefreshItem[],
  target: MarketplaceTarget,
): MarketplaceCell {
  // Item qui cible directement cette marketplace ou dont l'outcome existe pour elle
  const candidates = productItems.filter(
    (it) => it.marketplace === target || outcomeFor(it, target) !== undefined,
  );
  if (candidates.length === 0) return { kind: "not-targeted" };

  const driver = candidates.reduce((best, cur) =>
    itemRecency(cur) >= itemRecency(best) ? cur : best,
  );

  const outcome = outcomeFor(driver, target);

  if (isItemActive(driver)) {
    if (driver.status === "queued") return { kind: "queued", driver };
    return { kind: "active", driver };
  }
  if (outcome && outcome.ok === false) return { kind: "error", outcome, driver };
  if (outcome && outcome.ok === true) return { kind: "done", outcome, driver };
  // Item terminé sans outcome connu pour cette marketplace : considéré "done".
  if (driver.status === "done") return { kind: "done", driver };
  return { kind: "queued", driver };
}

/**
 * Regroupe une file d'items en cartes par produit et calcule l'état de chaque
 * case marketplace + la section d'appartenance globale du produit.
 *
 * Priorité de section (du plus urgent au plus calme) :
 *   errors    : au moins une marketplace en erreur
 *   active    : au moins une marketplace en cours (in_progress / awaiting_callback)
 *   scheduled : uniquement queued, avec au moins un scheduledFor futur (lot étalé)
 *   queued    : uniquement queued, tous prêts à partir (lot immédiat)
 *   done      : sinon (tout ok)
 */
export function groupItemsByProduct(
  items: ReadonlyArray<MarketplaceRefreshItem>,
  now: number = Date.now(),
): ProductGroup[] {
  const byProduct = new Map<string, MarketplaceRefreshItem[]>();
  const order: string[] = [];
  for (const item of items) {
    const bucket = byProduct.get(item.productId);
    if (bucket) bucket.push(item);
    else {
      byProduct.set(item.productId, [item]);
      order.push(item.productId);
    }
  }

  return order.map((pid) => {
    const productItems = byProduct.get(pid) ?? [];

    // Meta produit — on prend la version la plus récente (dernier item ayant l'info).
    let productName = "";
    let reference = "";
    let firstImage: string | null = null;
    let latestCompletedAt: string | null = null;
    for (const it of productItems) {
      if (it.productName) productName = it.productName;
      if (it.reference) reference = it.reference;
      if (it.firstImage) firstImage = it.firstImage;
      if (it.completedAt) {
        if (!latestCompletedAt || it.completedAt > latestCompletedAt) {
          latestCompletedAt = it.completedAt;
        }
      }
    }

    const cells: Record<MarketplaceTarget, MarketplaceCell> = {
      pfs: cellForMarketplace(productItems, "pfs"),
      ankorstore: cellForMarketplace(productItems, "ankorstore"),
      efashion: cellForMarketplace(productItems, "efashion"),
      faire: cellForMarketplace(productItems, "faire"),
    };

    // Plus proche scheduledFor futur parmi les items encore queued : sert à
    // reconnaître un lot étalé et à afficher le compte à rebours.
    let earliestScheduledFor: string | null = null;
    for (const it of productItems) {
      if (it.status !== "queued" || !it.scheduledFor) continue;
      const t = Date.parse(it.scheduledFor);
      if (!Number.isFinite(t) || t <= now) continue;
      if (!earliestScheduledFor || it.scheduledFor < earliestScheduledFor) {
        earliestScheduledFor = it.scheduledFor;
      }
    }

    let section: GroupSection = "done";
    const kinds = MARKETPLACE_ORDER.map((m) => cells[m].kind);
    if (kinds.includes("error")) section = "errors";
    else if (kinds.includes("active")) section = "active";
    else if (kinds.includes("queued")) {
      section = earliestScheduledFor ? "scheduled" : "queued";
    }

    return {
      productId: pid,
      productName: productName || reference,
      reference,
      firstImage,
      latestActivityAt: latestCompletedAt,
      items: productItems,
      cells,
      section,
      earliestScheduledFor,
    };
  });
}

// ────────────────────────────────────────────────────────────────
// Libellés + copie pour le tooltip
// ────────────────────────────────────────────────────────────────

export const MARKETPLACE_LABEL: Record<MarketplaceTarget, string> = {
  pfs: "PFS",
  ankorstore: "Ankor",
  efashion: "eFashion",
  faire: "Faire",
};

export const MARKETPLACE_FULL_NAME: Record<MarketplaceTarget, string> = {
  pfs: "PFS",
  ankorstore: "Ankorstore",
  efashion: "eFashion",
  faire: "Faire",
};

export function cellTooltipTitle(
  target: MarketplaceTarget,
  cell: MarketplaceCell,
): string | undefined {
  if (cell.kind !== "error") return undefined;
  const mode = cell.driver?.mode;
  const kind = cell.outcome && cell.outcome.ok === false ? cell.outcome.kind : "error";
  if (kind === "not_found") {
    return `${MARKETPLACE_FULL_NAME[target]} — Produit introuvable`;
  }
  const suffix =
    mode === "publish"
      ? "Publication échouée"
      : mode === "resync"
      ? "Resynchronisation échouée"
      : "Refresh échoué";
  return `${MARKETPLACE_FULL_NAME[target]} — ${suffix}`;
}

export function cellTooltipBody(cell: MarketplaceCell): string {
  switch (cell.kind) {
    case "not-targeted":
      return "Non ciblé pour ce produit";
    case "queued":
      return "En attente de traitement";
    case "active":
      return cell.driver?.status === "awaiting_callback"
        ? "En attente de la réponse marketplace…"
        : "Envoi en cours…";
    case "done":
      return "Terminé avec succès";
    case "error":
      return cell.outcome && cell.outcome.ok === false
        ? cell.outcome.message
        : "Erreur inconnue";
  }
}

/**
 * Texte à copier au clic sur le bouton « Copier le message » du tooltip.
 * Uniquement pour les erreurs — retourne undefined sinon.
 */
export function cellCopyable(cell: MarketplaceCell): string | undefined {
  if (cell.kind !== "error") return undefined;
  return cell.outcome && cell.outcome.ok === false ? cell.outcome.message : undefined;
}
