/**
 * Auto-link des variantes Ankorstore.
 *
 * Pour un produit local déjà lié à Ankorstore (ankorsProductId connu) dont
 * certaines variantes n'ont pas encore d'ankorsVariantId, ce helper :
 *   1. Charge la liste des variantes côté Ankorstore
 *   2. Apparie les variantes locales par SKU exact (normalisé)
 *   3. À défaut, fait un match « par couleur » en extrayant le segment qui suit
 *      la référence (ex : `REF_ NOIR` ↔ `REF_NOIR_PACK_1` → couleur NOIR)
 *   4. Enregistre `ankorsVariantId` sur les ProductColor matchées
 *
 * Utilisé par : confirmAnkorstoreMatch, linkAnkorstoreProductManually,
 * et ankorstoreUpdateProductInPlace (filet de sécurité).
 */

import { prisma } from "@/lib/prisma";
import { ankorstoreGetVariants } from "@/lib/ankorstore-api";
import { logger } from "@/lib/logger";

function normSku(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/\s+/g, "");
}

function colorKeyOf(sku: string | null | undefined, reference: string): string | null {
  const n = normSku(sku);
  const refUp = reference.toUpperCase().replace(/\s+/g, "");
  const prefix = `${refUp}_`;
  if (!n.startsWith(prefix)) return null;
  const rest = n.slice(prefix.length);
  const firstSeg = rest.split("_")[0];
  return firstSeg || null;
}

export interface AutoLinkResult {
  matchedExact: number;
  matchedColor: number;
  stillUnlinked: { sku: string; reason: string }[];
}

/**
 * Construit le SKU local d'une variante au format `REF_COULEUR_TYPE_INDEX`.
 * (Réimplémenté ici pour éviter une dépendance circulaire vers ankorstore-update.)
 */
function buildLocalSku(reference: string, colorName: string, saleType: string, index: number): string {
  const cleanRef = reference.toUpperCase().replace(/\s+/g, "");
  const cleanColor = colorName.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/g, "");
  return `${cleanRef}_${cleanColor}_${saleType}_${index + 1}`;
}

export async function autoLinkAnkorstoreVariants(
  productId: string,
): Promise<AutoLinkResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      ankorsProductId: true,
      colors: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          ankorsVariantId: true,
          saleType: true,
          color: { select: { name: true } },
        },
      },
    },
  });

  if (!product || !product.ankorsProductId) {
    return { matchedExact: 0, matchedColor: 0, stillUnlinked: [] };
  }

  // Ankorstore ne supporte pas les packs : on n'apparie que les variantes UNIT.
  const unitColors = product.colors.filter((v) => v.saleType === "UNIT");
  const unlinked = unitColors.filter((v) => !v.ankorsVariantId);
  if (unlinked.length === 0) {
    return { matchedExact: 0, matchedColor: 0, stillUnlinked: [] };
  }

  let ankorstoreVariants;
  try {
    ankorstoreVariants = await ankorstoreGetVariants(product.ankorsProductId);
  } catch (err) {
    logger.error("[Ankorstore Link] Failed to fetch Ankorstore variants", {
      ankorsProductId: product.ankorsProductId,
      reference: product.reference,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      matchedExact: 0,
      matchedColor: 0,
      stillUnlinked: unlinked.map((v) => ({
        sku: buildLocalSku(
          product.reference,
          v.color?.name ?? "Couleur",
          v.saleType,
          unitColors.indexOf(v),
        ),
        reason: "Impossible de joindre Ankorstore pour récupérer les variantes",
      })),
    };
  }

  const variantBySku = new Map<string, string>();
  const variantByColorKey = new Map<string, string>();
  for (const v of ankorstoreVariants) {
    const n = normSku(v.sku);
    if (n) variantBySku.set(n, v.id);
    const ck = colorKeyOf(v.sku, product.reference);
    if (ck && !variantByColorKey.has(ck)) variantByColorKey.set(ck, v.id);
  }

  // Pré-charge les ankorsVariantId déjà attribués (au cas où d'autres variantes
  // les ont déjà pris en mémoire DB pour éviter les doublons cross-link)
  const usedAnkorstoreIds = new Set<string>(
    unitColors
      .map((v) => v.ankorsVariantId)
      .filter((id): id is string => !!id),
  );

  let matchedExact = 0;
  let matchedColor = 0;
  const stillUnlinked: { sku: string; reason: string }[] = [];

  for (let i = 0; i < unitColors.length; i++) {
    const variant = unitColors[i];
    if (variant.ankorsVariantId) continue;
    const expectedSku = buildLocalSku(
      product.reference,
      variant.color?.name ?? "Couleur",
      variant.saleType,
      i,
    );
    const expectedNorm = normSku(expectedSku);
    const colorKey = colorKeyOf(expectedSku, product.reference);

    let matchedId = variantBySku.get(expectedNorm);
    let matchType: "exact" | "color" | null = matchedId ? "exact" : null;
    if (!matchedId && colorKey) {
      const candidate = variantByColorKey.get(colorKey);
      if (candidate && !usedAnkorstoreIds.has(candidate)) {
        matchedId = candidate;
        matchType = "color";
      }
    }

    if (matchedId && !usedAnkorstoreIds.has(matchedId)) {
      await prisma.productColor.update({
        where: { id: variant.id },
        data: { ankorsVariantId: matchedId },
      });
      usedAnkorstoreIds.add(matchedId);
      if (matchType === "exact") matchedExact++;
      else matchedColor++;
    } else {
      stillUnlinked.push({
        sku: expectedSku,
        reason: matchedId
          ? "déjà attribué à une autre variante locale"
          : "aucune variante Ankorstore correspondante",
      });
    }
  }

  if (matchedExact + matchedColor > 0) {
    logger.info("[Ankorstore Link] Auto-linked variants", {
      ankorsProductId: product.ankorsProductId,
      reference: product.reference,
      matchedExact,
      matchedColor,
      stillUnlinked: stillUnlinked.length,
      stillUnlinkedDetails: stillUnlinked,
    });
  } else if (unlinked.length > 0) {
    logger.warn("[Ankorstore Link] Auto-link found no matching SKU", {
      ankorsProductId: product.ankorsProductId,
      reference: product.reference,
      localSkus: unlinked.map((v) =>
        buildLocalSku(
          product.reference,
          v.color?.name ?? "Couleur",
          v.saleType,
          unitColors.indexOf(v),
        ),
      ),
      ankorstoreSkus: ankorstoreVariants.map((v) => v.sku),
    });
  }

  return { matchedExact, matchedColor, stillUnlinked };
}
