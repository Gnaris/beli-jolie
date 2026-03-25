import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// GET — Return full existing BJ product for comparison with staged PFS product
// ─────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  // 1. Find the staged product
  const staged = await prisma.pfsStagedProduct.findUnique({
    where: { id },
  });

  if (!staged) {
    return NextResponse.json(
      { error: "Produit stagé introuvable" },
      { status: 404 }
    );
  }

  const existingProductId = staged.existingProductId;
  if (!existingProductId) {
    return NextResponse.json(
      { error: "Ce produit stagé n'a pas de produit existant associé" },
      { status: 400 }
    );
  }

  // 2. Fetch existing product with ALL relations
  const existing = await prisma.product.findUnique({
    where: { id: existingProductId },
    include: {
      category: { select: { id: true, name: true } },
      colors: {
        include: {
          color: { select: { id: true, name: true, hex: true, patternImage: true } },
          subColors: {
            include: {
              color: { select: { id: true, name: true, hex: true, patternImage: true } },
            },
            orderBy: { position: "asc" },
          },
          variantSizes: { select: { size: { select: { name: true } } } },
          images: {
            select: { id: true, path: true, order: true },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      compositions: {
        include: {
          composition: { select: { id: true, name: true } },
        },
      },
      tags: {
        include: {
          tag: { select: { id: true, name: true } },
        },
      },
      manufacturingCountry: { select: { id: true, name: true } },
      season: { select: { id: true, name: true } },
    },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Le produit existant a été supprimé" },
      { status: 404 }
    );
  }

  // 3. Format response to match staged product structure for easy comparison
  const existingFormatted = {
    id: existing.id,
    reference: existing.reference,
    name: existing.name,
    description: existing.description,
    categoryId: existing.category.id,
    categoryName: existing.category.name,
    isBestSeller: existing.isBestSeller,
    status: existing.status,
    variants: existing.colors.filter((pc) => pc.color).map((pc) => ({
      id: pc.id,
      colorId: pc.color!.id,
      colorName: pc.color!.name,
      colorHex: pc.color!.hex,
      colorPatternImage: pc.color!.patternImage,
      subColors: pc.subColors.map((sc) => ({
        colorId: sc.color.id,
        colorName: sc.color.name,
        hex: sc.color.hex,
        patternImage: sc.color.patternImage,
      })),
      unitPrice: pc.unitPrice,
      weight: pc.weight,
      stock: pc.stock,
      saleType: pc.saleType,
      packQuantity: pc.packQuantity,
      sizeName: pc.variantSizes?.[0]?.size.name ?? null,
      isPrimary: pc.isPrimary,
      discountType: pc.discountType,
      discountValue: pc.discountValue,
    })),
    imagesByColor: (() => {
      // Group images by color (using colorId + sub-colors as key)
      const groups = new Map<string, {
        colorId: string;
        colorName: string;
        colorHex: string | null;
        colorPatternImage: string | null;
        subColors: Array<{ colorId: string; colorName: string; hex: string | null; patternImage: string | null }>;
        paths: string[];
      }>();

      for (const pc of existing.colors) {
        if (!pc.color) continue;
        const subKey = pc.subColors.map((sc) => sc.color.name).join(",");
        const groupKey = `${pc.color.id}::${subKey}`;

        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            colorId: pc.color.id,
            colorName: pc.color.name,
            colorHex: pc.color.hex,
            colorPatternImage: pc.color.patternImage,
            subColors: pc.subColors.map((sc) => ({
              colorId: sc.color.id,
              colorName: sc.color.name,
              hex: sc.color.hex,
              patternImage: sc.color.patternImage,
            })),
            paths: [],
          });
        }

        const group = groups.get(groupKey)!;
        for (const img of pc.images) {
          if (!group.paths.includes(img.path)) {
            group.paths.push(img.path);
          }
        }
      }

      return Array.from(groups.values());
    })(),
    compositions: existing.compositions.map((pc) => ({
      compositionId: pc.composition.id,
      name: pc.composition.name,
      percentage: pc.percentage,
    })),
    manufacturingCountryId: existing.manufacturingCountryId || null,
    manufacturingCountryName: existing.manufacturingCountry?.name || null,
    seasonId: existing.seasonId || null,
    seasonName: existing.season?.name || null,
    tags: existing.tags.map((pt) => pt.tag.name),
  };

  // 4. Parse staged product JSON fields
  const stagedFormatted = {
    id: staged.id,
    reference: staged.reference,
    pfsReference: staged.pfsReference,
    name: staged.name,
    description: staged.description,
    categoryId: staged.categoryId,
    categoryName: staged.categoryName,
    isBestSeller: staged.isBestSeller,
    status: staged.status,
    variants: typeof staged.variants === "string"
      ? JSON.parse(staged.variants)
      : staged.variants ?? [],
    compositions: typeof staged.compositions === "string"
      ? JSON.parse(staged.compositions)
      : staged.compositions ?? [],
    imagesByColor: typeof staged.imagesByColor === "string"
      ? JSON.parse(staged.imagesByColor)
      : staged.imagesByColor ?? [],
    manufacturingCountryId: staged.manufacturingCountryId || null,
    manufacturingCountryName: staged.manufacturingCountryName || null,
    seasonId: staged.seasonId || null,
    seasonName: staged.seasonName || null,
    tags: typeof staged.tags === "string"
      ? JSON.parse(staged.tags)
      : staged.tags ?? [],
    differences: typeof staged.differences === "string"
      ? JSON.parse(staged.differences)
      : staged.differences ?? [],
  };

  return NextResponse.json({
    existing: existingFormatted,
    staged: stagedFormatted,
  });
}
