import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  ankorstoreFetchProduct,
  ankorstoreSearchProductsByRef,
} from "@/lib/ankorstore-api";
import type { AnkorstoreProduct } from "@/lib/ankorstore-api";
import {
  loadMarketplaceMarkupConfigs,
  applyMarketplaceMarkup,
} from "@/lib/marketplace-pricing";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface DiffField {
  field: string;
  bjValue: unknown;
  ankorsValue: unknown;
}

// ─────────────────────────────────────────────
// GET — Fetch live Ankorstore data for a product and compare with BJ
// ─────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  const { productId } = await params;

  // 1. Load local product (same query as pushProductToAnkorstoreInternal)
  const prod = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      reference: true,
      description: true,
      ankorsProductId: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      manufacturingCountry: { select: { isoCode: true, name: true } },
      compositions: {
        include: { composition: { select: { name: true } } },
        orderBy: { percentage: "desc" },
      },
      colors: {
        orderBy: { isPrimary: "desc" },
        select: {
          id: true,
          saleType: true,
          stock: true,
          unitPrice: true,
          packQuantity: true,
          weight: true,
          color: { select: { name: true } },
          images: { orderBy: { order: "asc" }, select: { path: true } },
          packColorLines: {
            select: {
              colors: {
                select: {
                  color: { select: { name: true } },
                },
                orderBy: { position: "asc" },
              },
            },
            orderBy: { position: "asc" },
          },
          variantSizes: {
            select: { size: { select: { name: true } }, quantity: true },
            orderBy: { size: { position: "asc" } },
          },
        },
      },
    },
  });

  if (!prod) {
    return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });
  }

  if (!prod.ankorsProductId) {
    return NextResponse.json(
      { error: "Produit non lie a Ankorstore", notOnAnkorstore: true },
      { status: 400 }
    );
  }

  // 2. Fetch live Ankorstore data
  let ankorsProduct: AnkorstoreProduct | null = null;

  try {
    // Try direct fetch by ID first
    ankorsProduct = await ankorstoreFetchProduct(prod.ankorsProductId);
  } catch {
    // ankorsProductId might be a reference, not a UUID — fallback to search
    try {
      const results = await ankorstoreSearchProductsByRef(prod.reference);
      if (results.length > 0) {
        ankorsProduct = results[0];
      }
    } catch (searchErr) {
      logger.error("[Ankorstore Live-Check] Search fallback failed", {
        productId,
        error: searchErr instanceof Error ? searchErr.message : String(searchErr),
      });
    }
  }

  if (!ankorsProduct) {
    return NextResponse.json(
      { error: "Produit introuvable sur Ankorstore", notOnAnkorstore: true },
      { status: 400 }
    );
  }

  // 3. Reconstruct what we'd push (mirror pushProductToAnkorstoreInternal logic)
  const markupConfigs = await loadMarketplaceMarkupConfigs();

  // --- Helpers (same as push) ---
  function truncateSku(sku: string): string {
    return sku.length > 50 ? sku.slice(0, 50) : sku;
  }

  type ProdColor = NonNullable<typeof prod>["colors"][number];

  function variantColorLabel(c: ProdColor): string {
    if (c.saleType === "UNIT") return c.color?.name ?? "Default";
    const lineColors =
      c.packColorLines?.[0]?.colors?.map((pc) => pc.color.name) ?? [];
    return lineColors.length > 0 ? lineColors.join("-") : "Pack";
  }

  function variantSizeEntries(
    c: ProdColor
  ): { name: string; quantity: number }[] {
    const entries =
      c.variantSizes?.map((vs) => ({ name: vs.size.name, quantity: vs.quantity })) ?? [];
    return entries.length > 0 ? entries : [{ name: "TU", quantity: 1 }];
  }

  // --- Build BJ side (what we'd push) ---

  // Product name
  const bjName = `${prod.name} - ${prod.reference}`;

  // Description (same as push)
  const compositionText =
    prod.compositions.length > 0
      ? prod.compositions
          .map((c) => `${c.composition.name} ${c.percentage}%`)
          .join(", ")
      : null;
  const dimParts: string[] = [];
  if (prod.dimensionLength) dimParts.push(`Longueur ${prod.dimensionLength} mm`);
  if (prod.dimensionWidth) dimParts.push(`Largeur ${prod.dimensionWidth} mm`);
  if (prod.dimensionHeight) dimParts.push(`Hauteur ${prod.dimensionHeight} mm`);
  if (prod.dimensionDiameter)
    dimParts.push(`Diametre ${prod.dimensionDiameter} mm`);
  if (prod.dimensionCircumference)
    dimParts.push(`Circonference ${prod.dimensionCircumference} mm`);
  const dimensionText = dimParts.length > 0 ? dimParts.join(" x ") : null;
  const maxWeightForDesc = Math.max(
    0,
    ...prod.colors.map((c) => c.weight ?? 0)
  );

  let bjDescription = prod.description ?? "";
  if (compositionText) bjDescription += `\nComposition : ${compositionText}`;
  if (dimensionText) bjDescription += `\nDimensions : ${dimensionText}`;
  if (maxWeightForDesc > 0) bjDescription += `\nPoids : ${maxWeightForDesc} kg`;
  bjDescription += `\nReference : ${prod.reference}`;
  if (bjDescription.length < 30) bjDescription = `${prod.name}. ${bjDescription}`;

  // Base price (first UNIT or first available)
  const basePrice = Number(
    prod.colors.find((c) => c.saleType === "UNIT")?.unitPrice ??
      prod.colors[0]?.unitPrice ??
      0
  );
  const bjWholesalePrice = applyMarketplaceMarkup(
    basePrice,
    markupConfigs.ankorstoreWholesale
  );

  // Weight: max across all variants, in grams
  const maxWeightKg = Math.max(0, ...prod.colors.map((c) => c.weight ?? 0));
  const bjWeightGrams =
    maxWeightKg > 0 ? Math.round(maxWeightKg * 1000) : null;

  // Dimensions from product fields (mm)
  const bjHeight = prod.dimensionHeight ?? null;
  const bjWidth = prod.dimensionWidth ?? null;
  const bjLength = prod.dimensionLength ?? null;

  // Country
  const bjCountry = prod.manufacturingCountry?.isoCode ?? null;
  const bjCountryName = prod.manufacturingCountry?.name ?? null;

  // Build BJ variants (one per size per color, same as push)
  interface BjVariant {
    sku: string;
    colorLabel: string;
    wholesalePrice: number;
    stock: number;
    saleType: string;
  }

  const bjVariants: BjVariant[] = [];

  for (const c of prod.colors) {
    const colorName = variantColorLabel(c);
    const sizes = variantSizeEntries(c);
    const unitPrice = Number(c.unitPrice ?? 0);

    if (c.saleType === "UNIT" && unitPrice > 0) {
      const unitWholesale = applyMarketplaceMarkup(
        unitPrice,
        markupConfigs.ankorstoreWholesale
      );
      for (const sz of sizes) {
        bjVariants.push({
          sku: truncateSku(`${prod.reference}_${colorName}_${sz.name}`),
          colorLabel: colorName,
          wholesalePrice: unitWholesale,
          stock: c.stock,
          saleType: "UNIT",
        });
      }
    }

    if (c.saleType === "PACK") {
      const packQty = c.packQuantity ?? 12;
      const totalQty =
        c.variantSizes?.reduce((sum, vs) => sum + vs.quantity, 0) || packQty;
      const perUnitPrice = Math.round((unitPrice / totalQty) * 100) / 100;
      const markedUpUnit = applyMarketplaceMarkup(
        perUnitPrice,
        markupConfigs.ankorstoreWholesale
      );
      const packWholesale = Math.round(markedUpUnit * totalQty * 100) / 100;

      if (unitPrice > 0) {
        for (const sz of sizes) {
          bjVariants.push({
            sku: truncateSku(
              `${prod.reference}_${colorName}_Pack${packQty}_${sz.name}`
            ),
            colorLabel: colorName,
            wholesalePrice: packWholesale,
            stock: c.stock,
            saleType: "PACK",
          });
        }
      }
    }
  }

  // 4. Format both sides for response
  const bjFormatted = {
    name: bjName,
    description: bjDescription,
    wholesalePrice: bjWholesalePrice,
    weight: bjWeightGrams,
    height: bjHeight,
    width: bjWidth,
    length: bjLength,
    madeInCountry: bjCountry,
    variants: bjVariants,
  };

  const ankorsFormatted = {
    name: ankorsProduct.name,
    description: ankorsProduct.description,
    wholesalePrice: ankorsProduct.wholesalePrice,
    weight: ankorsProduct.weight,
    height: ankorsProduct.height,
    width: ankorsProduct.width,
    length: ankorsProduct.length,
    madeInCountry: ankorsProduct.madeInCountry,
    variants: ankorsProduct.variants.map((v) => ({
      sku: v.sku,
      wholesalePrice: v.wholesalePrice,
      stock: v.availableQuantity,
    })),
  };

  // 5. Compare field-by-field
  const differences: DiffField[] = [];

  // Product-level comparisons
  const bjNameNorm = bjFormatted.name.trim();
  const ankorsNameNorm = (ankorsFormatted.name ?? "").trim();
  if (bjNameNorm !== ankorsNameNorm) {
    differences.push({
      field: "name",
      bjValue: bjFormatted.name,
      ankorsValue: ankorsFormatted.name,
    });
  }

  // Description: normalize whitespace for comparison
  const normalizeWs = (s: string) => s.replace(/\s+/g, " ").trim();
  const bjDescNorm = normalizeWs(bjFormatted.description);
  const ankorsDescNorm = normalizeWs(ankorsFormatted.description ?? "");
  if (bjDescNorm !== ankorsDescNorm) {
    differences.push({
      field: "description",
      bjValue: bjFormatted.description,
      ankorsValue: ankorsFormatted.description,
    });
  }

  // Wholesale price (threshold 0.01)
  if (
    ankorsFormatted.wholesalePrice != null &&
    Math.abs((bjFormatted.wholesalePrice ?? 0) - ankorsFormatted.wholesalePrice) >
      0.01
  ) {
    differences.push({
      field: "wholesalePrice",
      bjValue: bjFormatted.wholesalePrice,
      ankorsValue: ankorsFormatted.wholesalePrice,
    });
  }

  // Weight (threshold 1g)
  if (
    ankorsFormatted.weight != null &&
    bjFormatted.weight != null &&
    Math.abs(bjFormatted.weight - ankorsFormatted.weight) > 1
  ) {
    differences.push({
      field: "weight",
      bjValue: bjFormatted.weight,
      ankorsValue: ankorsFormatted.weight,
    });
  }

  // Dimensions (exact match)
  for (const dim of ["height", "width", "length"] as const) {
    const bjVal = bjFormatted[dim];
    const ankorsVal = ankorsFormatted[dim];
    if (ankorsVal != null && bjVal != null && bjVal !== ankorsVal) {
      differences.push({
        field: dim,
        bjValue: bjVal,
        ankorsValue: ankorsVal,
      });
    }
  }

  // Country (case-insensitive)
  if (
    ankorsFormatted.madeInCountry &&
    bjFormatted.madeInCountry &&
    bjFormatted.madeInCountry.toLowerCase() !==
      ankorsFormatted.madeInCountry.toLowerCase()
  ) {
    differences.push({
      field: "madeInCountry",
      bjValue: bjFormatted.madeInCountry,
      ankorsValue: ankorsFormatted.madeInCountry,
    });
  }

  // Variant-level comparisons (match by SKU)
  const ankorsVariantBySku = new Map(
    ankorsFormatted.variants
      .filter((v) => v.sku)
      .map((v) => [v.sku!, v])
  );
  const matchedAnkorsSKUs = new Set<string>();

  for (const bjV of bjVariants) {
    const ankorsV = ankorsVariantBySku.get(bjV.sku);
    if (!ankorsV) {
      differences.push({
        field: `variant_missing_${bjV.sku}`,
        bjValue: bjV,
        ankorsValue: null,
      });
      continue;
    }
    matchedAnkorsSKUs.add(bjV.sku);

    // Price (threshold 0.01)
    if (
      ankorsV.wholesalePrice != null &&
      Math.abs(bjV.wholesalePrice - ankorsV.wholesalePrice) > 0.01
    ) {
      differences.push({
        field: `variant_price_${bjV.sku}`,
        bjValue: bjV.wholesalePrice,
        ankorsValue: ankorsV.wholesalePrice,
      });
    }

    // Stock (exact match)
    if (ankorsV.stock != null && bjV.stock !== ankorsV.stock) {
      differences.push({
        field: `variant_stock_${bjV.sku}`,
        bjValue: bjV.stock,
        ankorsValue: ankorsV.stock,
      });
    }
  }

  // Flag extra variants on Ankorstore that we don't have locally
  for (const ankorsV of ankorsFormatted.variants) {
    if (ankorsV.sku && !matchedAnkorsSKUs.has(ankorsV.sku)) {
      differences.push({
        field: `variant_extra_${ankorsV.sku}`,
        bjValue: null,
        ankorsValue: ankorsV,
      });
    }
  }

  if (differences.length > 0) {
    logger.info("[Ankorstore Live-Check] Differences found", {
      productId,
      reference: prod.reference,
      count: differences.length,
      fields: differences.map((d) => d.field),
    });
  }

  return NextResponse.json({
    existing: bjFormatted,
    ankorstore: ankorsFormatted,
    differences,
    hasDifferences: differences.length > 0,
    countryName: bjCountryName,
  });
}
