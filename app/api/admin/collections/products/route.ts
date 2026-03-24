import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/collections/products
 * Liste tous les produits (ADMIN) pour l'ajout dans une collection.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const products = await prisma.product.findMany({
    where: { status: "ONLINE" },
    orderBy: { name: "asc" },
    take: 500, // Pagination: limit to 500 products max
    select: {
      id:        true,
      name:      true,
      reference: true,
      colors: {
        select: {
          id:        true,
          colorId:   true,
          isPrimary: true,
          color:     { select: { name: true, hex: true } },
        },
      },
    },
  });

  // Fetch one image per (productId, colorId)
  const productIds = products.map((p) => p.id);
  const colorImages = productIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: productIds } }, orderBy: { order: "asc" } })
    : [];
  const imageMap = new Map<string, Map<string, string>>();
  for (const img of colorImages) {
    if (!imageMap.has(img.productId)) imageMap.set(img.productId, new Map());
    const cm = imageMap.get(img.productId)!;
    if (!cm.has(img.colorId)) cm.set(img.colorId, img.path);
  }

  // Deduplicate colors by colorId
  const shaped = products.map((p) => {
    const colorMap = new Map<string, { id: string; name: string; hex: string | null; images: { path: string }[] }>();
    for (const pc of p.colors) {
      if (pc.colorId && !colorMap.has(pc.colorId)) {
        const path = imageMap.get(p.id)?.get(pc.colorId);
        colorMap.set(pc.colorId, { id: pc.colorId, name: pc.color?.name ?? "", hex: pc.color?.hex ?? null, images: path ? [{ path }] : [] });
      }
    }
    return { id: p.id, name: p.name, reference: p.reference, colors: [...colorMap.values()] };
  });

  return NextResponse.json(shaped);
}
