import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const PER_PAGE = 20;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q           = searchParams.get("q")          ?? "";
  const cat         = searchParams.get("cat")        ?? "";
  const subcat      = searchParams.get("subcat")     ?? "";
  const collection  = searchParams.get("collection") ?? "";
  const colorId     = searchParams.get("color")      ?? "";
  const tagId       = searchParams.get("tag")        ?? "";
  const bestseller  = searchParams.get("bestseller") === "1";
  const isNew       = searchParams.get("new")        === "1";
  const minPrice    = searchParams.get("minPrice") ? parseFloat(searchParams.get("minPrice")!) : null;
  const maxPrice    = searchParams.get("maxPrice") ? parseFloat(searchParams.get("maxPrice")!) : null;
  const page        = Math.max(1, parseInt(searchParams.get("page") ?? "1"));


  const where: Record<string, unknown> = {
    NOT: { colors: { every: { stock: { equals: 0 } } } },
    ...(q && {
      OR: [
        { name:      { contains: q } },
        { reference: { contains: q } },
        { tags: { some: { tag: { name: { contains: q.toLowerCase() } } } } },
      ],
    }),
    ...(cat        && { categoryId: cat }),
    ...(subcat     && { subCategories: { some: { id: subcat } } }),
    ...(collection && { collections: { some: { collectionId: collection } } }),
    ...(colorId    && { colors: { some: { colorId } } }),
    ...(tagId      && { tags: { some: { tagId } } }),
    ...(bestseller && { isBestSeller: true }),
    ...(isNew      && { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
    ...((minPrice !== null || maxPrice !== null) && {
      colors: {
        some: {
          unitPrice: {
            ...(minPrice !== null && { gte: minPrice }),
            ...(maxPrice !== null && { lte: maxPrice }),
          },
        },
      },
    }),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy: isNew ? { updatedAt: "desc" } : { createdAt: "desc" },
    skip:    (page - 1) * PER_PAGE,
    take:    PER_PAGE,
    include: {
      category:      { select: { name: true } },
      subCategories: { select: { name: true }, take: 1 },
      tags:          { include: { tag: { select: { id: true, name: true } } } },
      colors: {
        select: {
          id:        true,
          unitPrice: true,
          isPrimary: true,
          color:     { select: { name: true, hex: true } },
          images:    { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
          saleOptions: {
            select: { id: true, saleType: true, packQuantity: true, size: true },
          },
        },
      },
    },
  });

  return NextResponse.json({
    products,
    hasMore: products.length === PER_PAGE,
  });
}
