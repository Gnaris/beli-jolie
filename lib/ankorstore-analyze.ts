import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { akListProducts, extractReferenceFromSku } from "@/lib/ankorstore-api";

export interface AkAnalysisResult {
  totalProducts: number;
  newProducts: number;
  existingProducts: number;
  unmappedProductTypes: { id: number; count: number }[];
  allProductTypes: { id: number; count: number }[];
}

/**
 * Analyze Ankorstore catalog to detect unmapped entities.
 * Paginates through all products and reports what's missing.
 */
export async function runAnkorstoreAnalyze(options?: {
  limit?: number;
  onProgress?: (msg: string) => void;
}): Promise<AkAnalysisResult> {
  const limit = options?.limit || 0;
  const onProgress = options?.onProgress || (() => {});

  // Load existing mappings
  const mappings = await prisma.ankorstoreMapping.findMany({
    where: { type: "productType" },
  });
  const mappedTypes = new Set(mappings.map((m) => m.akValue));

  // Load existing product references
  const existingRefs = new Set(
    (await prisma.product.findMany({ select: { reference: true } })).map((p) => p.reference),
  );

  const productTypeCounts = new Map<number, number>();
  let totalProducts = 0;
  let newProducts = 0;
  let existingProducts = 0;
  let cursor: string | undefined;

  onProgress("Analyse du catalogue Ankorstore...");

  while (true) {
    const { products, variants, nextCursor } = await akListProducts(cursor);
    if (products.length === 0) break;

    for (const product of products) {
      totalProducts++;

      // Count productTypes
      const typeId = product.productTypeId;
      productTypeCounts.set(typeId, (productTypeCounts.get(typeId) || 0) + 1);

      // Check if product exists in BJ
      const firstVariant = variants.find((v) => product.variantIds.includes(v.id));
      if (firstVariant) {
        const ref = extractReferenceFromSku(firstVariant.sku);
        if (existingRefs.has(ref)) {
          existingProducts++;
        } else {
          newProducts++;
        }
      }
    }

    onProgress(`Analysé : ${totalProducts} produits (${newProducts} nouveaux)`);

    if (limit > 0 && totalProducts >= limit) break;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  // Build results
  const allProductTypes = Array.from(productTypeCounts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);

  const unmappedProductTypes = allProductTypes.filter(
    (pt) => !mappedTypes.has(String(pt.id)),
  );

  // Auto-create unmapped entries in AnkorstoreMapping so they appear in the mapping UI
  for (const pt of unmappedProductTypes) {
    try {
      await prisma.ankorstoreMapping.upsert({
        where: { type_akValue: { type: "productType", akValue: String(pt.id) } },
        create: {
          type: "productType",
          akValue: String(pt.id),
          akName: `Type ${pt.id} (${pt.count} produits)`,
          bjEntityId: "",
          bjName: "",
        },
        update: {
          akName: `Type ${pt.id} (${pt.count} produits)`,
        },
      });
    } catch {
      // ignore race conditions
    }
  }

  onProgress(
    `Analyse terminée : ${totalProducts} produits, ${unmappedProductTypes.length} types non mappés`,
  );

  return {
    totalProducts,
    newProducts,
    existingProducts,
    unmappedProductTypes,
    allProductTypes,
  };
}
