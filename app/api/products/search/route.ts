import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/products/search?q=xxx
 * Recherche rapide pour la barre de recherche du header.
 * Priorité : référence > nom > description > catégorie > mots-clés
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const exactRef = request.nextUrl.searchParams.get("exactRef") === "1";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const products = await prisma.product.findMany({
    where: {
      status: "ONLINE",
      ...(exactRef
        ? { reference: { equals: q.toUpperCase() } }
        : {
            OR: [
              { reference: { contains: q } },
              { name: { contains: q } },
              { description: { contains: q } },
              { category: { name: { contains: q } } },
              { tags: { some: { tag: { name: { contains: q.toLowerCase() } } } } },
            ],
          }),
    },
    take: 8,
    orderBy: { createdAt: "desc" },
    select: {
      id:       true,
      name:     true,
      reference: true,
      category: { select: { name: true } },
      colors: {
        orderBy: { isPrimary: "desc" },
        select:  { unitPrice: true },
        take:    1,
      },
    },
  });

  // Fetch first image per product (only select needed fields)
  const productIds = products.map((p) => p.id);
  const firstImages = productIds.length > 0
    ? await prisma.productColorImage.findMany({
        where: { productId: { in: productIds } },
        orderBy: { order: "asc" },
        select: { productId: true, path: true },
      })
    : [];
  const firstImageMap = new Map<string, string>();
  for (const img of firstImages) {
    if (!firstImageMap.has(img.productId)) firstImageMap.set(img.productId, img.path);
  }

  // Sort by relevance: reference match first, then name, then others
  const qLower = q.toLowerCase();
  const scored = products.map((p) => {
    let score = 0;
    if (p.reference.toLowerCase().includes(qLower)) score = 4;
    else if (p.name.toLowerCase().includes(qLower)) score = 3;
    else if (p.category.name.toLowerCase().includes(qLower)) score = 2;
    else score = 1;
    return { ...p, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const results = scored.map(({ score: _, ...p }) => ({
    id: p.id,
    name: p.name,
    reference: p.reference,
    category: p.category.name,
    image: firstImageMap.get(p.id) ?? null,
    price: p.colors[0] ? Number(p.colors[0].unitPrice) : null,
  }));

  return NextResponse.json({ results });
}
