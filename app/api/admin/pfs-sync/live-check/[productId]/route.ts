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
import { logger } from "@/lib/logger";
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
import { pfsGetCategories, pfsGetColors, type PfsAttributeCategory } from "@/lib/pfs-api-write";

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
          variantSizes: { select: { size: { select: { name: true, pfsMappings: { select: { pfsSizeRef: true }, take: 1 } } }, quantity: true } },
          packColorLines: {
            include: {
              colors: {
                include: { color: { select: { id: true, name: true, hex: true, patternImage: true } } },
                orderBy: { position: "asc" },
              },
            },
            orderBy: { position: "asc" },
          },
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

  let pfsAllCategories: PfsAttributeCategory[] = [];
  // Reference → French label map for all PFS colors (used to display friendly names)
  const pfsColorLabelMap = new Map<string, string>();

  try {
    const [variantsResult, refResult, categoriesResult, colorsResult] = await Promise.allSettled([
      pfsGetVariants(product.pfsProductId!),
      pfsCheckReference(product.reference),
      pfsGetCategories(),
      pfsGetColors(),
    ]);

    variantDetails = variantsResult.status === "fulfilled"
      ? (variantsResult.value.data ?? [])
      : [];

    refDetails = refResult.status === "fulfilled"
      ? refResult.value
      : null;

    pfsAllCategories = categoriesResult.status === "fulfilled"
      ? categoriesResult.value
      : [];

    if (colorsResult.status === "fulfilled") {
      for (const c of colorsResult.value) {
        if (c.reference && c.labels?.fr) pfsColorLabelMap.set(c.reference, c.labels.fr);
      }
    }
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

  // Category — resolve French label from PFS categories API, fallback to hardcoded map
  let pfsCategoryName = "";
  let pfsCategoryId = "";
  let pfsCategoryPfsId = "";
  let pfsCategoryGender = "";
  let pfsCategoryFamilyId = "";
  if (refDetails?.product?.category) {
    const rawCatRef = refDetails.product.category.reference;
    const pfsProductCatId = refDetails.product.category.id;

    // Try to get French label + metadata from PFS categories API
    const matchedPfsCat = pfsAllCategories.find(c => c.id === pfsProductCatId);
    if (matchedPfsCat) {
      pfsCategoryName = matchedPfsCat.labels?.fr || parsePfsCategoryRef(rawCatRef);
      pfsCategoryPfsId = matchedPfsCat.id;
      pfsCategoryGender = matchedPfsCat.gender || "";
      pfsCategoryFamilyId = typeof matchedPfsCat.family === "object" ? matchedPfsCat.family.id : (matchedPfsCat.family || "");
    } else {
      pfsCategoryName = parsePfsCategoryRef(rawCatRef);
    }

    try {
      pfsCategoryId = await findOrCreateCategory(
        pfsCategoryName,
        undefined,
        rawCatRef,
        pfsProductCatId,
      ) ?? "";
    } catch (err) {
      // Still show the category name in comparison even if creation failed
      logger.error("[LIVE_CHECK] Category lookup failed", { error: err instanceof Error ? err.message : String(err) });
      pfsCategoryId = "";
    }
  }

  // Compositions
  const pfsCompositions: Array<{ compositionId: string; name: string; percentage: number; pfsRef: string }> = [];
  if (refDetails?.product?.material_composition) {
    for (const mat of refDetails.product.material_composition) {
      const frName = mat.labels?.fr || mat.reference;
      try {
        const compositionId = await findOrCreateComposition(frName, mat.labels, mat.reference) ?? "";
        pfsCompositions.push({ compositionId, name: frName, percentage: mat.percentage, pfsRef: mat.reference });
      } catch {
        pfsCompositions.push({ compositionId: "", name: frName, percentage: mat.percentage, pfsRef: mat.reference });
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
    pfsColorRef: string | null;
    pfsColorRefLabel: string | null;
    pfsVariantId: string | null;
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
        pfsColorRef: v.item.color.reference,
        pfsColorRefLabel: v.item.color.labels?.fr ?? pfsColorLabelMap.get(v.item.color.reference) ?? null,
        pfsVariantId: v.id,
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
        pfsColorRef: pack.color.reference,
        pfsColorRefLabel: pack.color.labels?.fr ?? pfsColorLabelMap.get(pack.color.reference) ?? null,
        pfsVariantId: v.id,
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
    // Find matching variant by pfsColorRef (exact), fallback to colorName includes
    const matchingVariant = pfsVariants.find((v) =>
      v.pfsColorRef?.toLowerCase() === colorRef.toLowerCase()
    ) ?? pfsVariants.find((v) =>
      v.colorName.toLowerCase().includes(colorRef.toLowerCase())
      || colorRef.toLowerCase().includes(v.colorName.toLowerCase())
    );

    const resolvedColorId = matchingVariant?.colorId ?? "";
    const resolvedColorName = matchingVariant?.colorName ?? colorRef;

    // Merge into existing group if same colorId already exists (avoid duplicates)
    const existingGroup = pfsImageGroups.find(g =>
      (resolvedColorId && g.colorId === resolvedColorId) ||
      (!resolvedColorId && g.colorName === resolvedColorName)
    );
    if (existingGroup) {
      existingGroup.paths.push(...urls.map((u) => fullSizeImageUrl(u)));
    } else {
      pfsImageGroups.push({
        colorId: resolvedColorId,
        colorName: resolvedColorName,
        colorHex: matchingVariant?.colorHex ?? null,
        colorPatternImage: matchingVariant?.colorPatternImage ?? null,
        subColors: [],
        paths: urls.map((u) => fullSizeImageUrl(u)),
      });
    }
  }

  // Ensure all PFS variants have an image group (even with 0 images)
  for (const v of pfsVariants) {
    const alreadyExists = pfsImageGroups.some(g =>
      (v.colorId && g.colorId === v.colorId) ||
      (!v.colorId && g.colorName === v.colorName)
    );
    if (!alreadyExists) {
      pfsImageGroups.push({
        colorId: v.colorId,
        colorName: v.colorName,
        colorHex: v.colorHex ?? null,
        colorPatternImage: v.colorPatternImage ?? null,
        subColors: v.subColors ?? [],
        paths: [],
      });
    }
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
    variants: product.colors.map((pc) => {
      // For PACKs (colorId=null), use first packColorLine's first color as representative
      let effectiveColorId = pc.color?.id ?? pc.colorId ?? "";
      let effectiveColorName = pc.color?.name ?? "";
      let effectiveColorHex = pc.color?.hex ?? null;
      let effectiveColorPatternImage = pc.color?.patternImage ?? null;

      if (pc.saleType === "PACK" && !effectiveColorId && pc.packColorLines?.length > 0) {
        const firstLine = pc.packColorLines[0];
        const firstColor = firstLine.colors?.[0]?.color;
        if (firstColor) {
          effectiveColorId = firstColor.id;
          effectiveColorName = firstColor.name;
          effectiveColorHex = firstColor.hex ?? null;
          effectiveColorPatternImage = firstColor.patternImage ?? null;
        }
      }

      // For PACK variants, DB stores total pack price (unitPrice × totalQty).
      // PFS uses per-unit price, so normalize BJ to per-unit for comparison.
      let displayUnitPrice = Number(pc.unitPrice);
      if (pc.saleType === "PACK") {
        const totalQty = pc.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0) || pc.packQuantity || 1;
        displayUnitPrice = Math.round((displayUnitPrice / totalQty) * 100) / 100;
      }

      // For PACK with no main colorId, expose remaining packColorLine colors as subColors (display only)
      const packLineSubColors = pc.saleType === "PACK" && !pc.colorId && (pc.packColorLines?.[0]?.colors?.length ?? 0) > 1
        ? pc.packColorLines[0].colors.slice(1).map((c) => ({
            colorId: c.color.id,
            colorName: c.color.name,
            hex: c.color.hex ?? null,
            patternImage: c.color.patternImage ?? null,
          }))
        : [];

      return {
        id: pc.id,
        colorId: effectiveColorId,
        colorName: effectiveColorName,
        colorHex: effectiveColorHex,
        colorPatternImage: effectiveColorPatternImage,
        subColors: packLineSubColors.length > 0
          ? packLineSubColors
          : pc.subColors.map((sc) => ({
              colorId: sc.color.id,
              colorName: sc.color.name,
              hex: sc.color.hex,
              patternImage: sc.color.patternImage,
            })),
        unitPrice: displayUnitPrice,
        weight: pc.weight,
        stock: pc.stock,
        saleType: pc.saleType,
        packQuantity: pc.packQuantity,
        sizeName: pc.variantSizes?.[0]?.size.name ?? null,
        pfsSizeRef: pc.variantSizes?.[0]?.size.pfsMappings?.[0]?.pfsSizeRef ?? null,
        isPrimary: pc.isPrimary,
        discountType: pc.discountType,
        discountValue: pc.discountValue != null ? Number(pc.discountValue) : null,
        pfsColorRef: pc.pfsColorRef ?? null,
        pfsColorRefLabel: pc.pfsColorRef ? (pfsColorLabelMap.get(pc.pfsColorRef) ?? null) : null,
      };
    }),
    imagesByColor: (() => {
      const groups = new Map<string, {
        colorId: string;
        colorName: string;
        colorHex: string | null;
        colorPatternImage: string | null;
        subColors: Array<{ colorId: string; colorName: string; hex: string | null; patternImage: string | null }>;
        paths: string[];
        images: Array<{ id: string; path: string; order: number }>;
      }>();

      for (const pc of product.colors) {
        // Resolve effective color for PACK variants (colorId=null → use first packColorLine color)
        let effectiveColorId = pc.colorId ?? "";
        let effectiveColorName = pc.color?.name ?? "";
        let effectiveColorHex = pc.color?.hex ?? null;
        let effectiveColorPatternImage = pc.color?.patternImage ?? null;
        let effectiveSubColors = pc.subColors.map((sc) => ({
          colorId: sc.color.id,
          colorName: sc.color.name,
          hex: sc.color.hex,
          patternImage: sc.color.patternImage,
        }));

        if (!effectiveColorId && pc.saleType === "PACK" && pc.packColorLines?.length > 0) {
          const firstLine = pc.packColorLines[0];
          const firstColor = firstLine.colors?.[0]?.color;
          if (firstColor) {
            effectiveColorId = firstColor.id;
            effectiveColorName = firstColor.name;
            effectiveColorHex = firstColor.hex ?? null;
            effectiveColorPatternImage = firstColor.patternImage ?? null;
            // Use remaining packColorLine colors as subColors
            effectiveSubColors = firstLine.colors.slice(1).map((c) => ({
              colorId: c.color.id,
              colorName: c.color.name,
              hex: c.color.hex ?? null,
              patternImage: c.color.patternImage ?? null,
            }));
          }
        }

        if (!effectiveColorId) continue; // Skip if still no color
        const subKey = effectiveSubColors.map((sc) => sc.colorName).join(",");
        const groupKey = `${effectiveColorId}::${subKey}`;

        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            colorId: effectiveColorId,
            colorName: effectiveColorName,
            colorHex: effectiveColorHex,
            colorPatternImage: effectiveColorPatternImage,
            subColors: effectiveSubColors,
            paths: [],
            images: [],
          });
        }

        const group = groups.get(groupKey)!;
        for (const img of pc.images) {
          if (!group.paths.includes(img.path)) {
            group.paths.push(img.path);
            group.images.push({ id: img.id, path: img.path, order: img.order });
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
    pfsSeasonRef: refDetails?.product?.collection?.reference || null,
    pfsCountryRef: refDetails?.product?.country_of_manufacture || null,
    pfsCategoryPfsId: pfsCategoryPfsId || null,
    pfsCategoryGender: pfsCategoryGender || null,
    pfsCategoryFamilyId: pfsCategoryFamilyId || null,
  };

  // 5. Compute differences
  const differences: Array<{ field: string; pfsValue: unknown; bjValue: unknown }> = [];

  // Normalize strings for comparison (trim whitespace)
  const bjNameNorm = (bjFormatted.name ?? "").trim();
  const pfsNameNorm = (pfsFormatted.name ?? "").trim();
  const bjDescNorm = (bjFormatted.description ?? "").trim();
  const pfsDescNorm = (pfsFormatted.description ?? "").trim();

  if (bjNameNorm !== pfsNameNorm && pfsNameNorm) {
    differences.push({ field: "name", pfsValue: pfsFormatted.name, bjValue: bjFormatted.name });
  }
  if (bjDescNorm !== pfsDescNorm && pfsDescNorm) {
    differences.push({ field: "description", pfsValue: pfsFormatted.description, bjValue: bjFormatted.description });
  }
  if (pfsCategoryName && (pfsCategoryId ? bjFormatted.categoryId !== pfsCategoryId : bjFormatted.categoryName.trim() !== pfsCategoryName.trim())) {
    differences.push({ field: "category", pfsValue: pfsFormatted.categoryName, bjValue: bjFormatted.categoryName });
  }
  // Compare compositions: sort by name+percentage to avoid order-dependent false positives
  // Compare only by name+percentage, NOT compositionId (may differ between BJ and PFS lookup)
  const sortComps = (comps: Array<{ name: string; percentage: number }>) =>
    [...comps].sort((a, b) => a.name.localeCompare(b.name) || a.percentage - b.percentage);
  const bjCompsNorm = sortComps(bjFormatted.compositions.map(c => ({ name: c.name.trim().toLowerCase(), percentage: c.percentage })));
  const pfsCompsNorm = sortComps(pfsFormatted.compositions.map(c => ({ name: c.name.trim().toLowerCase(), percentage: c.percentage })));
  if (JSON.stringify(bjCompsNorm) !== JSON.stringify(pfsCompsNorm) && pfsFormatted.compositions.length > 0) {
    differences.push({ field: "compositions", pfsValue: pfsFormatted.compositions, bjValue: bjFormatted.compositions });
  }

  // Compare season — name-based fallback when IDs can't be resolved
  if (pfsFormatted.seasonName) {
    const seasonDiff = bjFormatted.seasonId && pfsFormatted.seasonId
      ? bjFormatted.seasonId !== pfsFormatted.seasonId
      : bjFormatted.seasonName && pfsFormatted.seasonName
        ? bjFormatted.seasonName.trim().toLowerCase() !== pfsFormatted.seasonName.trim().toLowerCase()
        : !!bjFormatted.seasonId !== !!pfsFormatted.seasonName;
    if (seasonDiff) {
      differences.push({ field: "season", pfsValue: pfsFormatted.seasonName, bjValue: bjFormatted.seasonName });
    }
  }

  // Compare country — name-based fallback when IDs can't be resolved
  if (pfsFormatted.manufacturingCountryName) {
    const countryDiff = bjFormatted.manufacturingCountryId && pfsFormatted.manufacturingCountryId
      ? bjFormatted.manufacturingCountryId !== pfsFormatted.manufacturingCountryId
      : bjFormatted.manufacturingCountryName && pfsFormatted.manufacturingCountryName
        ? bjFormatted.manufacturingCountryName.trim().toLowerCase() !== pfsFormatted.manufacturingCountryName.trim().toLowerCase()
        : !!bjFormatted.manufacturingCountryId !== !!pfsFormatted.manufacturingCountryName;
    if (countryDiff) {
      differences.push({ field: "manufacturingCountry", pfsValue: pfsFormatted.manufacturingCountryName, bjValue: bjFormatted.manufacturingCountryName });
    }
  }

  // Compare variants — match by pfsColorRef first (like modal), then by colorId
  const usedBjIndices = new Set<number>();
  for (const pfsV of pfsVariants) {
    // Step 1: match by pfsColorRef (most reliable for multi-color / remapped variants)
    let bjV = pfsV.pfsColorRef
      ? bjFormatted.variants.find((v, i) => !usedBjIndices.has(i) && v.pfsColorRef === pfsV.pfsColorRef && v.saleType === pfsV.saleType)
      : undefined;
    if (bjV) usedBjIndices.add(bjFormatted.variants.indexOf(bjV));

    // Step 2: fallback to colorId match
    if (!bjV) {
      bjV = bjFormatted.variants.find((v, i) => !usedBjIndices.has(i) && v.colorId === pfsV.colorId && v.saleType === pfsV.saleType);
      if (bjV) usedBjIndices.add(bjFormatted.variants.indexOf(bjV));
    }

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
      // Compare sizes using PFS mapping ref when available
      const bjSizeEffective = bjV.pfsSizeRef ?? bjV.sizeName;
      const pfsSizeEffective = pfsV.sizeName;
      if (bjSizeEffective && pfsSizeEffective && bjSizeEffective !== pfsSizeEffective) {
        differences.push({ field: `size_${pfsV.colorName}_${pfsV.saleType}`, pfsValue: pfsSizeEffective, bjValue: bjV.sizeName });
      }
    }
  }

  if (differences.length > 0) {
    logger.info("[LIVE_CHECK] Differences found", {
      productId,
      reference: product.reference,
      count: differences.length,
      fields: differences.map(d => d.field),
      details: differences,
    });
  }

  return NextResponse.json({
    existing: bjFormatted,
    pfs: pfsFormatted,
    differences,
    hasDifferences: differences.length > 0,
  });
}
