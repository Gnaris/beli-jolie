/**
 * Orderchamp Publish — orchestre la création d'une fiche produit côté OC.
 *
 * Séquence :
 *   1. Charge le produit BJ complet (variantes, couleurs, images, compos)
 *   2. Valide via `validateOrderchampProductShape`
 *   3. S'assure que `Category.orderchampCategoryId` existe (auto-create la
 *      customCategory OC si pas encore mappée)
 *   4. Construit le payload GraphQL (title, desc, catégorie, dimensions,
 *      variantes multi-couleur×taille avec option1="Color" / option2="Size",
 *      images racine)
 *   5. Appelle `productCreate` GraphQL
 *   6. Persiste `Product.orderchampProductId` + `ProductColor.orderchampVariantId`
 *   7. Post-passe : `productVariantUpdate` pour attribuer image par couleur
 *      + matériaux mappés (filterMaterial)
 *   8. Sauvegarde le snapshot pour les diffs incrémentaux ultérieurs
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import {
  orderchampGraphQL,
  extractUserErrors,
  formatUserErrors,
} from "@/lib/orderchamp-client";
import {
  PRODUCT_CREATE_MUTATION,
  PRODUCT_VARIANT_UPDATE_MUTATION,
  PRODUCT_PUBLISH_MUTATION,
} from "@/lib/orderchamp-queries";
import { getOrderchampStorefrontId } from "@/lib/orderchamp-storefront";
import { buildOrderchampVariantSkus } from "@/lib/orderchamp-sku";
import {
  loadOrderchampPricingConfig,
  getOrderchampWholesalePrice,
  getOrderchampChainedRetailPrice,
} from "@/lib/orderchamp-pricing";
import { buildOrderchampDescription } from "@/lib/orderchamp-description";
import { resolveOrderchampCountry } from "@/lib/orderchamp-country";
import {
  validateOrderchampProductShape,
  type OrderchampShapeValidation,
} from "@/lib/orderchamp-shape";
import {
  ensureOrderchampCustomCategory,
  ensureOrderchampSubCategoryCustomCategory,
} from "@/lib/orderchamp-custom-category";
import {
  ORDERCHAMP_SNAPSHOT_VERSION,
  type OrderchampSyncSnapshot,
  type OrderchampVariantSnapshot,
} from "@/lib/orderchamp-sync-diff";
import { buildOrderchampImageUrl } from "@/lib/marketplace-image";
import { getTenantBaseUrl, getCurrentTenantIdSafe } from "@/lib/tenant";

// ─── Types ─────────────────────────────────────────────────────────────────

export type OrderchampPublishResult =
  | {
      success: true;
      orderchampProductId: string;
      variantMap: Array<{ bjVariantId: string; sku: string; orderchampVariantId: string | null }>;
      warnings: string[];
    }
  | { success: false; error: string; details?: OrderchampShapeValidation };

interface FullVariant {
  id: string;
  orderchampVariantId: string | null;
  unitPrice: Prisma.Decimal | number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  disabled: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  colorId: string | null;
  color: { id: string; name: string } | null;
  orderchampColorNameOverride: string | null;
  variantSizes: { size: { name: string }; quantity: number }[];
}

interface FullProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  status: string;
  primaryColorId: string | null;
  category: {
    id: string;
    name: string;
  } | null;
  /** Sous-catégories BJ, triées par nom (première envoyée à OC comme
   *  customCategory enfant si présente). */
  subCategories: { id: string; name: string }[];
  colors: FullVariant[];
  colorImages: { path: string; order: number; colorId: string }[];
  compositions: {
    percentage: Prisma.Decimal | number;
    composition: { name: string; orderchampMaterialCode: string | null };
  }[];
  countryIsoCode: string | null;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  sizeDetailsTu: string | null;
}

// ─── Load produit BJ complet ───────────────────────────────────────────────

export async function loadOrderchampProductFull(
  productId: string,
): Promise<FullProduct | null> {
  const p = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: {
        select: { id: true, name: true },
      },
      subCategories: {
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
      colors: {
        where: { disabled: false },
        include: {
          color: { select: { id: true, name: true } },
          variantSizes: {
            include: { size: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      colorImages: {
        select: { path: true, order: true, colorId: true },
        orderBy: { order: "asc" },
      },
      compositions: {
        include: {
          composition: {
            select: { name: true, orderchampMaterialCode: true },
          },
        },
        orderBy: { percentage: "desc" },
      },
    },
  });
  if (!p) return null;
  return p as unknown as FullProduct;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const FALLBACK_SIZE = "One Size";

function orderchampColorNameOf(
  colorName: string | undefined,
  override: string | null | undefined,
): string {
  const trimmed = override?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : (colorName ?? "Color");
}

/** BJ stocke les dimensions en mm ; Orderchamp attend des cm → ÷10. */
function mmToCm(mm: number | null | undefined): number | undefined {
  if (mm === null || mm === undefined || mm <= 0) return undefined;
  return Math.round(mm) / 10;
}

/** Enumère les tailles à partir d'une variante — retourne les noms de tailles. */
function sizesOf(v: FullVariant): string[] {
  if (v.variantSizes.length === 0) return [];
  return v.variantSizes.map((vs) => vs.size.name);
}

/**
 * Développe une variante BJ en 1 ou N variantes Orderchamp :
 *  - Mono-taille (UNIT ou PACK avec 0/1 taille) → 1 variante OC avec option2 = "One Size" ou nom taille
 *  - Multi-taille → N variantes OC (une par taille) avec le même colorId
 */
function expandBjVariantToOrderchamp(v: FullVariant): Array<{
  bjVariantId: string;
  colorName: string;
  sizeName: string;
  stockShare: number;
}> {
  const colorName = orderchampColorNameOf(v.color?.name, v.orderchampColorNameOverride);
  const sizes = sizesOf(v);
  if (sizes.length === 0) {
    return [{ bjVariantId: v.id, colorName, sizeName: FALLBACK_SIZE, stockShare: v.stock }];
  }
  if (sizes.length === 1) {
    return [{ bjVariantId: v.id, colorName, sizeName: sizes[0], stockShare: v.stock }];
  }
  // Multi-taille : Orderchamp attend N variantes (couleur × taille). Le stock
  // BJ est global par couleur ; on le distribue proportionnellement à
  // `VariantSize.quantity` pour rester cohérent avec la logique BJ.
  const totalQty = v.variantSizes.reduce((acc, vs) => acc + vs.quantity, 0) || 1;
  return v.variantSizes.map((vs) => ({
    bjVariantId: v.id,
    colorName,
    sizeName: vs.size.name,
    stockShare: Math.max(0, Math.round((v.stock * vs.quantity) / totalQty)),
  }));
}

// ─── Payload builder ───────────────────────────────────────────────────────

interface PublishContext {
  wholesaleMarkup: import("@/lib/marketplace-pricing").MarkupConfig;
  retailMarkup: import("@/lib/marketplace-pricing").MarkupConfig;
  imageBaseUrl: string;
  countryEnName: string | null;
  madeInAlpha2: string;
  brandName: string;
  orderchampCategoryId: string | null;
}

function buildOrderchampProductPayload(
  product: FullProduct,
  ctx: PublishContext,
): {
  input: Record<string, unknown>;
  bjToOcSkuMap: Map<string, string>;
  variantExpansion: Array<{
    bjVariantId: string;
    sku: string;
    colorName: string;
    sizeName: string;
    stockShare: number;
    priceEur: number;
    msrpEur: number;
    weightGrams: number;
  }>;
  imageUrls: string[];
} {
  const activeVariants = product.colors.filter((c) => !c.disabled);
  const expansions = activeVariants.flatMap(expandBjVariantToOrderchamp);

  // SKU : pour chaque BJ variant (colorId), on génère un SKU de base ; les
  // multi-tailles réutilisent le SKU + suffixe taille.
  const bjVariantsForSku = activeVariants.map((v) => ({
    id: v.id,
    saleType: v.saleType,
    color: v.color,
  }));
  const baseSkus = buildOrderchampVariantSkus(product.reference, bjVariantsForSku);

  const variantExpansion = expansions.map((exp, idx) => {
    const bj = activeVariants.find((v) => v.id === exp.bjVariantId)!;
    const baseSku = baseSkus.get(bj.id) ?? `${product.reference}-${idx}`;
    const sku = exp.sizeName === FALLBACK_SIZE ? baseSku : `${baseSku}-${exp.sizeName.toLowerCase()}`;
    const unitTotal = Number(bj.unitPrice);
    const priceEur = getOrderchampWholesalePrice(unitTotal, bj.packQuantity, bj.saleType, ctx.wholesaleMarkup);
    const msrpEur = getOrderchampChainedRetailPrice(unitTotal, bj.packQuantity, bj.saleType, ctx.wholesaleMarkup, ctx.retailMarkup);
    const weightGrams = Math.max(1, Math.round((bj.weight || 0.001) * 1000));
    return {
      bjVariantId: bj.id,
      sku,
      colorName: exp.colorName,
      sizeName: exp.sizeName,
      stockShare: exp.stockShare,
      priceEur,
      msrpEur,
      weightGrams,
    };
  });

  const bjToOcSkuMap = new Map(variantExpansion.map((v) => [v.bjVariantId + ":" + v.sizeName, v.sku]));

  // Images racine du produit : on ordonne par couleur principale d'abord,
  // puis par ordre de couleur, pour que la featured image OC soit celle
  // de la couleur principale BJ.
  const primaryColorId = product.primaryColorId;
  const imagesByColor = new Map<string, string[]>();
  for (const img of product.colorImages) {
    if (!imagesByColor.has(img.colorId)) imagesByColor.set(img.colorId, []);
    imagesByColor.get(img.colorId)!.push(img.path);
  }
  const orderedColorIds: string[] = [];
  if (primaryColorId && imagesByColor.has(primaryColorId)) orderedColorIds.push(primaryColorId);
  for (const cid of imagesByColor.keys()) {
    if (cid !== primaryColorId) orderedColorIds.push(cid);
  }
  const imageUrls: string[] = [];
  for (const cid of orderedColorIds) {
    const paths = imagesByColor.get(cid) ?? [];
    if (paths.length > 0) {
      // 1 image par couleur (la première, la plus haute résolution BJ)
      imageUrls.push(buildOrderchampImageUrl(paths[0], ctx.imageBaseUrl));
    }
  }

  // Compositions mappées → filterMaterial[] (max 4)
  // NOTE : filterMaterial se pose au niveau variante en post-passe, pas ici.

  // Description enrichie (matériaux + tailles). Pas de « Made in » côté OC
  // (retiré à la demande de la cliente le 2026-08-20 — le champ `madeIn`
  // structuré du produit suffit, pas la peine de doublonner en texte).
  const compos = product.compositions
    .map((c) => ({
      name: c.composition.name,
      percentage: Number(c.percentage),
    }))
    .filter((c) => c.name);
  const allSizes = activeVariants.flatMap((v) => sizesOf(v));
  const description = buildOrderchampDescription(product.description ?? "", compos, {
    sizes: allSizes,
    sizeDetailsTu: product.sizeDetailsTu,
    madeInCountryEn: null,
  });

  const input: Record<string, unknown> = {
    title: product.name,
    description,
    brand: ctx.brandName,
    madeIn: ctx.madeInAlpha2,
    minimumOrderQuantity: 1,
    option1: "Color",
    option2: "Size",
    weight: Math.max(1, Math.round(variantExpansion[0]?.weightGrams ?? 25)),
    length: mmToCm(product.dimensionLength),
    width: mmToCm(product.dimensionWidth),
    height: mmToCm(product.dimensionHeight),
    diameter: mmToCm(product.dimensionDiameter),
    // Note : on n'envoie pas `category` (feuille standard OC) — Orderchamp
    // détecte automatiquement la catégorie de marché depuis le titre + la
    // description. Le mapping manuel a été retiré de l'UI en 2026-08-20.
    customCategory: ctx.orderchampCategoryId ?? undefined,
    variants: variantExpansion.map((v) => ({
      sku: v.sku,
      price: v.priceEur,
      msrp: v.msrpEur,
      inventoryQuantity: Math.max(0, v.stockShare),
      inventoryPolicy: "DENY",
      option1: v.colorName,
      option2: v.sizeName,
      weight: v.weightGrams,
      length: mmToCm(product.dimensionLength),
      width: mmToCm(product.dimensionWidth),
      height: mmToCm(product.dimensionHeight),
      diameter: mmToCm(product.dimensionDiameter),
    })),
    images: imageUrls.map((url) => ({ sourceUrl: url })),
  };

  // Purge des undefined pour ne pas polluer les logs OC
  for (const k of Object.keys(input)) {
    if (input[k] === undefined) delete input[k];
  }

  return { input, bjToOcSkuMap, variantExpansion, imageUrls };
}

// ─── Publish orchestration ─────────────────────────────────────────────────

export async function orderchampPublishProduct(
  productId: string,
  options?: { forceRepublish?: boolean },
): Promise<OrderchampPublishResult> {
  const product = await loadOrderchampProductFull(productId);
  if (!product) return { success: false, error: "Produit BJ introuvable." };

  if (!product.category?.id) {
    return { success: false, error: "Produit sans catégorie BJ — impossible de publier." };
  }

  // Garde-fou : toutes les compositions du produit doivent avoir un mapping
  // Orderchamp (`orderchampMaterialCode`). Sinon on bloque — Orderchamp doit
  // refléter la vraie composition matériaux (obligation légale d'affichage
  // pour la vente en gros aux acheteurs pros).
  const unmappedCompos = product.compositions.filter(
    (c) => !c.composition.orderchampMaterialCode?.trim(),
  );
  if (unmappedCompos.length > 0) {
    const names = unmappedCompos.map((c) => c.composition.name).join(", ");
    return {
      success: false,
      error: `Composition non mappée Orderchamp : ${names}. Ouvrez /admin/compositions et renseignez le mapping Orderchamp pour ces matériaux avant de publier.`,
    };
  }

  // 1) Assure la customCategory OC. Si le produit a au moins une sous-catégorie
  // BJ, on prend la première (ordre alphabétique) et on crée une customCategory
  // enfant chez OC (parentId = ID de la catégorie parente OC). Sinon on tombe
  // sur la catégorie racine BJ.
  const firstSubCategory = product.subCategories[0] ?? null;
  const catRes = firstSubCategory
    ? await ensureOrderchampSubCategoryCustomCategory(firstSubCategory.id)
    : await ensureOrderchampCustomCategory(product.category.id);
  if (!catRes.success) {
    return { success: false, error: `Catégorie perso Orderchamp : ${catRes.error}` };
  }
  const orderchampCustomCategoryId = catRes.orderchampCustomCategoryId ?? null;

  // 2) Contexte pricing + tenant
  const pricing = await loadOrderchampPricingConfig();
  const tenantId = await getCurrentTenantIdSafe();
  const baseUrl = tenantId ? await getTenantBaseUrl(tenantId) : null;
  const countryAlpha2 = resolveOrderchampCountry(product.countryIsoCode);
  let countryEnName: string | null = null;
  try {
    countryEnName = new Intl.DisplayNames(["en"], { type: "region" }).of(countryAlpha2) ?? null;
  } catch { countryEnName = null; }

  const ctx: PublishContext = {
    wholesaleMarkup: pricing.wholesale,
    retailMarkup: pricing.retail,
    imageBaseUrl: baseUrl ?? "https://www.beliandjolie.com",
    countryEnName,
    madeInAlpha2: countryAlpha2,
    brandName: "Beli & Jolie",
    orderchampCategoryId: orderchampCustomCategoryId,
  };

  // 3) Build payload
  const { input, variantExpansion, imageUrls } = buildOrderchampProductPayload(product, ctx);

  // 4) Validate shape
  const shape = validateOrderchampProductShape({
    title: product.name,
    description: input.description as string,
    categoryId: orderchampCustomCategoryId,
    countryAlpha2: product.countryIsoCode,
    wholesalePriceCents: Math.round((variantExpansion[0]?.priceEur ?? 0) * 100),
    retailPriceCents: Math.round((variantExpansion[0]?.msrpEur ?? 0) * 100),
    weightGrams: variantExpansion[0]?.weightGrams ?? null,
    lengthCm: mmToCm(product.dimensionLength) ?? null,
    widthCm: mmToCm(product.dimensionWidth) ?? null,
    heightCm: mmToCm(product.dimensionHeight) ?? null,
    diameterCm: mmToCm(product.dimensionDiameter) ?? null,
    productImagesCount: imageUrls.length,
    variants: variantExpansion.map((v) => ({
      sku: v.sku,
      wholesalePriceCents: Math.round(v.priceEur * 100),
      retailPriceCents: Math.round(v.msrpEur * 100),
      imagesCount: 0,
      colorOption: v.colorName,
      sizeOption: v.sizeName,
      weightGrams: v.weightGrams,
    })),
  });
  if (!shape.ok) {
    return { success: false, error: shape.errors.join(" · "), details: shape };
  }

  // 5) Call productCreate
  try {
    const data = await orderchampGraphQL<{
      productCreate: {
        product: {
          id: string;
          variants: { edges: Array<{ node: { id: string; sku: string; option1: string; option2: string } }> };
          images: { edges: Array<{ node: { id: string; position: number } }> };
        } | null;
        userErrors: Array<Record<string, unknown>>;
      };
    }>(
      PRODUCT_CREATE_MUTATION,
      { input },
      "productCreate",
      { disableRetry: true }, // non-idempotent : un retry sur 5xx crée un doublon si la mutation a bien été traitée
    );

    const errs = extractUserErrors(data.productCreate);
    if (errs.length > 0 || !data.productCreate.product) {
      return { success: false, error: formatUserErrors(errs) ?? "Échec productCreate" };
    }

    const created = data.productCreate.product;

    // 6) Persist IDs BJ → OC
    // Chaque variante OC est identifiée par (colorName, sizeName). On mappe
    // vers le bjVariantId via variantExpansion.
    const ocVariantsBySku = new Map(
      created.variants.edges.map((e) => [e.node.sku, e.node.id]),
    );

    const variantMap = variantExpansion.map((v) => ({
      bjVariantId: v.bjVariantId,
      sku: v.sku,
      orderchampVariantId: ocVariantsBySku.get(v.sku) ?? null,
    }));

    // On ne persiste qu'un seul orderchampVariantId par BJ variant (le premier
    // — celui de la première taille). Ça reste cohérent car BJ raisonne par
    // couleur, pas par (couleur × taille).
    const perBjVariant = new Map<string, string>();
    for (const m of variantMap) {
      if (m.orderchampVariantId && !perBjVariant.has(m.bjVariantId)) {
        perBjVariant.set(m.bjVariantId, m.orderchampVariantId);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          orderchampProductId: created.id,
          orderchampSyncRequired: false,
          orderchampLastRefreshedAt: new Date(),
        },
      });
      for (const [bjVariantId, ocVariantId] of perBjVariant) {
        await tx.productColor.update({
          where: { id: bjVariantId },
          data: { orderchampVariantId: ocVariantId },
        });
      }
    });

    // 7) Post-passe : attribuer image par couleur + matériaux
    const imageIds = created.images.edges.map((e) => e.node.id);
    const materialsCodes = product.compositions
      .map((c) => c.composition.orderchampMaterialCode?.trim() || null)
      .filter((c): c is string => !!c)
      .slice(0, 4);

    // Ordre des images racine == ordre de nos colorIds imagesByColor
    const colorOrder: string[] = [];
    if (product.primaryColorId) colorOrder.push(product.primaryColorId);
    for (const c of product.colors) {
      if (c.color?.id && !colorOrder.includes(c.color.id)) colorOrder.push(c.color.id);
    }
    const imageIdByColorId = new Map<string, string>();
    colorOrder.forEach((cid, idx) => {
      const imgId = imageIds[idx];
      if (imgId) imageIdByColorId.set(cid, imgId);
    });

    const warnings: string[] = [...shape.warnings];

    // Publier automatiquement sur la storefront du tenant si le produit BJ
    // est en ligne. Sans ça le produit reste en brouillon côté OC (invisible
    // aux acheteuses même si la storefront est active).
    if (product.status === "ONLINE" && tenantId) {
      const storefrontId = await getOrderchampStorefrontId(tenantId);
      if (storefrontId) {
        try {
          const pub = await orderchampGraphQL<{
            productPublish: {
              listing: { id: string; status: string } | null;
              userErrors: Array<Record<string, unknown>>;
            };
          }>(
            PRODUCT_PUBLISH_MUTATION,
            { input: { id: created.id, storefrontId } },
            "productPublish/postCreate",
          );
          const pubErrs = extractUserErrors(pub.productPublish);
          if (pubErrs.length > 0) {
            warnings.push(`Publication vitrine : ${formatUserErrors(pubErrs) ?? "?"}`);
          }
        } catch (e) {
          warnings.push(`Publication vitrine : ${e instanceof Error ? e.message : "?"}`);
        }
      } else {
        warnings.push(
          "Storefront Orderchamp introuvable — produit créé en brouillon (vitrine à activer côté back-office OC).",
        );
      }
    }

    for (const m of variantMap) {
      if (!m.orderchampVariantId) continue;
      const bj = product.colors.find((c) => c.id === m.bjVariantId);
      const imgId = bj?.color?.id ? imageIdByColorId.get(bj.color.id) : undefined;
      const varInput: Record<string, unknown> = { id: m.orderchampVariantId };
      if (imgId) varInput.productImageId = imgId;
      if (materialsCodes.length > 0) varInput.filterMaterial = materialsCodes;
      if (Object.keys(varInput).length > 1) {
        try {
          await orderchampGraphQL(
            PRODUCT_VARIANT_UPDATE_MUTATION,
            { input: varInput },
            "productVariantUpdate/postCreate",
          );
        } catch (e) {
          warnings.push(`Post-passe variante ${m.sku} : ${e instanceof Error ? e.message : "?"}`);
        }
      }
    }

    // 8) Sauve snapshot pour diffs futurs
    const snapshot: OrderchampSyncSnapshot = {
      schemaVersion: ORDERCHAMP_SNAPSHOT_VERSION,
      product: {
        title: product.name,
        description: input.description as string,
        categoryId: orderchampCustomCategoryId ?? "",
        vendor: ctx.brandName,
        countryAlpha2: ctx.madeInAlpha2,
        productType: "",
        tags: [],
        images: imageUrls,
      },
      variants: Object.fromEntries(
        variantExpansion.map((v): [string, OrderchampVariantSnapshot] => [
          v.sku,
          {
            sku: v.sku,
            wholesalePriceCents: Math.round(v.priceEur * 100),
            retailPriceCents: Math.round(v.msrpEur * 100),
            availableQuantity: Math.max(0, v.stockShare),
            active: true,
            colorOption: v.colorName,
            sizeOption: v.sizeName,
            images: [],
            weightGrams: v.weightGrams,
            lengthCm: mmToCm(product.dimensionLength) ?? null,
            widthCm: mmToCm(product.dimensionWidth) ?? null,
            heightCm: mmToCm(product.dimensionHeight) ?? null,
            orderchampVariantId: ocVariantsBySku.get(v.sku) ?? null,
          },
        ]),
      ),
      lifecycleState: product.status === "ONLINE" ? "PUBLISHED" : "DRAFT",
    };
    await prisma.product.update({
      where: { id: productId },
      data: { orderchampLastSyncSnapshot: snapshot as unknown as Prisma.InputJsonValue },
    });

    logger.info("[Orderchamp Publish] OK", {
      productId,
      reference: product.reference,
      orderchampProductId: created.id,
      variantCount: variantMap.length,
    });

    return {
      success: true,
      orderchampProductId: created.id,
      variantMap,
      warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    logger.error("[Orderchamp Publish] échec", { productId, error: message });
    return { success: false, error: message };
  }
}
