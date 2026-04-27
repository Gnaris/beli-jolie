import type { Prisma } from "@prisma/client";

export interface AdminProductsFilterParams {
  q?: string;
  exactRef?: boolean;
  cat?: string;
  subCat?: string;
  tag?: string;
  bestSeller?: string; // "1" | ""
  refresh?: string; // "never" | "recent" | "refreshed" | ""
  status?: string; // ProductStatus | "DRAFT"
  minPrice?: number | null;
  maxPrice?: number | null;
  dateFrom?: string;
  dateTo?: string;
  stockBelow?: number | null;
  /** Reference date for "recent" refresh window (defaults to now). Tests inject a fixed value. */
  now?: Date;
}

const RECENT_REFRESH_DAYS = 30;

export function buildAdminProductsWhere(params: AdminProductsFilterParams): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};

  if (params.q) {
    if (params.exactRef) {
      where.reference = { equals: params.q.toUpperCase() };
    } else {
      where.OR = [
        { name: { contains: params.q } },
        { reference: { contains: params.q } },
      ];
    }
  }

  if (params.cat) where.categoryId = params.cat;

  if (params.subCat) {
    where.subCategories = { some: { id: params.subCat } };
  }

  if (params.tag) {
    where.tags = { some: { tagId: params.tag } };
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

  if (params.status === "DRAFT") {
    where.status = "OFFLINE";
    where.isIncomplete = true;
  } else if (params.status === "OFFLINE") {
    where.status = "OFFLINE";
    where.isIncomplete = false;
  } else if (params.status === "ONLINE" || params.status === "ARCHIVED" || params.status === "SYNCING") {
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

  return where;
}
