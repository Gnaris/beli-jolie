import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/admin/products/catalog-picker
 * Listing paginé de produits ONLINE pour le sélecteur de catalogue/collection.
 * Params :
 *   page, q (recherche nom/ref), categoryId, subCategoryId
 *   colorIds (csv), compositionIds (csv)
 *   sort : recent | oldest | recentUpdated | oldestUpdated | name | price
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const q = params.get("q")?.trim() ?? "";
  const categoryId = params.get("categoryId") ?? "";
  const subCategoryId = params.get("subCategoryId") ?? "";
  const colorIdsRaw = params.get("colorIds") ?? "";
  const compositionIdsRaw = params.get("compositionIds") ?? "";
  const sort = params.get("sort") ?? "recent";
  const pageSize = 24;

  const colorIds = colorIdsRaw ? colorIdsRaw.split(",").filter(Boolean) : [];
  const compositionIds = compositionIdsRaw ? compositionIdsRaw.split(",").filter(Boolean) : [];

  const where: Prisma.ProductWhereInput = { status: "ONLINE" };

  if (q.length > 0) {
    where.OR = [
      { name: { contains: q } },
      { reference: { contains: q } },
    ];
  }

  if (categoryId) where.categoryId = categoryId;
  if (subCategoryId) where.subCategories = { some: { id: subCategoryId } };
  if (colorIds.length > 0) where.colors = { some: { colorId: { in: colorIds } } };
  if (compositionIds.length > 0) {
    where.compositions = { some: { compositionId: { in: compositionIds } } };
  }

  let orderBy: Prisma.ProductOrderByWithRelationInput;
  switch (sort) {
    case "oldest":
      orderBy = { createdAt: "asc" };
      break;
    case "recentUpdated":
      orderBy = { updatedAt: "desc" };
      break;
    case "oldestUpdated":
      orderBy = { updatedAt: "asc" };
      break;
    case "name":
      orderBy = { name: "asc" };
      break;
    case "price":
      orderBy = { name: "asc" };
      break;
    case "recent":
    default:
      orderBy = { createdAt: "desc" };
      break;
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy,
      select: {
        id: true,
        name: true,
        reference: true,
        createdAt: true,
        category: { select: { id: true, name: true } },
        colorImages: {
          orderBy: { order: "asc" },
          take: 1,
          select: { path: true, colorId: true },
        },
        colors: {
          where: { saleType: "UNIT" },
          select: {
            colorId: true,
            isPrimary: true,
            unitPrice: true,
            color: { select: { id: true, name: true, hex: true } },
          },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const serialized = products.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    colors: p.colors.map((c) => ({
      ...c,
      unitPrice: Number(c.unitPrice),
    })),
  }));

  return NextResponse.json({
    products: serialized,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  });
}
