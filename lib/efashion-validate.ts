/**
 * eFashion — Validation des mappings nécessaires à la publication.
 *
 * Extrait de `lib/efashion-publish.ts` pour être réutilisé par le pré-check
 * du shooting batch (avant l'envoi groupé, on veut afficher la liste des
 * produits avec mappings manquants sans tenter l'envoi).
 */

import { prisma } from "@/lib/prisma";

export interface EfashionValidationResult {
  productId: string;
  ok: boolean;
  missing: string[];
  noEligibleVariants: boolean;
}

export async function validateEfashionPublishable(
  productId: string,
): Promise<EfashionValidationResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      category: { select: { name: true, efashionCategorieId: true } },
      manufacturingCountry: { select: { name: true, efashionProvenanceId: true } },
      season: { select: { name: true, efashionCollectionId: true } },
      compositions: {
        select: { composition: { select: { name: true, efashionId: true } } },
      },
      colors: {
        select: {
          saleType: true,
          efashionColorIdOverride: true,
          variantSizes: { select: { size: { select: { name: true } } } },
          color: { select: { name: true, efashionColorId: true } },
        },
      },
    },
  });

  if (!product) {
    return {
      productId,
      ok: false,
      missing: ["produit introuvable"],
      noEligibleVariants: false,
    };
  }

  // eFashion ne sync que les variantes UNIT (les packs sont ignorés, comme Ankorstore)
  const unitColors = product.colors.filter((c) => c.saleType === "UNIT");
  if (unitColors.length === 0) {
    return {
      productId,
      ok: false,
      missing: [],
      noEligibleVariants: true,
    };
  }

  const missing: string[] = [];
  if (!product.category?.efashionCategorieId)
    missing.push(`catégorie « ${product.category?.name ?? "?"} » sans ID eFashion`);
  if (!product.manufacturingCountry?.efashionProvenanceId)
    missing.push(`pays « ${product.manufacturingCountry?.name ?? "?"} » sans ID eFashion`);
  if (!product.season?.efashionCollectionId)
    missing.push(`saison « ${product.season?.name ?? "?"} » sans ID eFashion`);
  if (product.compositions.length === 0) missing.push("au moins 1 composition requise");
  for (const pc of product.compositions) {
    if (!pc.composition.efashionId)
      missing.push(`composition « ${pc.composition.name} » sans ID eFashion`);
  }
  for (const c of unitColors) {
    // Override secondaire prioritaire sur le mapping principal Color.efashionColorId.
    const effectiveEfashionColorId = c.efashionColorIdOverride ?? c.color?.efashionColorId ?? null;
    if (effectiveEfashionColorId == null)
      missing.push(`couleur « ${c.color?.name ?? "?"} » sans ID eFashion`);
    if (c.variantSizes.length === 0)
      missing.push(`couleur « ${c.color?.name ?? "?"} » sans tailles`);
  }

  return {
    productId,
    ok: missing.length === 0,
    missing,
    noEligibleVariants: false,
  };
}
