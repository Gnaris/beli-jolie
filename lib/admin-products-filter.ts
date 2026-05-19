import type { Prisma, PrismaClient } from "@prisma/client";

export type AdminProductsRefreshValue =
  | ""
  | "never"
  | "recent"
  | "refreshed"
  | "dateDesc"
  | "dateAsc";

export interface AdminProductsFilterParams {
  q?: string;
  exactRef?: boolean;
  cat?: string;
  subCat?: string;
  tag?: string;
  composition?: string;
  bestSeller?: string; // "1" | ""
  refresh?: string; // AdminProductsRefreshValue
  status?: string; // ProductStatus | "DRAFT"
  minPrice?: number | null;
  maxPrice?: number | null;
  dateFrom?: string;
  dateTo?: string;
  stockBelow?: number | null;
  /** "linked" = pfsProductId renseigné, "unlinked" = pfsProductId vide */
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
   * Filtre sur le code SH (douanier) du produit :
   *   - `""`         = pas de filtre (tous)
   *   - `"__none__"` = produits sans code SH (NULL ou chaîne vide)
   *   - autre        = égalité stricte (code SH exact)
   */
  hsCode?: string;
  /**
   * Liste des productId à retenir (intersection). Quand le filtre
   * « variantes sans image » est actif, on précalcule les IDs côté serveur
   * via une requête SQL et on les passe ici. `null`/undefined = filtre inactif,
   * `[]` = aucun produit ne correspond.
   */
  productIdsIn?: string[] | null;
  /** Reference date for "recent" refresh window (defaults to now). Tests inject a fixed value. */
  now?: Date;
}

const RECENT_REFRESH_DAYS = 30;

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
  // `dateDesc` / `dateAsc` are sort options handled by buildAdminProductsOrderBy
  // and intentionally do not narrow the where clause.

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

  const stockBelow = params.stockBelow ?? null;
  if (stockBelow !== null && !Number.isNaN(stockBelow)) {
    const existingSome = (where.colors && "some" in where.colors ? where.colors.some : undefined) ?? {};
    where.colors = {
      some: { ...existingSome, stock: { lte: stockBelow } },
    };
  }

  if (params.pfsLink === "linked") {
    where.pfsProductId = { not: null };
  } else if (params.pfsLink === "unlinked") {
    where.pfsProductId = null;
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

  if (params.hsCode === "__none__") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      { OR: [{ hsCode: null }, { hsCode: "" }] },
    ];
  } else if (params.hsCode) {
    where.hsCode = params.hsCode;
  }

  if (params.productIdsIn) {
    where.id = { in: params.productIdsIn };
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
 * `dateDesc` / `dateAsc` sort by `lastRefreshedAt`, with never-refreshed
 * products always at the end (nulls last) and `createdAt` as tie-breaker.
 */
export function buildAdminProductsOrderBy(
  refresh?: string,
): Prisma.ProductOrderByWithRelationInput[] {
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
  return [{ createdAt: "desc" }];
}
