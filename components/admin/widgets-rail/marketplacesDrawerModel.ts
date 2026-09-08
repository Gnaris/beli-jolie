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
  /** Colonne dominante du produit — même logique que `dominantMode` mais avec
   *  application du split intent="create" → colonne « publication ». */
  dominantColumn: ColumnKey;
}

export const MARKETPLACE_ORDER: MarketplaceTarget[] = [
  "pfs",
  "ankorstore",
  "efashion",
  "faire",
  "orderchamp",
  "microstore",
];

const OUTCOME_KEY: Record<MarketplaceTarget, keyof MarketplaceRefreshItem> = {
  pfs: "pfsOutcome",
  ankorstore: "ankorsOutcome",
  efashion: "efashionOutcome",
  faire: "faireOutcome",
  orderchamp: "orderchampOutcome",
  microstore: "microstoreOutcome",
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

/** Résout la colonne finale d'un item. Un push mode="publish" avec
 *  intent="create" atterrit dans la colonne « publication » ; sinon on
 *  utilise directement le mode comme clé de colonne (refresh/resync/publish).
 */
export function columnKeyFromItem(item: MarketplaceRefreshItem): ColumnKey {
  if (item.mode === "publish" && item.intent === "create") return "publication";
  return item.mode;
}

// ────────────────────────────────────────────────────────────────
// Vues du drawer 2026-08-14 (Création / Modification / Liaison /
// Rafraîchissement / Rafraîchissement sur étalement). Résout un item
// vers une des 5 vues à partir de son `intent` (BDD, autoritatif) avec
// fallback sur `mode` + heuristique client pour les anciens jobs sans intent.
// ────────────────────────────────────────────────────────────────

export type ViewKey = "creation" | "update" | "sync" | "link" | "refresh" | "scheduled" | "pfs_audit";

export const VIEW_ORDER: ViewKey[] = [
  "creation",
  "update",
  "sync",
  "link",
  "refresh",
  "scheduled",
  "pfs_audit",
];

export const VIEW_LABEL: Record<ViewKey, { title: string; subtitle: string; short: string }> = {
  creation: {
    title: "Création",
    subtitle: "Nouvelle fiche chez la marketplace",
    short: "création",
  },
  update: {
    title: "Modification",
    subtitle: "Modifs poussées sur fiches existantes",
    short: "modification",
  },
  sync: {
    title: "Synchronisation",
    subtitle: "Resynchronisation forcée (badge orange ou ↻)",
    short: "synchronisation",
  },
  link: {
    title: "Liaison",
    subtitle: "Rattachement produit ↔ marketplace",
    short: "liaison",
  },
  refresh: {
    title: "Rafraîchissement",
    subtitle: "Renouvellement immédiat de la fiche",
    short: "rafraîchissement",
  },
  scheduled: {
    title: "Rafraîchissement étalé",
    subtitle: "Lot programmé toutes les X min",
    short: "rafraîchissement étalé",
  },
  pfs_audit: {
    title: "Audit PFS",
    subtitle: "Propagation post-audit — corrections tirées de PFS",
    short: "audit PFS",
  },
};

/**
 * Résout la vue d'appartenance d'un item. Priorité à `intent` (posé en base
 * à l'enqueue depuis 2026-08-14) — les anciens jobs sans intent tombent sur
 * une heuristique : mode + scheduledFor.
 */
export function viewKeyFromItem(item: MarketplaceRefreshItem, now: number = Date.now()): ViewKey {
  // Origine audit PFS auto : priorité absolue. Les jobs viennent de la
  // propagation post-audit (cf. `lib/pfs-audit-runner.ts::enqueueMarketplacePropagation`)
  // et doivent être visibles dans leur propre onglet, pas dans « Rafraîchissement ».
  if (item.options && (item.options as { pfsAudit?: boolean }).pfsAudit) {
    return "pfs_audit";
  }
  const scheduled = itemIsScheduledFuture(item, now);
  if (item.intent === "create") return "creation";
  if (item.intent === "update") return "update";
  if (item.intent === "sync") return "sync";
  if (item.intent === "link") return "link";
  if (item.intent === "scheduled") return "scheduled";
  if (item.intent === "refresh") return scheduled ? "scheduled" : "refresh";
  // Fallback pour les anciens jobs sans intent.
  if (item.mode === "refresh") return scheduled ? "scheduled" : "refresh";
  // Resync forcé (bouton ↻) et badge orange « Synchro nécessaire » : vue dédiée
  // Synchronisation. Séparée de Modification pour distinguer un push suite à un
  // save fiche produit d'une resynchro forcée à la main.
  if (item.mode === "resync") return "sync";
  // Modes actions Microstore : masquer / réafficher / supprimer = modification
  // ciblée d'une fiche déjà en ligne → vue Modification.
  if (item.mode === "disable" || item.mode === "enable" || item.mode === "delete") return "update";
  // mode === "publish" sans intent : on n'a pas l'info d'ID marketplace côté
  // client sans re-fetch — on suppose "update" (cas majoritaire), au pire
  // l'admin voit la carte dans la mauvaise vue jusqu'à la prochaine session.
  return "update";
}

function itemIsScheduledFuture(item: MarketplaceRefreshItem, now: number): boolean {
  if (!item.scheduledFor) return false;
  const t = Date.parse(item.scheduledFor);
  return Number.isFinite(t) && t > now;
}

export interface ViewBucketProduct {
  key: ViewKey;
  groups: ProductGroup[];
  linkJobs: LinkJobLike[];
  kpi: ColumnKpi;
  /** Somme des items queued arrêtables. */
  queuedItemCount: number;
  /** Vrai s'il y a au moins un scheduledFor futur (uniquement vue "scheduled"). */
  hasScheduled: boolean;
}

/**
 * Range les groupes de produits et les jobs de liaison dans les 5 vues
 * (Création / Modification / Liaison / Rafraîchissement / Étalement).
 * Retourne toujours 5 buckets dans VIEW_ORDER.
 *
 * Différence vs `bucketColumns` : ici on regarde `intent` en priorité pour
 * décider de la vue, on distingue « rafraîchissement immédiat » vs « étalé »,
 * et on n'a plus la colonne « resync » — les resync sont classées dans
 * « Modification » (elles réécrivent la même fiche).
 */
export function bucketViews(
  groups: ProductGroup[],
  linkJobs: ReadonlyArray<LinkJobLike>,
  now: number = Date.now(),
): ViewBucketProduct[] {
  const byView = new Map<ViewKey, ProductGroup[]>();
  for (const g of groups) {
    // On classe le groupe selon la vue de son item dominant, dérivée via
    // viewKeyFromItem. Un groupe est déjà "product+mode" (voir
    // groupItemsByProductAndMode) donc on ne mélange pas deux vues.
    const dominant = g.items[0];
    const view = dominant ? viewKeyFromItem(dominant, now) : "update";
    const arr = byView.get(view);
    if (arr) arr.push(g);
    else byView.set(view, [g]);
  }

  return VIEW_ORDER.map<ViewBucketProduct>((key) => {
    if (key === "link") {
      // La vue Liaison agrège :
      //   - les LinkJob du contexte client (in-memory)
      //   - les jobs marketplace avec intent === "link" (persistés)
      const persistedLinkGroups = byView.get("link") ?? [];
      const linkArr = [...linkJobs];
      let errors = persistedLinkGroups.filter((g) => g.section === "errors").length;
      let active = persistedLinkGroups.filter(
        (g) => g.section === "active" || g.section === "queued" || g.section === "scheduled",
      ).length;
      let done = persistedLinkGroups.filter((g) => g.section === "done").length;
      for (const j of linkArr) {
        if (j.status === "error") errors += 1;
        else if (j.status === "in_progress") active += 1;
        else if (j.status === "done") done += 1;
      }
      let queuedItemCount = 0;
      for (const g of persistedLinkGroups) {
        for (const it of g.items) if (it.status === "queued") queuedItemCount += 1;
      }
      return {
        key,
        groups: persistedLinkGroups,
        linkJobs: linkArr,
        kpi: { errors, active, queued: 0, done },
        queuedItemCount,
        hasScheduled: false,
      };
    }

    const viewGroups = byView.get(key) ?? [];
    let errors = 0;
    let active = 0;
    let queued = 0;
    let done = 0;
    let queuedItemCount = 0;
    let hasScheduled = false;
    for (const g of viewGroups) {
      if (g.section === "errors") errors += 1;
      else if (g.section === "active") active += 1;
      else if (g.section === "scheduled" || g.section === "queued") queued += 1;
      else if (g.section === "done") done += 1;
      if (g.earliestScheduledFor) hasScheduled = true;
      for (const it of g.items) if (it.status === "queued") queuedItemCount += 1;
    }
    return {
      key,
      groups: viewGroups,
      linkJobs: [],
      kpi: { errors, active, queued, done },
      queuedItemCount,
      hasScheduled,
    };
  });
}

/**
 * Variante utilisée par le tiroir marketplaces pour la vue en catégories :
 * un produit qui a subi plusieurs actions (par ex. une modification puis un
 * rafraîchissement) donne lieu à autant de cartes distinctes. Ainsi les
 * erreurs d'une action ne se retrouvent jamais mélangées avec celles d'une
 * autre — chaque carte n'expose que les cellules pilotées par des items du
 * même mode/colonne.
 */
export function groupItemsByProductAndMode(
  items: ReadonlyArray<MarketplaceRefreshItem>,
  now: number = Date.now(),
): ProductGroup[] {
  return buildGroups(items, now, (item) => {
    // On ajoute une dimension audit-pfs à la clé pour que les jobs issus d'un
    // audit auto ne fusionnent pas avec un rafraîchissement manuel du même
    // produit — sinon un audit puis un ↻ manuel se retrouvent dans une seule
    // carte routée sur le premier onglet trouvé (bug 2026-09-08).
    const auditFlag =
      item.options && (item.options as { pfsAudit?: boolean }).pfsAudit
        ? "audit"
        : "std";
    return `${item.productId}::${columnKeyFromItem(item)}::${auditFlag}`;
  });
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
      orderchamp: cellForMarketplace(productItems, "orderchamp"),
      microstore: cellForMarketplace(productItems, "microstore"),
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
    const { mode: dominantMode, item: dominantItem } = pickDominant(productItems);
    const dominantColumn: ColumnKey = dominantItem
      ? columnKeyFromItem(dominantItem)
      : dominantMode;

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
      dominantColumn,
    };
  });
}

function pickDominant(items: MarketplaceRefreshItem[]): {
  mode: QueueItemMode;
  item: MarketplaceRefreshItem | null;
} {
  if (items.length === 0) return { mode: "refresh", item: null };
  const active = items.filter(isItemActive);
  const pool = active.length > 0 ? active : items;
  const chosen = pool.reduce((best, cur) =>
    itemRecency(cur) >= itemRecency(best) ? cur : best,
  );
  return { mode: chosen.mode, item: chosen };
}

// ────────────────────────────────────────────────────────────────
// Libellés + copie pour le tooltip
// ────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────
// Regroupement de haut niveau par mode (Modifications / Rafraîchissements /
// Synchronisations). Rendu sous forme de sections repliables dans le tiroir,
// pour permettre un « Arrêter » ciblé sur un seul type d'action.
// ────────────────────────────────────────────────────────────────

export const MODE_ORDER: QueueItemMode[] = [
  "publish",
  "refresh",
  "resync",
  "disable",
  "enable",
  "delete",
];

export const MODE_LABEL: Record<QueueItemMode, { title: string; short: string }> = {
  publish: { title: "Modifications", short: "modification" },
  refresh: { title: "Rafraîchissements", short: "rafraîchissement" },
  resync: { title: "Synchronisations", short: "synchronisation" },
  disable: { title: "Masquages", short: "masquage" },
  enable: { title: "Réaffichages", short: "réaffichage" },
  delete: { title: "Suppressions", short: "suppression" },
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
  orderchamp: "Orderchamp",
  microstore: "Microstore",
};

// ────────────────────────────────────────────────────────────────
// Regroupement en colonnes par type d'action (refonte 2026-07-28).
// Le tiroir affiche désormais 4 colonnes côte à côte : Modifications,
// Rafraîchissements, Synchronisations, Liaisons. La colonne « Liaisons »
// ne vient PAS des MarketplaceRefreshItem — elle vient des LinkJob du
// contexte MarketplaceLinkContext. On modélise ça avec une clef commune.
// ────────────────────────────────────────────────────────────────

export type ColumnKey =
  | "publication"
  | "publish"
  | "refresh"
  | "resync"
  | "link"
  | "disable"
  | "enable"
  | "delete";

export const COLUMN_ORDER: ColumnKey[] = ["publication", "publish", "refresh", "resync", "link"];

export const COLUMN_LABEL: Record<ColumnKey, { title: string; subtitle: string; short: string }> = {
  publication: {
    title: "Publication",
    subtitle: "Créer la fiche chez le marketplace",
    short: "publication",
  },
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
  disable: {
    title: "Masquages",
    subtitle: "Fiche masquée sur la vitrine",
    short: "masquage",
  },
  enable: {
    title: "Réaffichages",
    subtitle: "Fiche redevient visible",
    short: "réaffichage",
  },
  delete: {
    title: "Suppressions",
    subtitle: "Fiche supprimée définitivement",
    short: "suppression",
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
  const byColumn = new Map<ColumnKey, ProductGroup[]>();
  for (const g of groups) {
    const arr = byColumn.get(g.dominantColumn);
    if (arr) arr.push(g);
    else byColumn.set(g.dominantColumn, [g]);
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

    const modeGroups = byColumn.get(key) ?? [];
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
  orderchamp: "Orderchamp",
  microstore: "Microstore",
};

// ────────────────────────────────────────────────────────────────
// Vue résumée pour gros volumes — bascule auto au-delà du seuil.
// Évite de rendre 500 cartes qui saturent le navigateur pendant qu'une
// file de rafraîchissement / publication massive s'écoule.
// ────────────────────────────────────────────────────────────────

/** Nombre de groupes au-dessus duquel la vue bascule automatiquement en
 *  résumé agrégé. Choisi assez bas pour que Chrome reste fluide même sur
 *  un PC modeste avec plusieurs onglets admin ouverts. */
export const SUMMARY_THRESHOLD = 20;

export interface MarketplaceSummary {
  target: MarketplaceTarget;
  done: number;
  active: number;
  queued: number;
  errors: number;
  /** Nombre de produits ciblés par cette marketplace dans les groupes agrégés. */
  total: number;
}

/**
 * Agrège les cellules marketplace de tous les groupes en 1 ligne par marketplace.
 * Ignore les cellules `not-targeted`. Ne retourne que les marketplaces avec au
 * moins un produit ciblé (total > 0), dans l'ordre canonique `MARKETPLACE_ORDER`.
 */
export function summarizeGroupsPerMarketplace(
  groups: ReadonlyArray<ProductGroup>,
): MarketplaceSummary[] {
  const map: Record<MarketplaceTarget, MarketplaceSummary> = {
    pfs: { target: "pfs", done: 0, active: 0, queued: 0, errors: 0, total: 0 },
    ankorstore: { target: "ankorstore", done: 0, active: 0, queued: 0, errors: 0, total: 0 },
    efashion: { target: "efashion", done: 0, active: 0, queued: 0, errors: 0, total: 0 },
    faire: { target: "faire", done: 0, active: 0, queued: 0, errors: 0, total: 0 },
    orderchamp: { target: "orderchamp", done: 0, active: 0, queued: 0, errors: 0, total: 0 },
    microstore: { target: "microstore", done: 0, active: 0, queued: 0, errors: 0, total: 0 },
  };
  for (const g of groups) {
    for (const target of MARKETPLACE_ORDER) {
      const cell = g.cells[target];
      if (!cell || cell.kind === "not-targeted") continue;
      const s = map[target];
      s.total += 1;
      if (cell.kind === "done") s.done += 1;
      else if (cell.kind === "error") s.errors += 1;
      else if (cell.kind === "active") s.active += 1;
      else if (cell.kind === "queued") s.queued += 1;
    }
  }
  return MARKETPLACE_ORDER.map((t) => map[t]).filter((s) => s.total > 0);
}

/**
 * Sépare les groupes en 2 pools pour la vue résumée : les groupes en erreur
 * qui restent affichés individuellement (l'admin doit pouvoir les relancer),
 * et les autres qui sont juste comptabilisés dans le résumé agrégé.
 */
export function partitionGroupsForSummary(groups: ReadonlyArray<ProductGroup>): {
  errorGroups: ProductGroup[];
  aggregatedGroups: ProductGroup[];
} {
  const errorGroups: ProductGroup[] = [];
  const aggregatedGroups: ProductGroup[] = [];
  for (const g of groups) {
    if (g.section === "errors") errorGroups.push(g);
    else aggregatedGroups.push(g);
  }
  return { errorGroups, aggregatedGroups };
}

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
      : mode === "disable"
      ? "Masquage échoué"
      : mode === "enable"
      ? "Réaffichage échoué"
      : mode === "delete"
      ? "Suppression échouée"
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
