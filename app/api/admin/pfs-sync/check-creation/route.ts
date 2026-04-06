import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsCheckReference } from "@/lib/pfs-api";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/pfs-sync/check-creation
 * Body: { reference: string, productId?: string }
 *
 * Checks whether a product can be created on PFS or already exists.
 * Returns:
 *   - existsOnPfs: boolean (reference already exists on PFS)
 *   - pfsProductId: string | null (if found)
 *   - canCreate: boolean (mappings OK for creation)
 *   - mappingIssues: string[] (blocking issues)
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await req.json();
  const { reference, productId } = body as { reference?: string; productId?: string };

  if (!reference?.trim()) {
    return NextResponse.json({ error: "Référence requise" }, { status: 400 });
  }

  try {
    // 1. Check if product already exists on PFS via reference
    let existsOnPfs = false;
    let pfsProductId: string | null = null;

    try {
      const refCheck = await pfsCheckReference(reference);
      if (refCheck?.product?.id) {
        existsOnPfs = true;
        pfsProductId = refCheck.product.id;
      }
    } catch {
      // checkReference failed — assume not on PFS
    }

    // 2. If productId provided, check mapping issues (same logic as modifier page)
    const mappingIssues: string[] = [];

    if (productId) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          category: true,
          manufacturingCountry: true,
          season: true,
          compositions: { include: { composition: true } },
          colors: {
            include: {
              color: true,
              subColors: { include: { color: true } },
              variantSizes: { include: { size: { include: { pfsMappings: { select: { pfsSizeRef: true } } } } } },
              packColorLines: { include: { colors: { include: { color: true } } } },
            },
          },
        },
      });

      if (product) {
        // Category
        if (!product.category?.pfsCategoryId) {
          mappingIssues.push(`Catégorie "${product.category?.name ?? "?"}" sans correspondance`);
        }
        // Compositions
        for (const c of product.compositions) {
          if (!c.composition.pfsCompositionRef) {
            mappingIssues.push(`Composition "${c.composition.name}" sans correspondance`);
          }
        }
        // Colors & sizes
        const seenColorIds = new Set<string>();
        const seenSizeIds = new Set<string>();
        for (const variant of product.colors) {
          const hasOverride = !!variant.pfsColorRef;
          const isMultiColor = variant.subColors.length > 0;
          const packDistinctColors = variant.saleType === "PACK"
            ? new Set(variant.packColorLines.flatMap((l) => l.colors.map((c) => c.colorId)))
            : new Set<string>();
          const isPackMultiColor = packDistinctColors.size > 1;

          if (!hasOverride && (isMultiColor || isPackMultiColor)) {
            const colorNames = isMultiColor
              ? [variant.color?.name, ...variant.subColors.map((sc) => sc.color.name)].filter(Boolean).join(" + ")
              : variant.packColorLines.flatMap((l) => l.colors.map((c) => c.color.name)).join(" + ");
            mappingIssues.push(`Variante multi-couleur "${colorNames}" sans correspondance PFS`);
          }

          if (!hasOverride && variant.colorId && variant.color && !seenColorIds.has(variant.colorId)) {
            seenColorIds.add(variant.colorId);
            if (!variant.color.pfsColorRef) mappingIssues.push(`Couleur "${variant.color.name}" sans correspondance`);
          }
          if (!hasOverride) {
            for (const sc of variant.subColors) {
              if (!seenColorIds.has(sc.colorId)) {
                seenColorIds.add(sc.colorId);
                if (!sc.color.pfsColorRef) mappingIssues.push(`Couleur "${sc.color.name}" sans correspondance`);
              }
            }
            for (const pcl of variant.packColorLines) {
              for (const c of pcl.colors) {
                if (!seenColorIds.has(c.colorId)) {
                  seenColorIds.add(c.colorId);
                  if (!c.color.pfsColorRef) mappingIssues.push(`Couleur "${c.color.name}" sans correspondance`);
                }
              }
            }
          }
          for (const vs of variant.variantSizes) {
            if (!seenSizeIds.has(vs.sizeId)) {
              seenSizeIds.add(vs.sizeId);
              if (!vs.size.pfsMappings || vs.size.pfsMappings.length === 0) {
                mappingIssues.push(`Taille "${vs.size.name}" sans correspondance`);
              }
            }
          }
        }
        // Country
        if (product.manufacturingCountry && !product.manufacturingCountry.pfsCountryRef) {
          mappingIssues.push(`Pays "${product.manufacturingCountry.name}" sans correspondance`);
        }
        // Season
        if (product.season && !product.season.pfsRef) {
          mappingIssues.push(`Saison "${product.season.name}" sans correspondance`);
        }
      }
    }

    const canCreate = mappingIssues.length === 0;

    return NextResponse.json({
      existsOnPfs,
      pfsProductId,
      canCreate,
      mappingIssues,
    });
  } catch (err) {
    logger.error("[PFS Check Creation] Failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Erreur lors de la vérification PFS" }, { status: 500 });
  }
}
