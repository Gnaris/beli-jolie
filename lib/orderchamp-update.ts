/**
 * Orderchamp Update — mise à jour d'un produit déjà publié côté OC.
 *
 * Séquence :
 *   1. Charge le produit BJ + snapshot précédent
 *   2. Calcule le nouveau snapshot théorique
 *   3. Diffe (via `orderchamp-sync-diff`) pour n'envoyer que ce qui a changé
 *   4. Envoie :
 *      - `productUpdate` si les champs meta du produit ont changé
 *      - `productVariantUpdate` pour chaque variante changée (prix, stock, options)
 *      - `productVariantCreate` pour les variantes ajoutées
 *      - `productVariantDelete` pour les variantes retirées
 *      - `inventoryLevelBulkAdjust` pour les variantes dont SEUL le stock change
 *   5. Met à jour le snapshot en BDD
 *
 * Pour le moment, version pragmatique : on considère que si `orderchampSyncRequired`
 * est true, on renvoie tout via `productUpdate` complet (comme un mini-publish).
 * Le diff granulaire (per-field / per-variant) sera activé quand la Phase 3
 * sera stabilisée par les vrais tests en local.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import {
  orderchampGraphQL,
  extractUserErrors,
  formatUserErrors,
} from "@/lib/orderchamp-client";
import { PRODUCT_UPDATE_MUTATION } from "@/lib/orderchamp-queries";
import {
  loadOrderchampProductFull,
  orderchampPublishProduct,
} from "@/lib/orderchamp-publish";
import {
  orderchampAdjustInventory,
  type OrderchampInventoryUpdate,
} from "@/lib/orderchamp-inventory";
import { loadOrderchampPricingConfig, getOrderchampWholesalePrice, getOrderchampChainedRetailPrice } from "@/lib/orderchamp-pricing";
import { buildOrderchampDescription } from "@/lib/orderchamp-description";
import { resolveOrderchampCountry } from "@/lib/orderchamp-country";

export interface OrderchampUpdateResult {
  success: boolean;
  orderchampProductId?: string;
  changedFields?: string[];
  error?: string;
  warnings?: string[];
}

/**
 * Update d'un produit déjà lié. Si non lié → délègue à publish (fallback).
 * Si `forceFullSync` = renvoie tout, même si le snapshot semble à jour.
 */
export async function orderchampUpdateProduct(
  productId: string,
  options?: { forceFullSync?: boolean },
): Promise<OrderchampUpdateResult> {
  const bj = await prisma.product.findUnique({
    where: { id: productId },
    select: { orderchampProductId: true, status: true },
  });
  if (!bj) return { success: false, error: "Produit BJ introuvable." };

  // Pas encore publié → délègue à publish (fallback classique)
  if (!bj.orderchampProductId) {
    const pub = await orderchampPublishProduct(productId);
    if (pub.success) {
      return {
        success: true,
        orderchampProductId: pub.orderchampProductId,
        changedFields: ["*publish*"],
        warnings: pub.warnings,
      };
    }
    return { success: false, error: pub.error };
  }

  const product = await loadOrderchampProductFull(productId);
  if (!product) return { success: false, error: "Impossible de recharger le produit BJ." };

  // 1) Update meta produit (title, desc, dimensions, made-in)
  const changedFields: string[] = [];
  const warnings: string[] = [];
  const activeVariants = product.colors.filter((c) => !c.disabled);
  const countryAlpha2 = resolveOrderchampCountry(product.countryIsoCode);
  let countryEnName: string | null = null;
  try {
    countryEnName = new Intl.DisplayNames(["en"], { type: "region" }).of(countryAlpha2) ?? null;
  } catch { /* fallback null */ }

  const compos = product.compositions
    .map((c) => ({ name: c.composition.name, percentage: Number(c.percentage) }))
    .filter((c) => c.name);
  const allSizes = activeVariants.flatMap((v) => v.variantSizes.map((vs) => vs.size.name));
  const newDescription = buildOrderchampDescription(product.description ?? "", compos, {
    sizes: allSizes,
    sizeDetailsTu: product.sizeDetailsTu,
    madeInCountryEn: countryEnName,
  });

  const productInput: Record<string, unknown> = {
    id: bj.orderchampProductId,
    title: product.name,
    description: newDescription,
    madeIn: countryAlpha2,
    length: mmToCm(product.dimensionLength),
    width: mmToCm(product.dimensionWidth),
    height: mmToCm(product.dimensionHeight),
    diameter: mmToCm(product.dimensionDiameter),
  };
  // `category` non envoyé — Orderchamp détecte automatiquement depuis
  // titre + description (mapping manuel retiré 2026-08-20).

  for (const k of Object.keys(productInput)) {
    if (productInput[k] === undefined) delete productInput[k];
  }

  try {
    const upd = await orderchampGraphQL<{
      productUpdate: {
        product: { id: string } | null;
        userErrors: Array<Record<string, unknown>>;
      };
    }>(
      PRODUCT_UPDATE_MUTATION,
      { input: productInput },
      "productUpdate",
    );
    const errs = extractUserErrors(upd.productUpdate);
    if (errs.length > 0) {
      const msg = formatUserErrors(errs) ?? "Erreur productUpdate";
      return { success: false, error: msg };
    }
    changedFields.push("meta");
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur productUpdate" };
  }

  // 2) Update stock bulk (SET) pour toutes les variantes liées
  const pricing = await loadOrderchampPricingConfig();
  const inventoryUpdates: OrderchampInventoryUpdate[] = [];
  for (const v of activeVariants) {
    if (!v.orderchampVariantId) continue;
    const newStock = Math.max(0, v.stock);
    inventoryUpdates.push({
      productVariantId: v.orderchampVariantId,
      action: "SET",
      adjustment: newStock,
    });
  }
  if (inventoryUpdates.length > 0) {
    const inv = await orderchampAdjustInventory(inventoryUpdates);
    if (inv.updatedCount > 0) changedFields.push("stock");
    if (inv.errors.length > 0) warnings.push(...inv.errors);
  }

  // 3) Reset syncRequired + timestamp
  await prisma.product.update({
    where: { id: productId },
    data: {
      orderchampSyncRequired: false,
      orderchampLastRefreshedAt: new Date(),
    },
  });

  logger.info("[Orderchamp Update] OK", {
    productId,
    reference: product.reference,
    orderchampProductId: bj.orderchampProductId,
    changedFields,
  });

  return {
    success: true,
    orderchampProductId: bj.orderchampProductId,
    changedFields,
    warnings,
  };
}

function mmToCm(mm: number | null | undefined): number | undefined {
  if (mm === null || mm === undefined || mm <= 0) return undefined;
  return Math.round(mm) / 10;
}
