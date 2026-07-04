import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/orders/compensation-search?q=xxx
 * Recherche produits + variantes pour ajouter un article en compensation.
 * Retourne les ProductColor (variantes) ONLINE avec image, prix catalogue, stock.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json({ variants: [] });

  const variants = await prisma.productColor.findMany({
    where: {
      disabled: false,
      product: {
        status: "ONLINE",
        OR: [
          { reference: { contains: q } },
          { name: { contains: q } },
        ],
      },
    },
    take: 20,
    orderBy: { product: { name: "asc" } },
    select: {
      id: true,
      unitPrice: true,
      stock: true,
      saleType: true,
      packQuantity: true,
      product: {
        select: { id: true, name: true, reference: true },
      },
      images: {
        orderBy: { order: "asc" },
        take: 1,
        select: { path: true },
      },
      color: {
        select: { name: true, hex: true, patternImage: true },
      },
    },
  });

  const results = variants.map((v) => ({
    id: v.id,
    productId: v.product.id,
    productName: v.product.name,
    productRef: v.product.reference,
    colorName: v.color?.name ?? "Standard",
    colorHex: v.color?.hex ?? null,
    colorPattern: v.color?.patternImage ?? null,
    saleType: v.saleType,
    packQuantity: v.packQuantity,
    unitPrice: Number(v.unitPrice),
    stock: v.stock,
    image: v.images[0]?.path ?? null,
  }));

  return NextResponse.json({ variants: results });
}
