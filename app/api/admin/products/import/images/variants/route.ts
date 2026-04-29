import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/products/import/images/variants?reference=XXX
 * Returns grouped color variants for a product (grouped by groupKey to avoid UNIT/PACK duplicates).
 *
 * POST /api/admin/products/import/images/variants
 * Create a new variant on a product with given color IDs and attributes.
 * body: { reference, colorIds: string[], unitPrice, weight, stock, saleType, packQuantity?, size? }
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const reference = req.nextUrl.searchParams.get("reference")?.toUpperCase();
  if (!reference) {
    return NextResponse.json({ error: "Référence requise." }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { reference },
    include: {
      colors: {
        include: {
          color: true,
        },
      },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });
  }

  // Group by colorId to avoid UNIT/PACK duplicates
  const grouped = new Map<string, { id: string; name: string; hex: string; patternImage: string | null; colorNames: string }>();
  for (const pc of product.colors) {
    if (!pc.color || !pc.colorId) continue;
    const groupKey = pc.colorId;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        id: pc.id,
        name: pc.color.name,
        hex: pc.color.hex ?? "#9CA3AF",
        patternImage: pc.color.patternImage ?? null,
        colorNames: pc.color.name,
      });
    }
  }

  return NextResponse.json({
    productId: product.id,
    productName: product.name,
    variants: [...grouped.values()],
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body: {
    reference: string;
    colorIds: string[];
    unitPrice: number;
    weight: number;
    stock: number;
    saleType: "UNIT" | "PACK";
    packQuantity?: number;
    size?: string;
  } = await req.json();

  if (!body.reference || !body.colorIds?.length) {
    return NextResponse.json({ error: "Référence et couleurs requises." }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { reference: body.reference.toUpperCase() } });
  if (!product) {
    return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });
  }

  const [mainColorId] = body.colorIds;

  try {
    const variant = await prisma.productColor.create({
      data: {
        productId: product.id,
        colorId: mainColorId,
        unitPrice: body.unitPrice,
        weight: body.weight,
        stock: body.stock,
        isPrimary: false,
        saleType: body.saleType,
        packQuantity: body.saleType === "PACK" ? (body.packQuantity || null) : null,
      },
      include: {
        color: true,
      },
    });

    const mainColorName = variant.color?.name ?? "";

    return NextResponse.json({
      ok: true,
      variant: {
        id: variant.id,
        name: mainColorName,
        hex: variant.color?.hex ?? "#9CA3AF",
        patternImage: variant.color?.patternImage ?? null,
        colorNames: mainColorName,
      },
    });
  } catch (err) {
    logger.error("[variants/POST]", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 500 });
  }
}
