import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  pfsGetVariants,
  pfsCheckReference,
  type PfsVariantDetail,
  type PfsCheckReferenceResponse,
} from "@/lib/pfs-api";
import {
  stripVersionSuffix,
  parsePfsCategoryRef,
  fullSizeImageUrl,
  extractColorImages,
  detectDefaultColorRef,
  findOrCreateColor,
  findOrCreateCategory,
  findOrCreateComposition,
  findOrCreateCountry,
  findOrCreateSeason,
} from "@/lib/pfs-sync";
import { stripDimensionsSuffix } from "@/lib/pfs-reverse-sync";

// ─────────────────────────────────────────────
// GET — Fetch live PFS data for a product and compare with BJ
// ─────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { productId } = await params;

  // 1. Fetch BJ product with all relations
  const product = await prisma.product.findUnique({
    where: { id: productId },
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
      manufacturingCountry: { select: { id: true, name: true } },
      season: { select: { id: true, name: true } },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });
  }

  // 2. If no pfsProductId, check if product exists on PFS via reference
  if (!product.pfsProductId) {
    try {
      const refCheck = await pfsCheckReference(product.reference);
      if (!refCheck?.product?.id) {
        return NextResponse.json(
          { error: "Produit absent de PFS", notOnPfs: true },
          { status: 400 }
        );
      }
      // Product exists on PFS — link it and continue
      await prisma.product.update({
        where: { id: productId },
        data: { pfsProductId: refCheck.product.id },
      });
      product.pfsProductId = refCheck.product.id;
    } catch {
      return NextResponse.json(
        { error: "Produit absent de PFS", notOnPfs: true },
        { status: 400 }
      );
    }
  }

  // 3. Fetch PFS data (variants + reference details)
  let variantDetails: PfsVariantDetail[] = [];
  let refDetails: PfsCheckReferenceResponse | null = null;

  try {
    const [variantsResult, refResult] = await Promise.allSettled([
      pfsGetVariants(product.pfsProductId!),
      pfsCheckReference(product.reference),
    ]);

    variantDetails = variantsResult.status === "fulfilled"
      ? (variantsResult.value.data ?? [])
      : [];

    refDetails = refResult.status === "fulfilled"
      ? refResult.value
      : null;
  } catch (err) {
    return NextResponse.json(
      { error: `Erreur API PFS: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  if (variantDetails.length === 0 && !refDetails) {
    return NextResponse.json(
      { error: "Impossible de récupérer les données PFS" },
      { status: 502 }
    );
  }

  // 3. Map PFS data to comparison format
  const pfsRef = variantDetails[0]?.reference ?? product.reference;

  // Process all variants, marking inactive ones
  const allVariants = variantDetails;
  if (allVariants.length === 0 && !refDetails) {
    return NextResponse.json(
      { error: "Aucune variante trouvée sur PFS" },
      { status: 404 }
    );
  }
  const bjRef = stripVersionSuffix(pfsRef);

  // Category — always create if missing so it appears in comparison
  let pfsCategoryName = "";
  let pfsCategoryId = "";
  if (refDetails?.product?.category?.reference) {
    const rawCatRef = refDetails.product.category.reference;
    pfsCategoryName = parsePfsCategoryRef(rawCatRef);
    try {
      pfsCategoryId = await findOrCreateCategory(
        pfsCategoryName,
        undefined,
        rawCatRef,
      ) ?? "";
    } catch (err) {
      // Still show the category name in comparison even if creation failed
      console.error("[LIVE_CHECK] Category lookup failed:", err);
      pfsCategoryId = "";
    }
  }

  // Compositions
  const pfsCompositions: Array<{ compositionId: string; name: string; percentage: number }> = [];
  if (refDetails?.product?.material_composition) {
    for (const mat of refDetails.product.material_composition) {
      const frName = mat.labels?.fr || mat.reference;
      try {
        const compositionId = await findOrCreateComposition(frName, mat.labels) ?? "";
        pfsCompositions.push({ compositionId, name: frName, percentage: mat.percentage });
      } catch {
        pfsCompositions.push({ compositionId: "", name: frName, percentage: mat.percentage });
      }
    }
  }

  // Country
  let pfsCountryId = "";
  let pfsCountryName = "";
  if (refDetails?.product?.country_of_manufacture) {
    const isoCode = refDetails.product.country_of_manufacture;
    pfsCountryName = isoCode;
    try {
      pfsCountryId = await findOrCreateCountry(isoCode) || "";
    } catch { /* ignore */ }
  }

  // Season
  let pfsSeasonId = "";
  let pfsSeasonName = "";
  if (refDetails?.product?.collection) {
    const col = refDetails.product.collection;
    pfsSeasonName = col.labels?.fr || col.reference;
    try {
      pfsSeasonId = await findOrCreateSeason(col.reference, col.labels || {}) || "";
    } catch { /* ignore */ }
  }

  // Variants
  const pfsVariants: Array<{
    colorId: string;
    colorName: string;
    colorHex: string | null;
    colorPatternImage: string | null;
    subColors: Array<{ colorId: string; colorName: string; hex: string | null; patternImage: string | null }>;
    unitPrice: number;
    weight: number;
    stock: number;
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    sizeName: string | null;
    isPrimary: boolean;
    isActive: boolean;
    discountType: "PERCENT" | "AMOUNT" | null;
    discountValue: number | null;
  }> = [];

  // Detect default color
  const pfsImages = refDetails?.product?.images ?? {};
  const defaultColorRef = detectDefaultColorRef(
    pfsImages,
    refDetails?.product?.default_color,
  );

  for (const v of allVariants) {
    const weight = v.weight ?? 0;

    let discountType: "PERCENT" | "AMOUNT" | null = null;
    let discountValue: number | null = null;
    if (v.discount) {
      discountType = v.discount.type === "PERCENT" ? "PERCENT" : "AMOUNT";
      discountValue = v.discount.value;
    }

    if (v.type === "ITEM" && v.item) {
      let colorId = "";
      try {
        colorId = await findOrCreateColor(
          v.item.color.reference,
          v.item.color.value,
          v.item.color.labels,
        ) ?? "";
      } catch { /* ignore */ }

      pfsVariants.push({
        colorId,
        colorName: v.item.color.labels?.fr || v.item.color.reference,
        colorHex: v.item.color.value || null,
        colorPatternImage: v.item.color.image || null,
        subColors: [],
        unitPrice: v.price_sale.unit.value,
        weight,
        stock: v.is_active ? v.stock_qty : 0,
        saleType: "UNIT",
        packQuantity: null,
        sizeName: v.item.size || null,
        isPrimary: false,
        isActive: v.is_active,
        discountType,
        discountValue,
      });
    } else if (v.type === "PACK" && v.packs && v.packs.length > 0) {
      const pack = v.packs[0];
      let colorId = "";
      try {
        colorId = await findOrCreateColor(
          pack.color.reference,
          pack.color.value,
          pack.color.labels,
        ) ?? "";
      } catch { /* ignore */ }

      const packQty = v.pieces ?? pack.sizes?.[0]?.qty ?? 1;

      pfsVariants.push({
        colorId,
        colorName: pack.color.labels?.fr || pack.color.reference,
        colorHex: pack.color.value || null,
        colorPatternImage: pack.color.image || null,
        subColors: [],
        unitPrice: v.price_sale.unit.value,
        weight,
        stock: v.is_active ? v.stock_qty : 0,
        saleType: "PACK",
        packQuantity: packQty,
        sizeName: pack.sizes?.[0]?.size || null,
        isPrimary: false,
        isActive: v.is_active,
        discountType,
        discountValue,
      });
    }
  }

  // Set isPrimary
  if (defaultColorRef && pfsVariants.length > 0) {
    const primaryIdx = pfsVariants.findIndex((v) => {
      // Match by colorName containing the reference
      return v.colorName.toLowerCase().includes(defaultColorRef.toLowerCase());
    });
    if (primaryIdx >= 0) pfsVariants[primaryIdx].isPrimary = true;
    else pfsVariants[0].isPrimary = true;
  } else if (pfsVariants.length > 0) {
    pfsVariants[0].isPrimary = true;
  }

  // PFS Images by color
  const pfsImagesByColor = extractColorImages(pfsImages);
  const pfsImageGroups: Array<{
    colorId: string;
    colorName: string;
    colorHex: string | null;
    colorPatternImage: string | null;
    subColors: Array<{ colorId: string; colorName: string; hex: string | null; patternImage: string | null }>;
    paths: string[];
  }> = [];

  for (const [colorRef, urls] of pfsImagesByColor) {
    // Find matching variant for this color
    const matchingVariant = pfsVariants.find((v) =>
      v.colorName.toLowerCase().includes(colorRef.toLowerCase())
    );
    pfsImageGroups.push({
      colorId: matchingVariant?.colorId ?? "",
      colorName: matchingVariant?.colorName ?? colorRef,
      colorHex: matchingVariant?.colorHex ?? null,
      colorPatternImage: matchingVariant?.colorPatternImage ?? null,
      subColors: [],
      paths: urls.map((u) => fullSizeImageUrl(u)),
    });
  }

  // Name & description from PFS (strip dimensions suffix added by reverse sync)
  const pfsName = refDetails?.product?.label?.fr ?? bjRef;
  const pfsDescription = stripDimensionsSuffix(refDetails?.product?.description?.fr ?? "");

  // 4. Format BJ data
  const bjFormatted = {
    id: product.id,
    reference: product.reference,
    name: product.name,
    description: product.description,
    categoryId: product.category.id,
    categoryName: product.category.name,
    isBestSeller: product.isBestSeller,
    status: product.status,
    variants: product.colors.map((pc) => ({
      id: pc.id,
      colorId: pc.color?.id ?? pc.colorId ?? "",
      colorName: pc.color?.name ?? "",
      colorHex: pc.color?.hex ?? null,
      colorPatternImage: pc.color?.patternImage ?? null,
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
      const groups = new Map<string, {
        colorId: string;
        colorName: string;
        colorHex: string | null;
        colorPatternImage: string | null;
        subColors: Array<{ colorId: string; colorName: string; hex: string | null; patternImage: string | null }>;
        paths: string[];
      }>();

      for (const pc of product.colors) {
        if (!pc.colorId || !pc.color) continue;
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
    compositions: product.compositions.map((pc) => ({
      compositionId: pc.composition.id,
      name: pc.composition.name,
      percentage: pc.percentage,
    })),
    manufacturingCountryId: product.manufacturingCountry?.id || null,
    manufacturingCountryName: product.manufacturingCountry?.name || null,
    seasonId: product.season?.id || null,
    seasonName: product.season?.name || null,
  };

  const pfsFormatted = {
    id: product.pfsProductId,
    reference: bjRef,
    pfsReference: pfsRef,
    name: pfsName,
    description: pfsDescription,
    categoryId: pfsCategoryId,
    categoryName: pfsCategoryName,
    isBestSeller: false,
    status: "PFS",
    variants: pfsVariants,
    imagesByColor: pfsImageGroups,
    compositions: pfsCompositions,
    manufacturingCountryId: pfsCountryId || null,
    manufacturingCountryName: pfsCountryName || null,
    seasonId: pfsSeasonId || null,
    seasonName: pfsSeasonName || null,
  };

  // 5. Compute differences
  const differences: Array<{ field: string; pfsValue: unknown; bjValue: unknown }> = [];

  if (bjFormatted.name !== pfsFormatted.name && pfsFormatted.name) {
    differences.push({ field: "name", pfsValue: pfsFormatted.name, bjValue: bjFormatted.name });
  }
  if (bjFormatted.description !== pfsFormatted.description && pfsFormatted.description) {
    differences.push({ field: "description", pfsValue: pfsFormatted.description, bjValue: bjFormatted.description });
  }
  if (pfsCategoryName && (pfsCategoryId ? bjFormatted.categoryId !== pfsCategoryId : bjFormatted.categoryName !== pfsCategoryName)) {
    differences.push({ field: "category", pfsValue: pfsFormatted.categoryName, bjValue: bjFormatted.categoryName });
  }
  if (JSON.stringify(bjFormatted.compositions) !== JSON.stringify(pfsFormatted.compositions) && pfsFormatted.compositions.length > 0) {
    differences.push({ field: "compositions", pfsValue: pfsFormatted.compositions, bjValue: bjFormatted.compositions });
  }

  // Compare variants by color name + saleType
  for (const pfsV of pfsVariants) {
    const bjV = bjFormatted.variants.find(
      (v) => v.colorId === pfsV.colorId && v.saleType === pfsV.saleType
    );
    if (!bjV) {
      differences.push({ field: `variant_new_${pfsV.colorName}_${pfsV.saleType}`, pfsValue: pfsV, bjValue: null });
    } else {
      if (Math.abs(bjV.unitPrice - pfsV.unitPrice) > 0.01) {
        differences.push({ field: `price_${pfsV.colorName}_${pfsV.saleType}`, pfsValue: pfsV.unitPrice, bjValue: bjV.unitPrice });
      }
      if (bjV.stock !== pfsV.stock) {
        differences.push({ field: `stock_${pfsV.colorName}_${pfsV.saleType}`, pfsValue: pfsV.stock, bjValue: bjV.stock });
      }
      if (Math.abs(bjV.weight - pfsV.weight) > 0.01) {
        differences.push({ field: `weight_${pfsV.colorName}_${pfsV.saleType}`, pfsValue: pfsV.weight, bjValue: bjV.weight });
      }
    }
  }

  return NextResponse.json({
    existing: bjFormatted,
    pfs: pfsFormatted,
    differences,
    hasDifferences: differences.length > 0,
  });
}
