import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/products/[id]/live — fetch a single product in the same shape as the listing API.
 * Used by SSE clients to refresh a product card after a real-time event.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category:      { select: { name: true } },
      subCategories: { select: { name: true }, take: 1 },
      tags:          { include: { tag: { select: { id: true, name: true } } } },
      colors: {
        select: {
          id: true, colorId: true, unitPrice: true, stock: true,
          isPrimary: true, saleType: true, packQuantity: true,
          color: { select: { name: true, hex: true, patternImage: true } },
          subColors: { orderBy: { position: "asc" }, select: { color: { select: { name: true, hex: true, patternImage: true } } } },
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

  // Group variants by groupKey
  const colorMap = new Map<string, Record<string, unknown>>();
  for (const v of product.colors) {
    if (!v.colorId) continue;
    const subNames = v.subColors?.map((sc) => sc.color.name) ?? [];
    const gk = subNames.length === 0 ? v.colorId : `${v.colorId}::${subNames.join(",")}`;

    if (!colorMap.has(gk)) {
      const subs = v.subColors?.map((sc) => ({ name: sc.color.name, hex: sc.color.hex ?? "#9CA3AF", patternImage: sc.color.patternImage })) ?? [];
      colorMap.set(gk, {
        groupKey: gk, colorId: v.colorId, name: v.color?.name,
        hex: v.color?.hex, patternImage: v.color?.patternImage,
        subColors: subs.length > 0 ? subs : undefined,
        firstImage: imageByVariant.get(v.id) ?? null,
        unitPrice: Number(v.unitPrice), isPrimary: v.isPrimary, totalStock: 0,
        variants: [],
      });
    }
    const cd = colorMap.get(gk)! as { firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number; variants: unknown[] };
    if (!cd.firstImage) cd.firstImage = imageByVariant.get(v.id) ?? null;
    cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
    cd.totalStock += v.stock ?? 0;
    if (v.isPrimary) cd.isPrimary = true;
    cd.variants.push({
      id: v.id, saleType: v.saleType, packQuantity: v.packQuantity,
      sizes: (v.variantSizes ?? []).map((vs: any) => ({ name: vs.size.name, quantity: vs.quantity })),
      unitPrice: Number(v.unitPrice), stock: v.stock ?? 0,
    });
  }

  return NextResponse.json({
    product: {
      id: product.id,
      name: product.name,
      reference: product.reference,
      isBestSeller: product.isBestSeller,
      discountPercent: product.discountPercent != null ? Number(product.discountPercent) : null,
      createdAt: product.createdAt,
      category: product.category,
      subCategories: product.subCategories,
      tags: product.tags,
      colors: [...colorMap.values()],
      status: product.status,
    },
  });
}
