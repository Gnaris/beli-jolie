import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/products/search?q=xxx&exclude=productId
 * Recherche produits pour le sélecteur de produits similaires (admin).
 * Renvoie les produits avec image principale, référence, catégorie.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const exclude = request.nextUrl.searchParams.get("exclude") ?? "";

  if (q.length < 1) return NextResponse.json({ products: [] });

  const products = await prisma.product.findMany({
    where: {
      ...(exclude && { NOT: { id: exclude } }),
      OR: [
        { reference: { contains: q } },
        { name: { contains: q } },
      ],
    },
    take: 12,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      reference: true,
      category: { select: { name: true } },
      colors: {
        orderBy: { isPrimary: "desc" },
        select: {
          images: { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
        },
        take: 1,
      },
    },
  });

  const results = products.map((p) => ({
    id: p.id,
    name: p.name,
    reference: p.reference,
    category: p.category.name,
    image: p.colors[0]?.images[0]?.path ?? null,
  }));

  return NextResponse.json({ products: results });
}
