import type { Prisma, PrismaClient } from "@prisma/client";

export type AdminProductsRefreshValue =
  | ""
  | "never"
  | "recent"
  | "refreshed"
  | "dateDesc"
  | "dateAsc"
  | "modifiedDesc"
  | "modifiedAsc";

/**
 * Valeurs possibles pour le paramètre URL `sort` — tri explicite du tableau
 * admin des produits, indépendant du filtre `refresh`. Vide/absent = défaut
 * (`createdAt` desc). `sort` prend la priorité sur les valeurs de tri héritées
 * de `refresh` (`dateDesc/Asc`, `modifiedDesc/Asc`) quand les deux sont posés.
 */
export type AdminProductsSortValue =
  | ""
  | "createdDesc"
  | "createdAsc"
  | "modifiedDesc"
  | "modifiedAsc"
  | "importantFirst";

/**
 * Valeurs possibles pour les filtres "Dernier export marketplace" — un filtre
 * par marketplace (PFS, eFashion, Microstore, Ankorstore). On expose volontairement
 * une grille à 5 paliers (jamais → > 90j) plutôt qu'un date-picker : la cliente
 * raisonne en "il y a longtemps" plus qu'en date précise.
 */
export type AdminProductsExportedValue =
  | ""
  | "never"
  | "lt7d"
  | "lt30d"
  | "gt30d"
  | "gt90d";

export interface AdminProductsFilterParams {
  q?: string;
  exactRef?: boolean;
  cat?: string;
  subCat?: string;
  tag?: string;
  composition?: string;
  bestSeller?: string; // "1" | ""
  /**
   * Filtre « Importants seulement » (favoris admin). "1" = filtre actif.
   * Le marqueur `Product.important` est partagé entre tous les comptes admin.
   */
  important?: string; // "1" | ""
  /**
   * Raccourci « Créé récemment » : ne retient que les produits créés dans les
   * 30 derniers jours (cohérent avec la notion de « Nouveauté » côté public).
   * Combiné en AND avec `dateFrom` : on garde la borne la plus restrictive.
   * "1" = filtre actif.
   */
  createdRecent?: string; // "1" | ""
  /**
   * Raccourci « Modifié récemment » : ne retient que les produits dont
   * `updatedAt` est dans les 30 derniers jours. Combiné en AND avec
   * `updatedFrom` : on garde la borne la plus restrictive. "1" = filtre actif.
   */
  updatedRecent?: string; // "1" | ""
  refresh?: string; // AdminProductsRefreshValue
  status?: string; // ProductStatus | "DRAFT"
  minPrice?: number | null;
  maxPrice?: number | null;
  dateFrom?: string;
  dateTo?: string;
  /**
   * Bornes du filtre « Date de dernière modification » — mappées sur
   * `Product.updatedAt`. `updatedTo` est étendue à 23:59:59.999 pour couvrir
   * toute la journée (même logique que `dateTo`).
   */
  updatedFrom?: string;
  updatedTo?: string;
  stockBelow?: number | null;
  /**
   * Filtre sur le lien Paris Fashion Shop — un produit est considéré « lié »
   * seulement s'il est complètement lié (produit + toutes ses couleurs UNIT).
   *   - "linked"   = `pfsProductId` renseigné ET aucune couleur UNIT sans `pfsVariantId`
   *   - "unlinked" = `pfsProductId` vide OU au moins une couleur UNIT sans `pfsVariantId`
   */
  pfsLink?: string;
  /**
   * Filtre sur le lien Ankorstore — un produit est considéré « lié » seulement
   * s'il est complètement lié (produit + toutes ses couleurs UNIT). Tant qu'au
   * moins une couleur UNIT n'a pas son `ankorsVariantId`, le produit est traité
   * comme non lié.
   *   - "linked"   = `ankorsProductId` renseigné ET aucune couleur UNIT sans `ankorsVariantId`
   *   - "unlinked" = `ankorsProductId` vide OU au moins une couleur UNIT sans `ankorsVariantId`
   */
  ankorsLink?: string;
  /**
   * Filtre sur le lien eFashion Paris — eFashion ne synchronise que les variantes
   * UNIT (1 ligne eFashion par couleur). Un produit est considéré « lié » seulement
   * s'il a sa `efashionReferenceBase` ET que toutes ses couleurs UNIT portent leur
   * `efashionProductId`.
   *   - "linked"   = `efashionReferenceBase` renseigné ET aucune couleur UNIT sans `efashionProductId`
   *   - "unlinked" = `efashionReferenceBase` vide OU au moins une couleur UNIT sans `efashionProductId`
   */
  efashionLink?: string;
  /**
   * Filtre sur le lien Faire — Faire ne synchronise que les variantes UNIT
   * (1 SKU Faire par couleur). Un produit est considéré « lié » seulement s'il
   * a son `faireProductId` ET que toutes ses couleurs UNIT portent leur
   * `faireVariantId`.
   *   - "linked"   = `faireProductId` renseigné ET aucune couleur UNIT sans `faireVariantId`
   *   - "unlinked" = `faireProductId` vide OU au moins une couleur UNIT sans `faireVariantId`
   */
  faireLink?: string;
  /**
   * Filtre « Synchronisation marketplace nécessaire » : ne retient que les
   * produits avec au moins un drapeau `*SyncRequired = true` (PFS, Ankorstore
   * ou eFashion). Sert à retrouver d'un coup les fiches qui attendent un
   * push depuis le dernier save / upload d'images.
   *   - "1" = filtre actif
   *   - "" (ou absent) = pas de filtre
   */
  syncRequired?: string;
  /**
   * Filtres « Dernier export marketplace » — un par marketplace. Les bornes 7j /
   * 30j / 90j sont relatives à `params.now` (override possible côté tests).
   * Vide ou absent = pas de filtre. Voir `AdminProductsExportedValue`.
   */
  pfsExportedAt?: string;
  efashionExportedAt?: string;
  microstoreExportedAt?: string;
  ankorstoreExportedAt?: string;
  faireExportedAt?: string;
  /**
   * Filtre sur le code SH (douanier) du produit, désormais en relation
   * avec la bibliothèque HsCode :
   *   - `""`         = pas de filtre (tous)
   *   - `"__none__"` = produits sans code SH (hsCodeId NULL)
   *   - autre        = id du code SH (égalité stricte sur Product.hsCodeId)
   */
  hsCodeId?: string;
  /**
   * Filtre « Verrouillé » : ne retient que les produits avec le verrou manuel
   * activé (Product.locked = true).
   *   - "1" = filtre actif
   *   - "" (ou absent) = pas de filtre
   */
  locked?: string;
  /**
   * Liste des productId à retenir (intersection). Quand le filtre
   * « variantes sans image » est actif, on précalcule les IDs côté serveur
   * via une requête SQL et on les passe ici. `null`/undefined = filtre inactif,
   * `[]` = aucun produit ne correspond.
   */
  productIdsIn?: string[] | null;
  /**
   * Liste des productId à exclure. Utilisé pour le filtre inverse
   * « toutes les variantes ont au moins une image » : on reprend les IDs
   * « avec au moins une variante sans image » et on les met en `notIn`.
   */
  productIdsNotIn?: string[] | null;
  /** Reference date for "recent" refresh window (defaults to now). Tests inject a fixed value. */
  now?: Date;
}

const RECENT_REFRESH_DAYS = 30;

const EXPORT_FIELD_BY_MARKETPLACE = {
  pfs:        "pfsLastExportedAt",
  efashion:   "efashionLastExportedAt",
  microstore: "microstoreLastExportedAt",
  ankorstore: "ankorstoreLastExportedAt",
  faire:      "faireLastExportedAt",
} as const;

type ExportMarketplaceKey = keyof typeof EXPORT_FIELD_BY_MARKETPLACE;

/**
 * Construit la clause Prisma pour un filtre « Dernier export » d'une marketplace.
 * Retourne `null` si le filtre est inactif (chaîne vide ou valeur inconnue) — le
 * caller doit alors ne rien ajouter au WHERE.
 *
 * Garde la logique strictement déclarative : `never` = `IS NULL`, `lt*` = exporté
 * récemment, `gt*` = exporté il y a longtemps (et donc forcément pas NULL).
 */
function buildExportedAtClause(
  marketplace: ExportMarketplaceKey,
  value: string | undefined,
  now: Date,
): Prisma.ProductWhereInput | null {
  if (!value) return null;
  const field = EXPORT_FIELD_BY_MARKETPLACE[marketplace];
  const cutoff = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d;
  };
  switch (value) {
    case "never":  return { [field]: null };
    case "lt7d":   return { [field]: { gte: cutoff(7) } };
    case "lt30d":  return { [field]: { gte: cutoff(30) } };
    case "gt30d":  return { [field]: { lt: cutoff(30) } };
    case "gt90d":  return { [field]: { lt: cutoff(90) } };
    default:       return null;
  }
}

export function buildAdminProductsWhere(params: AdminProductsFilterParams): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};

  if (params.q) {
    const terms = params.q
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (terms.length === 1) {
      const term = terms[0];
      if (params.exactRef) {
        where.reference = { equals: term.toUpperCase() };
      } else {
        // Recherche libre : nom contient OR référence commence par (LIKE 'TERM%')
        where.OR = [
          { name: { contains: term } },
          { reference: { startsWith: term } },
        ];
      }
    } else if (terms.length > 1) {
      if (params.exactRef) {
        where.reference = { in: terms.map((t) => t.toUpperCase()) };
      } else {
        where.OR = terms.flatMap((t) => [
          { name: { contains: t } },
          { reference: { startsWith: t } },
        ]);
      }
    }
  }

  if (params.cat) where.categoryId = params.cat;

  if (params.subCat) {
    where.subCategories = { some: { id: params.subCat } };
  }

  if (params.tag) {
    where.tags = { some: { tagId: params.tag } };
  }

  if (params.composition) {
    where.compositions = { some: { compositionId: params.composition } };
  }

  if (params.bestSeller === "1") {
    where.isBestSeller = true;
  }

  if (params.important === "1") {
    where.important = true;
  }

  const now = params.now ?? new Date();
  if (params.refresh === "never") {
    where.lastRefreshedAt = null;
  } else if (params.refresh === "refreshed") {
    where.lastRefreshedAt = { not: null };
  } else if (params.refresh === "recent") {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RECENT_REFRESH_DAYS);
    where.lastRefreshedAt = { gte: cutoff };
  }
  // `dateDesc` / `dateAsc` / `modifiedDesc` / `modifiedAsc` are sort options
  // handled by buildAdminProductsOrderBy and intentionally do not narrow the where clause.

  if (params.status === "DRAFT") {
    where.status = "OFFLINE";
    where.isIncomplete = true;
  } else if (params.status === "OFFLINE") {
    where.status = "OFFLINE";
    where.isIncomplete = false;
  } else if (params.status === "ONLINE" || params.status === "ARCHIVED") {
    where.status = params.status;
  }

  const min = params.minPrice ?? null;
  const max = params.maxPrice ?? null;
  if (min !== null || max !== null) {
    where.colors = {
      some: {
        unitPrice: {
          ...(min !== null && { gte: min }),
          ...(max !== null && { lte: max }),
        },
      },
    };
  }

  if (params.dateFrom) {
    where.createdAt = { ...(where.createdAt as object), gte: new Date(params.dateFrom) };
  }
  if (params.dateTo) {
    const end = new Date(params.dateTo);
    end.setHours(23, 59, 59, 999);
    where.createdAt = { ...(where.createdAt as object), lte: end };
  }

  if (params.updatedFrom) {
    where.updatedAt = { ...(where.updatedAt as object), gte: new Date(params.updatedFrom) };
  }
  if (params.updatedTo) {
    const end = new Date(params.updatedTo);
    end.setHours(23, 59, 59, 999);
    where.updatedAt = { ...(where.updatedAt as object), lte: end };
  }

  // Raccourcis « récemment » (barre d'onglets) — combinés en AND avec les bornes
  // date-picker existantes : on garde la borne inférieure la plus restrictive
  // (le max entre la borne explicite et now - 30j).
  if (params.createdRecent === "1") {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RECENT_REFRESH_DAYS);
    const existing = (where.createdAt as { gte?: Date } | undefined)?.gte;
    const gte = existing && existing > cutoff ? existing : cutoff;
    where.createdAt = { ...(where.createdAt as object), gte };
  }
  if (params.updatedRecent === "1") {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RECENT_REFRESH_DAYS);
    const existing = (where.updatedAt as { gte?: Date } | undefined)?.gte;
    const gte = existing && existing > cutoff ? existing : cutoff;
    where.updatedAt = { ...(where.updatedAt as object), gte };
  }

  const stockBelow = params.stockBelow ?? null;
  if (stockBelow !== null && !Number.isNaN(stockBelow)) {
    const existingSome = (where.colors && "some" in where.colors ? where.colors.some : undefined) ?? {};
    where.colors = {
      some: { ...existingSome, stock: { lte: stockBelow } },
    };
  }

  if (params.pfsLink === "linked") {
    where.pfsProductId = { not: null };
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      { NOT: { colors: { some: { saleType: "UNIT", pfsVariantId: null } } } },
    ];
  } else if (params.pfsLink === "unlinked") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      {
        OR: [
          { pfsProductId: null },
          { colors: { some: { saleType: "UNIT", pfsVariantId: null } } },
        ],
      },
    ];
  }

  if (params.ankorsLink === "linked") {
    where.ankorsProductId = { not: null };
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      { NOT: { colors: { some: { saleType: "UNIT", ankorsVariantId: null } } } },
    ];
  } else if (params.ankorsLink === "unlinked") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      {
        OR: [
          { ankorsProductId: null },
          { colors: { some: { saleType: "UNIT", ankorsVariantId: null } } },
        ],
      },
    ];
  }

  if (params.efashionLink === "linked") {
    where.efashionReferenceBase = { not: null };
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      { NOT: { colors: { some: { saleType: "UNIT", efashionProductId: null } } } },
    ];
  } else if (params.efashionLink === "unlinked") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      {
        OR: [
          { efashionReferenceBase: null },
          { colors: { some: { saleType: "UNIT", efashionProductId: null } } },
        ],
      },
    ];
  }

  if (params.faireLink === "linked") {
    where.faireProductId = { not: null };
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      { NOT: { colors: { some: { saleType: "UNIT", faireVariantId: null } } } },
    ];
  } else if (params.faireLink === "unlinked") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      {
        OR: [
          { faireProductId: null },
          { colors: { some: { saleType: "UNIT", faireVariantId: null } } },
        ],
      },
    ];
  }

  if (params.syncRequired === "1") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      {
        OR: [
          { pfsSyncRequired: true },
          { ankorsSyncRequired: true },
          { efashionSyncRequired: true },
          { faireSyncRequired: true },
        ],
      },
    ];
  }

  // Filtres « Dernier export marketplace » — additifs (AND entre marketplaces).
  const exportClauses = [
    buildExportedAtClause("pfs", params.pfsExportedAt, now),
    buildExportedAtClause("efashion", params.efashionExportedAt, now),
    buildExportedAtClause("microstore", params.microstoreExportedAt, now),
    buildExportedAtClause("ankorstore", params.ankorstoreExportedAt, now),
    buildExportedAtClause("faire", params.faireExportedAt, now),
  ].filter((c): c is Prisma.ProductWhereInput => c !== null);
  if (exportClauses.length > 0) {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      ...exportClauses,
    ];
  }

  if (params.locked === "1") {
    where.locked = true;
  }

  if (params.hsCodeId === "__none__") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      { hsCodeId: null },
    ];
  } else if (params.hsCodeId) {
    where.hsCodeId = params.hsCodeId;
  }

  if (params.productIdsIn) {
    where.id = { ...(where.id as object | undefined), in: params.productIdsIn };
  }

  if (params.productIdsNotIn) {
    where.id = { ...(where.id as object | undefined), notIn: params.productIdsNotIn };
  }

  return where;
}

/**
 * Renvoie les productId où **au moins une variante de couleur** n'a aucune
 * image enregistrée. Le couple (productId, colorId) est la clé d'image dans
 * `ProductColorImage` — on cherche donc les ProductColor (avec colorId non
 * nul) pour lesquels aucune ligne image n'existe sur ce couple.
 *
 * Utilisé par la page `/admin/produits` pour le filtre « Variantes sans image ».
 */
export async function findProductIdsWithMissingVariantImages(
  prisma: Pick<PrismaClient, "$queryRaw">,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ productId: string }[]>`
    SELECT DISTINCT pc.productId AS productId
    FROM ProductColor pc
    WHERE pc.colorId IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM ProductColorImage pci
        WHERE pci.productId = pc.productId
          AND pci.colorId = pc.colorId
      )
  `;
  return rows.map((r) => r.productId);
}

/**
 * Build the Prisma `orderBy` for the admin products list.
 *
 * Default: most recently created first.
 * `sort` (paramètre URL dédié) prend la priorité s'il vaut une des 4 options
 * de tri exposées à l'admin :
 *   - `createdDesc` / `createdAsc` : tri explicite par `createdAt`
 *   - `modifiedDesc` / `modifiedAsc` : tri par `updatedAt`
 *   - `importantFirst` : `important` desc, puis `createdAt` desc en tie-breaker
 *
 * Sinon on retombe sur le comportement historique via `refresh` :
 * - `dateDesc` / `dateAsc` : `lastRefreshedAt`, `nulls: "last"`, `createdAt` en tie-breaker
 * - `modifiedDesc` / `modifiedAsc` : `updatedAt`
 * - toute autre valeur (`""`, `"never"`, `"recent"`, `"refreshed"`) : `createdAt` desc
 */
export function buildAdminProductsOrderBy(
  refresh?: string,
  sort?: string,
): Prisma.ProductOrderByWithRelationInput[] {
  // `sort` a la priorité — 5 valeurs reconnues, autres = ignoré (fallback refresh).
  if (sort === "createdDesc") return [{ createdAt: "desc" }];
  if (sort === "createdAsc")  return [{ createdAt: "asc" }];
  if (sort === "modifiedDesc") return [{ updatedAt: "desc" }];
  if (sort === "modifiedAsc")  return [{ updatedAt: "asc" }];
  if (sort === "importantFirst") return [{ important: "desc" }, { createdAt: "desc" }];

  if (refresh === "dateDesc") {
    return [
      { lastRefreshedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ];
  }
  if (refresh === "dateAsc") {
    return [
      { lastRefreshedAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ];
  }
  if (refresh === "modifiedDesc") {
    return [{ updatedAt: "desc" }];
  }
  if (refresh === "modifiedAsc") {
    return [{ updatedAt: "asc" }];
  }
  return [{ createdAt: "desc" }];
}
