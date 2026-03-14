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
    orderBy: { name: "asc" },
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
  });

  const shaped = products.map((p) => ({
    id:        p.id,
    name:      p.name,
    reference: p.reference,
    colors:    p.colors.map((pc) => ({
      id:     pc.id,
      name:   pc.color.name,
      hex:    pc.color.hex,
      images: pc.images,
    })),
  }));

  return NextResponse.json(shaped);
}
