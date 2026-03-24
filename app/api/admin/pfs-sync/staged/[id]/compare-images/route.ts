import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// GET — Return existing product images grouped by color
// Used when a staged product has existsInDb=true
// ─────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  const { id } = await params;

  // 1. Find the staged product
  const staged = await prisma.pfsStagedProduct.findUnique({
    where: { id },
    select: { existingProductId: true },
  });

  if (!staged) {
    return NextResponse.json(
      { error: "Produit stage introuvable" },
      { status: 404 }
    );
  }

  if (!staged.existingProductId) {
    return NextResponse.json(
      { error: "Ce produit stage n'a pas de produit existant associe" },
      { status: 400 }
    );
  }

  // 2. Fetch the existing product's color variants with images
  const productColors = await prisma.productColor.findMany({
    where: { productId: staged.existingProductId },
    select: {
      colorId: true,
      color: {
        select: {
          name: true,
          hex: true,
        },
      },
      images: {
        select: {
          id: true,
          path: true,
          order: true,
        },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // 3. Group images by colorId (multiple variants can share the same color)
  const colorMap = new Map<
    string,
    {
      colorId: string;
      colorName: string;
      colorHex: string | null;
      images: Array<{ id: string; path: string; order: number }>;
    }
  >();

  for (const pc of productColors) {
    if (!pc.colorId || !pc.color) continue;
    const existing = colorMap.get(pc.colorId);
    if (existing) {
      // Merge images, avoiding duplicates by id
      const existingIds = new Set(existing.images.map((img) => img.id));
      for (const img of pc.images) {
        if (!existingIds.has(img.id)) {
          existing.images.push(img);
        }
      }
    } else {
      colorMap.set(pc.colorId, {
        colorId: pc.colorId,
        colorName: pc.color.name,
        colorHex: pc.color.hex,
        images: [...pc.images],
      });
    }
  }

  // Sort images within each group by order
  const existingImages = Array.from(colorMap.values()).map((group) => ({
    ...group,
    images: group.images.sort((a, b) => a.order - b.order),
  }));

  return NextResponse.json({ existingImages });
}
