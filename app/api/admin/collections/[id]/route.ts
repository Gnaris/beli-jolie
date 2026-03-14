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
                  isPrimary: true,
                  color:     { select: { name: true, hex: true } },
                  images:    { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
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

  // Reshape for the client
  const shaped = {
    id:    collection.id,
    name:  collection.name,
    image: collection.image,
    products: collection.products.map((cp) => ({
      productId: cp.productId,
      colorId:   cp.colorId,
      position:  cp.position,
      product: {
        id:        cp.product.id,
        name:      cp.product.name,
        reference: cp.product.reference,
        colors:    cp.product.colors.map((pc) => ({
          id:     pc.id,
          name:   pc.color.name,
          hex:    pc.color.hex,
          images: pc.images,
        })),
      },
    })),
  };

  return NextResponse.json(shaped);
}
