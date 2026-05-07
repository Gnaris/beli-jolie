import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";
import { canSeePrices } from "@/lib/price-visibility";

/**
 * GET /api/products/[id]/live — fetch a single product in the same shape as the listing API.
 * Used by SSE clients to refresh a product card after a real-time event.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const showPrices = canSeePrices(session);

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category:      { select: { name: true } },
      subCategories: { select: { name: true }, take: 1 },
      tags:          { include: { tag: { select: { id: true, name: true } } } },
      colors: {
        where: { disabled: false },
        select: {
          id: true, colorId: true, unitPrice: true, stock: true,
          isPrimary: true, saleType: true, packQuantity: true,
          color: { select: { name: true, hex: true, patternImage: true } },
          variantSizes: { orderBy: { size: { position: "asc" } }, include: { size: true } },
        },
      },
    },
  });

  if (!product) {
    return NextResponse.json({ product: null });
  }

  // Fetch images
  const colorImages = await prisma.productColorImage.findMany({
    where: { productId: id },
    orderBy: { order: "asc" },
    select: { productColorId: true, path: true },
  });
  const imageByVariant = new Map<string, string>();
  for (const img of colorImages) {
    if (img.productColorId && !imageByVariant.has(img.productColorId)) {
      imageByVariant.set(img.productColorId, img.path);
    }
  }

  // Determine the primary color via helper (Product.primaryColorId + fallback)
  const primaryColorId = getProductPrimaryColorId({
    primaryColorId: product.primaryColorId,
    colors: product.colors,
  });

  // Group variants by groupKey
  const colorMap = new Map<string, Record<string, unknown>>();
  for (const v of product.colors) {
    if (!v.colorId) continue;
    const gk = v.colorId;

    if (!colorMap.has(gk)) {
      colorMap.set(gk, {
        groupKey: gk, colorId: v.colorId, name: v.color?.name,
        hex: v.color?.hex, patternImage: v.color?.patternImage,
        firstImage: imageByVariant.get(v.id) ?? null,
        unitPrice: Number(v.unitPrice),
        isPrimary: primaryColorId != null && v.colorId === primaryColorId,
        totalStock: 0,
        variants: [],
      });
    }
    const cd = colorMap.get(gk)! as { firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number; variants: unknown[] };
    if (!cd.firstImage) cd.firstImage = imageByVariant.get(v.id) ?? null;
    cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
    cd.totalStock += v.stock ?? 0;
    if (primaryColorId != null && v.colorId === primaryColorId) cd.isPrimary = true;
    cd.variants.push({
      id: v.id, saleType: v.saleType, packQuantity: v.packQuantity,
      sizes: (v.variantSizes ?? []).map((vs: any) => ({ name: vs.size.name, quantity: vs.quantity })),
      unitPrice: Number(v.unitPrice), stock: v.stock ?? 0,
    });
  }

  let colors = [...colorMap.values()];
  let discountPercent = product.discountPercent != null ? Number(product.discountPercent) : null;
  if (!showPrices) {
    discountPercent = null;
    colors = colors.map((c) => {
      const color = c as { unitPrice: number; variants: Array<{ unitPrice: number }> };
      return {
        ...color,
        unitPrice: 0,
        variants: color.variants.map((v) => ({ ...v, unitPrice: 0 })),
      };
    });
  }

  return NextResponse.json({
    product: {
      id: product.id,
      name: product.name,
      reference: product.reference,
      isBestSeller: product.isBestSeller,
      discountPercent,
      createdAt: product.createdAt,
      category: product.category,
      subCategories: product.subCategories,
      tags: product.tags,
      colors,
      status: product.status,
    },
  });
}
