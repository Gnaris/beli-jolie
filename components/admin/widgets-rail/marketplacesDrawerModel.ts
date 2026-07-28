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
  type QueueItemMode,
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
  /** Mode dominant du produit : le mode de l'item le plus récent (actif > terminé).
   *  Sert au regroupement de haut niveau dans le tiroir (Modifications /
   *  Rafraîchissements / Synchronisations). */
  dominantMode: QueueItemMode;
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
  return buildGroups(items, now, (item) => item.productId);
}

/**
 * Variante utilisée par le tiroir marketplaces pour la vue en catégories :
 * un produit qui a subi plusieurs actions (par ex. une modification puis un
 * rafraîchissement) donne lieu à autant de cartes distinctes. Ainsi les
 * erreurs d'une action ne se retrouvent jamais mélangées avec celles d'une
 * autre — chaque carte n'expose que les cellules pilotées par des items du
 * même mode.
 */
export function groupItemsByProductAndMode(
  items: ReadonlyArray<MarketplaceRefreshItem>,
  now: number = Date.now(),
): ProductGroup[] {
  return buildGroups(items, now, (item) => `${item.productId}::${item.mode}`);
}

function buildGroups(
  items: ReadonlyArray<MarketplaceRefreshItem>,
  now: number,
  keyOf: (item: MarketplaceRefreshItem) => string,
): ProductGroup[] {
  const byKey = new Map<string, MarketplaceRefreshItem[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(item);
    else {
      byKey.set(key, [item]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const productItems = byKey.get(key) ?? [];
    const pid = productItems[0]?.productId ?? key;

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

    // Mode dominant : l'item actif l'emporte sur les items terminés, sinon
    // on prend le dernier complété. Fallback : le premier item du produit.
    const dominantMode = pickDominantMode(productItems);

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
      dominantMode,
    };
  });
}

function pickDominantMode(items: MarketplaceRefreshItem[]): QueueItemMode {
  if (items.length === 0) return "refresh";
  const active = items.filter(isItemActive);
  const pool = active.length > 0 ? active : items;
  const chosen = pool.reduce((best, cur) =>
    itemRecency(cur) >= itemRecency(best) ? cur : best,
  );
  return chosen.mode;
}

// ────────────────────────────────────────────────────────────────
// Libellés + copie pour le tooltip
// ────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────
// Regroupement de haut niveau par mode (Modifications / Rafraîchissements /
// Synchronisations). Rendu sous forme de sections repliables dans le tiroir,
// pour permettre un « Arrêter » ciblé sur un seul type d'action.
// ────────────────────────────────────────────────────────────────

export const MODE_ORDER: QueueItemMode[] = ["publish", "refresh", "resync"];

export const MODE_LABEL: Record<QueueItemMode, { title: string; short: string }> = {
  publish: { title: "Modifications", short: "modification" },
  refresh: { title: "Rafraîchissements", short: "rafraîchissement" },
  resync: { title: "Synchronisations", short: "synchronisation" },
};

export interface ModeBucket {
  mode: QueueItemMode;
  groups: ProductGroup[];
  /** Nombre d'items queued (arrêtables via le bouton « Arrêter les suivants »). */
  queuedItemCount: number;
  /** Nombre de produits avec au moins une marketplace active/queued/scheduled. */
  activeGroupCount: number;
  /** Nombre de produits avec au moins une erreur. */
  errorGroupCount: number;
}

export function bucketGroupsByMode(groups: ProductGroup[]): ModeBucket[] {
  const byMode = new Map<QueueItemMode, ProductGroup[]>();
  for (const g of groups) {
    const bucket = byMode.get(g.dominantMode);
    if (bucket) bucket.push(g);
    else byMode.set(g.dominantMode, [g]);
  }
  return MODE_ORDER.filter((m) => byMode.has(m)).map((mode) => {
    const modeGroups = byMode.get(mode) ?? [];
    let queuedItemCount = 0;
    let activeGroupCount = 0;
    let errorGroupCount = 0;
    for (const g of modeGroups) {
      for (const it of g.items) {
        if (it.status === "queued") queuedItemCount += 1;
      }
      if (g.section === "errors") errorGroupCount += 1;
      if (g.section === "active" || g.section === "queued" || g.section === "scheduled") {
        activeGroupCount += 1;
      }
    }
    return { mode, groups: modeGroups, queuedItemCount, activeGroupCount, errorGroupCount };
  });
}

export const MARKETPLACE_LABEL: Record<MarketplaceTarget, string> = {
  pfs: "PFS",
  ankorstore: "Ankor",
  efashion: "eFashion",
  faire: "Faire",
};

// ────────────────────────────────────────────────────────────────
// Regroupement en colonnes par type d'action (refonte 2026-07-28).
// Le tiroir affiche désormais 4 colonnes côte à côte : Modifications,
// Rafraîchissements, Synchronisations, Liaisons. La colonne « Liaisons »
// ne vient PAS des MarketplaceRefreshItem — elle vient des LinkJob du
// contexte MarketplaceLinkContext. On modélise ça avec une clef commune.
// ────────────────────────────────────────────────────────────────

export type ColumnKey = "publish" | "refresh" | "resync" | "link";

export const COLUMN_ORDER: ColumnKey[] = ["publish", "refresh", "resync", "link"];

export const COLUMN_LABEL: Record<ColumnKey, { title: string; subtitle: string; short: string }> = {
  publish: {
    title: "Modifications",
    subtitle: "Fiche modifiée → renvoi",
    short: "modification",
  },
  refresh: {
    title: "Rafraîchissements",
    subtitle: "Bouton ↻ · lot étalé possible",
    short: "rafraîchissement",
  },
  resync: {
    title: "Synchronisations",
    subtitle: "Resync forcé (écrase l'état)",
    short: "synchronisation",
  },
  link: {
    title: "Liaisons",
    subtitle: "Modale manuelle · variantes",
    short: "liaison",
  },
};

/**
 * Résumé d'un LinkJob présenté comme une carte de colonne « Liaisons ».
 * On garde une forme structurellement compatible avec ce que le drawer sait
 * afficher (image / titre / réf) + les champs spécifiques liaison.
 */
export interface LinkJobLike {
  id: string;
  marketplace: MarketplaceTarget;
  productId: string;
  productName: string;
  reference: string;
  productImage: string | null;
  status: "in_progress" | "done" | "error";
  error?: string;
  linkedCount?: number;
  createdCount?: number;
  deletedCount?: number;
  importedCount?: number;
  startedAt: number;
  doneAt?: number;
}

export interface ColumnKpi {
  errors: number;
  active: number;
  queued: number;
  done: number;
}

export interface ColumnBucket {
  key: ColumnKey;
  groups: ProductGroup[];
  linkJobs: LinkJobLike[];
  kpi: ColumnKpi;
  /** Compte d'items queued arrêtables (colonnes refresh/publish/resync). Toujours 0 pour link. */
  queuedItemCount: number;
  /** Vrai s'il y a au moins un scheduledFor futur — utilisé pour afficher le
   *  bandeau « Prochain départ » (uniquement pertinent pour la colonne refresh). */
  hasScheduled: boolean;
}

/**
 * Range items (refresh/publish/resync) + linkJobs dans 4 colonnes.
 * Chaque colonne calcule ses KPI (err/active/queued/done) sur son propre contenu.
 * Retourne exactement 4 buckets, dans `COLUMN_ORDER`.
 */
export function bucketColumns(
  groups: ProductGroup[],
  linkJobs: ReadonlyArray<LinkJobLike>,
): ColumnBucket[] {
  const byMode = new Map<QueueItemMode, ProductGroup[]>();
  for (const g of groups) {
    const arr = byMode.get(g.dominantMode);
    if (arr) arr.push(g);
    else byMode.set(g.dominantMode, [g]);
  }

  return COLUMN_ORDER.map<ColumnBucket>((key) => {
    if (key === "link") {
      const linkArr = [...linkJobs];
      let errors = 0;
      let active = 0;
      let done = 0;
      for (const j of linkArr) {
        if (j.status === "error") errors += 1;
        else if (j.status === "in_progress") active += 1;
        else if (j.status === "done") done += 1;
      }
      return {
        key,
        groups: [],
        linkJobs: linkArr,
        kpi: { errors, active, queued: 0, done },
        queuedItemCount: 0,
        hasScheduled: false,
      };
    }

    const modeGroups = byMode.get(key) ?? [];
    let errors = 0;
    let active = 0;
    let queued = 0;
    let done = 0;
    let queuedItemCount = 0;
    let hasScheduled = false;
    for (const g of modeGroups) {
      if (g.section === "errors") errors += 1;
      else if (g.section === "active") active += 1;
      else if (g.section === "scheduled" || g.section === "queued") queued += 1;
      else if (g.section === "done") done += 1;
      if (g.earliestScheduledFor) hasScheduled = true;
      for (const it of g.items) if (it.status === "queued") queuedItemCount += 1;
    }
    return {
      key,
      groups: modeGroups,
      linkJobs: [],
      kpi: { errors, active, queued, done },
      queuedItemCount,
      hasScheduled,
    };
  });
}

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
