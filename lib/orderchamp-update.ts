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
import { PRODUCT_UPDATE_MUTATION, PRODUCT_VARIANT_UPDATE_MUTATION } from "@/lib/orderchamp-queries";
import {
  loadOrderchampProductFull,
  orderchampPublishProduct,
} from "@/lib/orderchamp-publish";
import {
  ensureOrderchampCustomCategory,
  ensureOrderchampSubCategoryCustomCategory,
} from "@/lib/orderchamp-custom-category";
import {
  orderchampAdjustInventory,
  type OrderchampInventoryUpdate,
} from "@/lib/orderchamp-inventory";
import { loadOrderchampPricingConfig, getOrderchampWholesalePrice, getOrderchampChainedRetailPrice } from "@/lib/orderchamp-pricing";
import { buildOrderchampDescription } from "@/lib/orderchamp-description";
import { resolveOrderchampCountry } from "@/lib/orderchamp-country";
import { buildOrderchampVariantSkus } from "@/lib/orderchamp-sku";
import { buildOrderchampImageUrl } from "@/lib/marketplace-image";
import { getCurrentTenantIdSafe, getTenantBaseUrl } from "@/lib/tenant";

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
  // Décision cliente 2026-08-21 : Orderchamp ne reçoit QUE les variantes
  // UNIT. Les PACK ne sont pas envoyées (marketplace B2B → acheteuses
  // commandent par multiple UNIT via `minimumOrderQuantity`).
  const activeVariants = product.colors.filter((c) => !c.disabled && c.saleType !== "PACK");
  const countryAlpha2 = resolveOrderchampCountry(product.countryIsoCode);
  let countryEnName: string | null = null;
  try {
    countryEnName = new Intl.DisplayNames(["en"], { type: "region" }).of(countryAlpha2) ?? null;
  } catch { /* fallback null */ }

  const compos = product.compositions
    .map((c) => ({ name: c.composition.name, percentage: Number(c.percentage) }))
    .filter((c) => c.name);
  const allSizes = activeVariants.flatMap((v) => v.variantSizes.map((vs) => vs.size.name));
  // Pas de « Made in » côté OC (retiré à la demande cliente 2026-08-20 —
  // le champ structuré `madeIn` du produit suffit).
  const newDescription = buildOrderchampDescription(product.description ?? "", compos, {
    sizes: allSizes,
    sizeDetailsTu: product.sizeDetailsTu,
    madeInCountryEn: null,
  });

  // Assure la customCategory OC (sous-catégorie BJ si présente, sinon catégorie
  // racine). Même règle qu'au publish : 1ère sous-catégorie par ordre alpha.
  const firstSubCategory = product.subCategories[0] ?? null;
  const catRes = firstSubCategory
    ? await ensureOrderchampSubCategoryCustomCategory(firstSubCategory.id)
    : product.category?.id
      ? await ensureOrderchampCustomCategory(product.category.id)
      : { success: false, orderchampCustomCategoryId: undefined, error: "Pas de catégorie BJ" };
  if (!catRes.success) {
    warnings.push(`Catégorie perso Orderchamp : ${catRes.error}`);
  }

  // Reconstruit la liste d'URLs images (même règle qu'au publish : 1 image
  // par couleur, couleur principale d'abord). Sans ça, l'update ignore
  // silencieusement les ajouts/suppressions/remplacements côté BJ et la
  // fiche OC reste figée sur les images initiales.
  const tenantId = await getCurrentTenantIdSafe();
  const imageBaseUrl = (tenantId ? await getTenantBaseUrl(tenantId) : null) ?? "https://www.beliandjolie.com";
  // Restreint aux couleurs qui ont au moins une variante UNIT active
  // (PACK non envoyées à OC).
  const activeColorIds = new Set(
    activeVariants.map((v) => v.color?.id).filter((x): x is string => !!x),
  );
  const imageUrls: string[] = [];
  {
    const imagesByColor = new Map<string, string[]>();
    for (const img of product.colorImages) {
      if (!activeColorIds.has(img.colorId)) continue;
      if (!imagesByColor.has(img.colorId)) imagesByColor.set(img.colorId, []);
      imagesByColor.get(img.colorId)!.push(img.path);
    }
    const orderedColorIds: string[] = [];
    if (product.primaryColorId && imagesByColor.has(product.primaryColorId)) orderedColorIds.push(product.primaryColorId);
    for (const cid of imagesByColor.keys()) {
      if (cid !== product.primaryColorId) orderedColorIds.push(cid);
    }
    for (const cid of orderedColorIds) {
      const paths = imagesByColor.get(cid) ?? [];
      if (paths.length > 0) imageUrls.push(buildOrderchampImageUrl(paths[0], imageBaseUrl));
    }
  }

  const productInput: Record<string, unknown> = {
    id: bj.orderchampProductId,
    title: product.name,
    description: newDescription,
    madeIn: countryAlpha2,
    // ⚠️ `hsCode` n'est PAS un champ de `ProductUpdateInput` côté OC — il vit
    // uniquement sur `ProductVariantUpdateInput`. Introspection schéma
    // confirmée le 2026-08-22. Le HS code est propagé plus bas dans la
    // boucle `productVariantUpdate` (une valeur par variante).
    length: mmToCm(product.dimensionLength),
    width: mmToCm(product.dimensionWidth),
    height: mmToCm(product.dimensionHeight),
    diameter: mmToCm(product.dimensionDiameter),
    customCategory: catRes.orderchampCustomCategoryId ?? undefined,
    // Publie automatiquement sur le canal Marketplace. OC ignore silencieusement
    // si le canal n'est pas activé côté compte (Settings > Sales channels
    // dans le back-office OC).
    salesChannels: ["MARKETPLACE"],
    // Envoie la liste complète des images à chaque update. Orderchamp
    // remplace le set d'images du produit — les ajouts, suppressions et
    // remplacements côté BJ sont donc propagés en une seule mutation.
    images: imageUrls.length > 0 ? imageUrls.map((url) => ({ sourceUrl: url })) : undefined,
  };
  // `category` non envoyé — Orderchamp détecte automatiquement depuis
  // titre + description (mapping manuel retiré 2026-08-20).

  for (const k of Object.keys(productInput)) {
    if (productInput[k] === undefined) delete productInput[k];
  }

  let updatedImageIds: string[] = [];
  try {
    const upd = await orderchampGraphQL<{
      productUpdate: {
        product: {
          id: string;
          images: { edges: Array<{ node: { id: string; position: number } }> };
        } | null;
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
    if (imageUrls.length > 0) changedFields.push("images");
    // Récupère les nouveaux IDs d'images (dans l'ordre d'envoi = ordre couleur
    // principale d'abord) pour ré-attribuer chaque image à sa variante.
    // Attention : Orderchamp télécharge les images de manière asynchrone.
    // Le retour peut avoir `images.edges = []` alors que le champ a été
    // accepté. Fallback : polling `product(id)` pour récupérer les IDs.
    const productImages = upd.productUpdate.product?.images?.edges ?? [];
    updatedImageIds = productImages
      .slice()
      .sort((a, b) => a.node.position - b.node.position)
      .map((e) => e.node.id);
    if (updatedImageIds.length === 0 && imageUrls.length > 0) {
      // Orderchamp télécharge les images de manière très asynchrone (souvent
      // 2 à 5 minutes après productUpdate). On poll 30 × 3s = 90s max :
      // suffisant pour la majorité des cas ; sinon un « Rafraîchir » manuel
      // ultérieur relance l'attribution une fois les images arrivées côté OC.
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const re = await orderchampGraphQL<{
            product: { images: { edges: Array<{ node: { id: string; position: number } }> } } | null;
          }>(
            `query($id: ID!) { product(id: $id) { images(first: 20) { edges { node { id position } } } } }`,
            { id: bj.orderchampProductId },
            `productImagesPoll/${attempt}`,
          );
          const edges = re.product?.images.edges ?? [];
          if (edges.length > 0) {
            updatedImageIds = edges
              .slice()
              .sort((a, b) => a.node.position - b.node.position)
              .map((e) => e.node.id);
            break;
          }
        } catch {
          // continue retry
        }
      }
      if (updatedImageIds.length === 0) {
        warnings.push("Images Orderchamp non attribuées aux variantes (téléchargement asynchrone trop lent — refaire un Rafraîchir dans quelques minutes).");
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur productUpdate" };
  }

  // Post-passe attribution image → variante (identique au publish). Sans ça,
  // chaque variante OC affiche la première image du produit au lieu de la
  // sienne dans le back-office acheteurs.
  if (updatedImageIds.length > 0) {
    const colorOrder: string[] = [];
    if (product.primaryColorId) colorOrder.push(product.primaryColorId);
    for (const c of activeVariants) {
      if (c.color?.id && !colorOrder.includes(c.color.id)) colorOrder.push(c.color.id);
    }
    const imageIdByColorId = new Map<string, string>();
    colorOrder.forEach((cid, idx) => {
      const imgId = updatedImageIds[idx];
      if (imgId) imageIdByColorId.set(cid, imgId);
    });
    for (const v of activeVariants) {
      if (!v.orderchampVariantId) continue;
      const imgId = v.color?.id ? imageIdByColorId.get(v.color.id) : undefined;
      if (!imgId) continue;
      try {
        await orderchampGraphQL(
          PRODUCT_VARIANT_UPDATE_MUTATION,
          { input: { id: v.orderchampVariantId, productImageId: imgId } },
          "productVariantUpdate/imageAttach",
        );
      } catch (e) {
        warnings.push(`Attribution image variante ${v.color?.name ?? v.id} : ${e instanceof Error ? e.message : "?"}`);
      }
    }
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

  // 3) Update variantes : sku (si la référence BJ a changé).
  // Orderchamp identifie chaque variante par son id GraphQL, donc renvoyer un
  // `sku` différent est accepté et propage le renommage côté fiche OC.
  const baseSkuByVariantId = buildOrderchampVariantSkus(
    product.reference,
    activeVariants.map((v) => ({ id: v.id, saleType: v.saleType, color: v.color })),
  );
  let variantsUpdated = 0;
  let skusRenamed = 0;
  let pricesUpdated = 0;
  for (const v of activeVariants) {
    if (!v.orderchampVariantId) continue;
    const input: Record<string, unknown> = { id: v.orderchampVariantId };
    const baseSku = baseSkuByVariantId.get(v.id);
    // On ne renvoie le sku qu'en mono-taille : c'est le seul cas où la valeur
    // persistée côté OC == `baseSku` sans suffixe. En multi-tailles, chaque
    // variante OC porte un suffixe `-{taille}` et on ne stocke que la 1re
    // (cf. orderchamp-publish.ts) — un rename groupé nécessiterait de requêter
    // les tailles côté OC. On laisse un warning pour ce cas rare.
    if (baseSku && v.variantSizes.length <= 1) {
      input.sku = baseSku;
    } else if (baseSku && v.variantSizes.length > 1) {
      warnings.push(
        `Variante multi-tailles ${v.color?.name ?? v.id} : renommage du code Orderchamp non appliqué automatiquement (rafraîchir manuellement si besoin).`,
      );
    }
    // Prix wholesale + retail : on renvoie systématiquement à chaque update
    // pour propager les changements de basePrice BJ ou de configuration
    // markup Orderchamp. Sans ça, les prix côté OC restaient figés sur
    // ceux du premier publish.
    const unitTotal = Number(v.unitPrice);
    const priceEur = getOrderchampWholesalePrice(unitTotal, v.packQuantity, v.saleType, pricing.wholesale);
    const msrpEur = getOrderchampChainedRetailPrice(unitTotal, v.packQuantity, v.saleType, pricing.wholesale, pricing.retail);
    if (priceEur > 0) input.price = priceEur;
    if (msrpEur > 0) input.msrp = msrpEur;
    // Code SH : OC n'expose ce champ que sur `ProductVariantUpdateInput`
    // (pas sur `ProductUpdateInput`). On l'envoie par variante à chaque
    // update pour propager les changements de HS côté BJ.
    if (product.hsCode?.code) input.hsCode = product.hsCode.code;
    if (Object.keys(input).length <= 1) continue;
    try {
      await orderchampGraphQL(
        PRODUCT_VARIANT_UPDATE_MUTATION,
        { input },
        "productVariantUpdate",
      );
      variantsUpdated += 1;
      if (input.sku) skusRenamed += 1;
      if (input.price !== undefined || input.msrp !== undefined) pricesUpdated += 1;
    } catch (e) {
      warnings.push(`Variante ${v.orderchampVariantId} : ${e instanceof Error ? e.message : "?"}`);
    }
  }
  if (variantsUpdated > 0 && skusRenamed > 0) changedFields.push("sku");
  if (pricesUpdated > 0) changedFields.push("price");

  // 4) Reset syncRequired + timestamp
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
