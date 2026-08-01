/**
 * Garde-fou serveur commun à toutes les portes de push marketplace
 * (publishProductToMarketplaces, refreshProductOnMarketplaces,
 *  resyncProductOn*, pushProductToMicrostore…).
 *
 * Charge le produit avec toutes ses relations et applique la même règle de
 * complétude que la mise en ligne côté boutique (via
 * `evaluateProductPublishability`). Un produit dont il manque au moins un
 * champ (composition, description, prix, poids, stock, taille, image de
 * couleur, catégorie…) ne peut être créé ni mis à jour sur aucun marketplace.
 *
 * Retourne `{ eligible: true }` si tout est OK ; sinon
 * `{ eligible: false, reasons, message, notFound }` avec un message prêt à
 * remonter dans un outcome marketplace.
 */

import { prisma } from "@/lib/prisma";
import {
  evaluateProductPublishability,
  type PublishabilityResult,
} from "@/lib/product-publishability";

export interface ProductCompletenessCheck {
  eligible: boolean;
  reasons: string[];
  /** Message formatté prêt à renvoyer à l'UI. */
  message: string;
  /** Vrai si le produit n'existe pas (fallback caller-side). */
  notFound?: boolean;
}

export async function checkProductComplete(
  productId: string,
): Promise<ProductCompletenessCheck> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      categoryId: true,
      compositions: { select: { percentage: true } },
      colors: {
        select: {
          id: true,
          colorId: true,
          color: { select: { name: true } },
          unitPrice: true,
          stock: true,
          weight: true,
          saleType: true,
          packQuantity: true,
          variantSizes: {
            select: {
              sizeId: true,
              size: { select: { name: true } },
              quantity: true,
            },
          },
          packLines: {
            select: { id: true, sizes: { select: { id: true } } },
          },
        },
      },
    },
  });

  if (!product) {
    return {
      eligible: false,
      reasons: ["Produit introuvable."],
      message: "Produit introuvable.",
      notFound: true,
    };
  }

  const imagesRaw = await prisma.productColorImage.groupBy({
    by: ["colorId"],
    where: { productId },
    _count: { _all: true },
  });
  const imageCountByColorId: Record<string, number> = {};
  for (const row of imagesRaw) {
    if (row.colorId) imageCountByColorId[row.colorId] = row._count._all;
  }

  const compositionPercentTotal = product.compositions.reduce(
    (sum, c) => sum + Number(c.percentage ?? 0),
    0,
  );

  const result: PublishabilityResult = evaluateProductPublishability({
    id: product.id,
    reference: product.reference,
    name: product.name,
    description: product.description ?? "",
    categoryId: product.categoryId ?? null,
    compositionCount: product.compositions.length,
    compositionPercentTotal,
    imageCountByColorId,
    variants: product.colors.map((v) => ({
      id: v.id,
      colorId: v.colorId,
      colorName: v.color?.name ?? null,
      unitPrice: Number(v.unitPrice),
      stock: v.stock,
      weight: Number(v.weight),
      saleType: v.saleType,
      packQuantity: v.packQuantity,
      sizes: v.variantSizes.map((s) => ({
        sizeId: s.sizeId,
        sizeName: s.size?.name ?? null,
        quantity: s.quantity,
      })),
      packLinesCount: v.packLines.length,
      packLinesSizesTotal: v.packLines.reduce((sum, l) => sum + l.sizes.length, 0),
    })),
  });

  if (result.eligible) {
    return { eligible: true, reasons: [], message: "" };
  }

  return {
    eligible: false,
    reasons: result.reasons,
    message: `Produit incomplet : ${result.reasons.join(" · ")}. Complétez la fiche avant de la pousser sur les marketplaces.`,
  };
}
