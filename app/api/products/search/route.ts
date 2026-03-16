import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/products/search?q=xxx
 * Recherche rapide pour la barre de recherche du header.
 * Priorité : référence > nom > description > catégorie > mots-clés
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { reference: { contains: q } },
        { name: { contains: q } },
        { description: { contains: q } },
        { category: { name: { contains: q } } },
        { tags: { some: { tag: { name: { contains: q.toLowerCase() } } } } },
      ],
    },
    take: 8,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      reference: true,
      category: { select: { name: true } },
      colors: {
        orderBy: { isPrimary: "desc" },
        select: {
          unitPrice: true,
          images: { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
        },
        take: 1,
      },
    },
  });

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
    image: p.colors[0]?.images[0]?.path ?? null,
    price: p.colors[0]?.unitPrice ?? null,
  }));

  return NextResponse.json({ results });
}
