import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/collections/[id]
 * Détails d'une collection avec ses produits (ADMIN uniquement).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  const collection = await prisma.collection.findUnique({
    where: { id },
    include: {
      translations: true,
      products: {
        orderBy: { position: "asc" },
        include: {
          product: {
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
          },
        },
      },
    },
  });

  if (!collection) {
    return NextResponse.json({ error: "Collection introuvable." }, { status: 404 });
  }

  // Fetch images for products in collection
  const colProductIds = collection.products.map((cp) => cp.product.id);
  const colColorImages = colProductIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: colProductIds } }, orderBy: { order: "asc" } })
    : [];
  const colImageMap = new Map<string, Map<string, string>>();
  for (const img of colColorImages) {
    if (!colImageMap.has(img.productId)) colImageMap.set(img.productId, new Map());
    const cm = colImageMap.get(img.productId)!;
    if (!cm.has(img.colorId)) cm.set(img.colorId, img.path);
  }

  // Reshape for the client
  const translationsMap: Record<string, string> = {};
  for (const t of collection.translations) {
    translationsMap[t.locale] = t.name;
  }

  const shaped = {
    id:    collection.id,
    name:  collection.name,
    image: collection.image,
    translations: translationsMap,
    products: collection.products.map((cp) => {
      // Deduplicate colors by colorId
      const colorMap = new Map<string, { id: string; name: string; hex: string | null; images: { path: string }[] }>();
      for (const pc of cp.product.colors) {
        if (!colorMap.has(pc.colorId)) {
          const path = colImageMap.get(cp.product.id)?.get(pc.colorId);
          colorMap.set(pc.colorId, { id: pc.colorId, name: pc.color.name, hex: pc.color.hex, images: path ? [{ path }] : [] });
        }
      }
      return {
        productId: cp.productId,
        colorId:   cp.colorId,
        position:  cp.position,
        product: {
          id:        cp.product.id,
          name:      cp.product.name,
          reference: cp.product.reference,
          colors:    [...colorMap.values()],
        },
      };
    }),
  };

  return NextResponse.json(shaped);
}
