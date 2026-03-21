import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/products/search?q=xxx&exclude=productId&fields=catalog
 * Recherche produits pour le selecteur de produits similaires (admin).
 * Renvoie les produits avec image principale, reference, categorie.
 * fields=catalog : renvoie aussi colorImages et colors (pour CatalogEditor).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const exclude = request.nextUrl.searchParams.get("exclude") ?? "";
  const exactRef = request.nextUrl.searchParams.get("exactRef") === "1";
  const fields = request.nextUrl.searchParams.get("fields") ?? "";

  if (q.length < 1) return NextResponse.json({ products: [] });

  const whereClause = {
    status: "ONLINE" as const,
    ...(exclude && { NOT: { id: exclude } }),
    ...(exactRef
      ? { reference: { equals: q.toUpperCase() } }
      : { OR: [
          { reference: { contains: q } },
          { name: { contains: q } },
        ] }
    ),
  };

  // Catalog mode: return full ProductSnap data
  if (fields === "catalog") {
    const products = await prisma.product.findMany({
      where: whereClause,
      take: 20,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        reference: true,
        colorImages: { orderBy: { order: "asc" }, select: { path: true, colorId: true } },
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
    });

    return NextResponse.json({ products });
  }

  // Default mode: lightweight results for similar product picker
  const products = await prisma.product.findMany({
    where: {
      ...(exclude && { NOT: { id: exclude } }),
      ...(exactRef
        ? { reference: { equals: q.toUpperCase() } }
        : { OR: [
            { reference: { contains: q } },
            { name: { contains: q } },
          ] }
      ),
    },
    take: 12,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      reference: true,
      category: { select: { name: true } },
    },
  });

  // Get first image for each product
  const productIds = products.map((p) => p.id);
  const firstImages = productIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: productIds } }, orderBy: { order: "asc" } })
    : [];
  const firstImageMap = new Map<string, string>();
  for (const img of firstImages) {
    if (!firstImageMap.has(img.productId)) firstImageMap.set(img.productId, img.path);
  }

  const results = products.map((p) => ({
    id: p.id,
    name: p.name,
    reference: p.reference,
    category: p.category.name,
    image: firstImageMap.get(p.id) ?? null,
  }));

  return NextResponse.json({ products: results });
}
