import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/products/[id]
 * Returns a single product in the serialized format used by AdminProductsTable.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { name: true } },
      subCategories: { select: { name: true }, take: 1 },
      colors: {
        select: {
          id: true,
          colorId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          color: { select: { name: true, hex: true, patternImage: true } },
          variantSizes: { select: { quantity: true, size: { select: { name: true } } } },
        },
      },
      translations: { select: { locale: true } },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });
  }

  // Get first image
  const firstImage = await prisma.productColorImage.findFirst({
    where: { productId: product.id },
    orderBy: { order: "asc" },
    select: { path: true },
  });

  const serialized = {
    id: product.id,
    reference: product.reference,
    name: product.name,
    status: product.status as "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING",
    isIncomplete: product.isIncomplete,
    categoryName: product.category.name,
    subCategoryName: product.subCategories[0]?.name ?? null,
    createdAt: product.createdAt.toISOString(),
    firstImage: firstImage?.path ?? null,
    colors: product.colors.map((c) => ({
      id: c.id,
      colorId: c.colorId ?? "",
      unitPrice: Number(c.unitPrice),
      weight: c.weight,
      stock: c.stock,
      isPrimary: c.isPrimary,
      saleType: c.saleType as "UNIT" | "PACK",
      packQuantity: c.packQuantity,
      variantSizes: c.variantSizes,
      color: c.color ?? { name: "—", hex: null, patternImage: null },
    })),
    translations: product.translations,
  };

  return NextResponse.json(serialized);
}
