import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/orders/product-search?q=xxx
 * Recherche produits par référence ou nom, retourne chaque produit avec
 * TOUTES ses variantes détaillées (couleur, saleType, prix, stock, tailles).
 * Utilisée pour l'ajout d'article en compensation dans une commande.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json({ products: [] });

  // Recherche EXACTE sur la référence uniquement (pas de contains, pas de préfixe/suffixe).
  const products = await prisma.product.findMany({
    where: {
      status: "ONLINE",
      reference: { equals: q },
    },
    take: 12,
    orderBy: { reference: "asc" },
    select: {
      id: true,
      reference: true,
      name: true,
      category: { select: { name: true } },
      colors: {
        where: { disabled: false },
        orderBy: { isPrimary: "desc" },
        select: {
          id: true,
          unitPrice: true,
          stock: true,
          saleType: true,
          packQuantity: true,
          isPrimary: true,
          color: {
            select: { id: true, name: true, hex: true, patternImage: true },
          },
          images: {
            orderBy: { order: "asc" },
            take: 1,
            select: { path: true },
          },
          variantSizes: {
            select: {
              quantity: true,
              pricePerUnit: true,
              size: { select: { id: true, name: true, position: true } },
            },
          },
        },
      },
    },
  });

  const results = products.map((p) => ({
    id: p.id,
    reference: p.reference,
    name: p.name,
    category: p.category?.name ?? null,
    variants: p.colors.map((v) => ({
      id: v.id,
      colorName: v.color?.name ?? "Standard",
      colorHex: v.color?.hex ?? null,
      colorPattern: v.color?.patternImage ?? null,
      saleType: v.saleType,
      packQuantity: v.packQuantity,
      isPrimary: v.isPrimary,
      unitPrice: Number(v.unitPrice),
      stock: v.stock,
      image: v.images[0]?.path ?? null,
      sizes: v.variantSizes
        .sort((a, b) => (a.size.position ?? 0) - (b.size.position ?? 0))
        .map((s) => ({
          id: s.size.id,
          name: s.size.name,
          maxQuantity: s.quantity, // stock par taille (PACK) ou 1 (UNIT)
          pricePerUnit: s.pricePerUnit ? Number(s.pricePerUnit) : null,
        })),
    })),
  }));

  return NextResponse.json({ products: results });
}
