/**
 * Recherche les produits BJ à re-synchroniser sur Microstore après un changement
 * de mapping d'attribut (catégorie, sous-catégorie, saison, couleur).
 *
 * Règles communes :
 *   - Uniquement les produits déjà connus de Microstore (`microstoreProductId != null`).
 *     Les autres seront poussés à leur premier envoi normal, pas la peine de
 *     provoquer une création en masse suite à un simple changement de mapping.
 *   - Statut ARCHIVED exclu. OFFLINE inclus (`disable=1` sera envoyé, ce qui
 *     masque bien la fiche côté vitrine H5).
 */

import { prisma } from "@/lib/prisma";

export interface MicrostoreAffectedProduct {
  productId: string;
  reference: string;
  productName: string;
}

const ELIGIBILITY = {
  microstoreProductId: { not: null },
  status: { not: "ARCHIVED" as const },
};

function toAffected(rows: Array<{ id: string; reference: string; name: string }>): MicrostoreAffectedProduct[] {
  return rows.map((r) => ({ productId: r.id, reference: r.reference, productName: r.name }));
}

export async function findMicrostoreProductsForCategoryMapping(
  categoryId: string,
): Promise<MicrostoreAffectedProduct[]> {
  const rows = await prisma.product.findMany({
    where: { categoryId, ...ELIGIBILITY },
    select: { id: true, reference: true, name: true },
    orderBy: { reference: "asc" },
  });
  return toAffected(rows);
}

/**
 * Sous-catégorie : seuls les produits qui l'ont **choisie comme étiquette
 * Microstore** (`Product.microstoreSubCategoryId`) utilisent effectivement ce
 * mapping — les autres produits qui ont la sous-cat attribuée mais qui envoient
 * leur catégorie principale ne sont pas concernés.
 */
export async function findMicrostoreProductsForSubCategoryMapping(
  subCategoryId: string,
): Promise<MicrostoreAffectedProduct[]> {
  const rows = await prisma.product.findMany({
    where: { microstoreSubCategoryId: subCategoryId, ...ELIGIBILITY },
    select: { id: true, reference: true, name: true },
    orderBy: { reference: "asc" },
  });
  return toAffected(rows);
}

export async function findMicrostoreProductsForSeasonMapping(
  seasonId: string,
): Promise<MicrostoreAffectedProduct[]> {
  const rows = await prisma.product.findMany({
    where: { seasonId, ...ELIGIBILITY },
    select: { id: true, reference: true, name: true },
    orderBy: { reference: "asc" },
  });
  return toAffected(rows);
}

export async function findMicrostoreProductsForColorMapping(
  colorId: string,
): Promise<MicrostoreAffectedProduct[]> {
  const rows = await prisma.product.findMany({
    where: { colors: { some: { colorId } }, ...ELIGIBILITY },
    select: { id: true, reference: true, name: true },
    orderBy: { reference: "asc" },
  });
  return toAffected(rows);
}
