/**
 * Orderchamp — création des variantes manquantes lors d'un update.
 *
 * Contexte : `orderchampUpdateProduct` sait mettre à jour les variantes déjà
 * liées mais historiquement il sautait silencieusement les couleurs BJ ajoutées
 * APRÈS la première publication (pas de `orderchampVariantId`). Résultat côté
 * OC : le produit continuait à n'afficher que ses variantes d'origine.
 *
 * Ce module comble ce trou en appelant `productVariantCreate` pour chaque
 * couleur BJ nouvellement introduite, puis en persistant le
 * `ProductColor.orderchampVariantId` retourné par OC. Il est appelé APRÈS
 * `productUpdate` (qui a déjà envoyé les nouvelles images du produit) et
 * AVANT l'attribution image → variante / l'ajustement stock, pour que les
 * boucles aval traitent aussi les nouvelles variantes.
 *
 * Décision cliente 2026-09-25 : cette création se fait dans un update NORMAL,
 * pas dans un refresh — refresh = `productRepublish` qui bump la date de
 * publication OC et fait remonter le produit dans les nouveautés, ce qui casse
 * les réassorts côté acheteuses (elles s'appuient sur l'ordre d'ancienneté
 * pour retrouver un produit déjà commandé).
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  orderchampGraphQL,
  extractUserErrors,
  formatUserErrors,
} from "@/lib/orderchamp-client";
import { PRODUCT_VARIANT_CREATE_MUTATION } from "@/lib/orderchamp-queries";
import { buildOrderchampVariantSkus } from "@/lib/orderchamp-sku";
import {
  getOrderchampWholesalePrice,
  getOrderchampChainedRetailPrice,
  type OrderchampPricingConfig,
} from "@/lib/orderchamp-pricing";

/** Sous-ensemble minimal d'une couleur BJ dont on a besoin ici. Volontairement
 *  plus permissif que `FullVariant` de `orderchamp-publish.ts` pour permettre
 *  aux tests d'injecter des objets légers sans reconstruire la structure Prisma
 *  complète. */
export interface OrderchampMissingVariantInput {
  id: string;
  orderchampVariantId: string | null;
  orderchampColorNameOverride: string | null;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  unitPrice: number | { toString(): string };
  weight: number;
  stock: number;
  disabled: boolean;
  color: { id: string; name: string } | null;
  variantSizes: { size: { name: string }; quantity: number }[];
}

/** Un item de l'expansion (1 couleur BJ → 1..N variantes OC développées
 *  couleur × taille). Un multi-taille produit N items partageant le même
 *  `bjVariantId`. */
export interface MissingVariantExpansion {
  bjVariantId: string;
  colorId: string | null;
  colorName: string;
  sizeName: string;
  sku: string;
  priceEur: number;
  msrpEur: number;
  weightGrams: number;
  stock: number;
}

const FALLBACK_SIZE = "One Size";

function orderchampColorNameOf(
  colorName: string | undefined,
  override: string | null | undefined,
): string {
  const trimmed = override?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : (colorName ?? "Color");
}

/** Fonction pure : trie les variantes actives sans `orderchampVariantId`.
 *  Exclut les PACK (jamais envoyées à OC, décision 2026-08-21). Inclut les
 *  variantes désactivées (envoyées avec stock=0, décision 2026-09-08 —
 *  cohérent avec `orderchampUpdateProduct`). */
export function identifyMissingOrderchampVariants<
  T extends { orderchampVariantId: string | null; saleType: "UNIT" | "PACK" },
>(activeVariants: readonly T[]): T[] {
  return activeVariants.filter(
    (v) => v.saleType !== "PACK" && !v.orderchampVariantId,
  );
}

/** Fonction pure : développe une liste de couleurs BJ manquantes en items OC
 *  prêts à envoyer (avec SKU, prix, stock, poids). Reproduit à l'identique la
 *  logique de `expandBjVariantToOrderchamp` + `buildOrderchampProductPayload`
 *  du publish, pour rester cohérent avec ce que OC a vu à la création du
 *  produit. */
export function buildMissingVariantExpansions(
  missing: readonly OrderchampMissingVariantInput[],
  reference: string,
  pricing: OrderchampPricingConfig,
): MissingVariantExpansion[] {
  const bjVariantsForSku = missing.map((v) => ({
    id: v.id,
    saleType: v.saleType,
    color: v.color,
  }));
  const baseSkus = buildOrderchampVariantSkus(reference, bjVariantsForSku);

  const out: MissingVariantExpansion[] = [];
  for (const v of missing) {
    const colorName = orderchampColorNameOf(
      v.color?.name,
      v.orderchampColorNameOverride,
    );
    const baseSku = baseSkus.get(v.id) ?? `${reference}-${v.id}`;
    const unitTotal = Number(v.unitPrice);
    const priceEur = getOrderchampWholesalePrice(
      unitTotal,
      v.packQuantity,
      v.saleType,
      pricing.wholesale,
    );
    const msrpEur = getOrderchampChainedRetailPrice(
      unitTotal,
      v.packQuantity,
      v.saleType,
      pricing.wholesale,
      pricing.retail,
    );
    const weightGrams = Math.max(1, Math.round((v.weight || 0.001) * 1000));
    const stockBase = v.disabled ? 0 : Math.max(0, v.stock);

    if (v.variantSizes.length <= 1) {
      const sizeName = v.variantSizes[0]?.size.name ?? FALLBACK_SIZE;
      const sku = sizeName === FALLBACK_SIZE ? baseSku : `${baseSku}-${sizeName.toLowerCase()}`;
      out.push({
        bjVariantId: v.id,
        colorId: v.color?.id ?? null,
        colorName,
        sizeName,
        sku,
        priceEur,
        msrpEur,
        weightGrams,
        stock: stockBase,
      });
      continue;
    }

    const totalQty =
      v.variantSizes.reduce((acc, vs) => acc + vs.quantity, 0) || 1;
    for (const vs of v.variantSizes) {
      const sizeName = vs.size.name;
      const sku = `${baseSku}-${sizeName.toLowerCase()}`;
      const stock = v.disabled
        ? 0
        : Math.max(0, Math.round((stockBase * vs.quantity) / totalQty));
      out.push({
        bjVariantId: v.id,
        colorId: v.color?.id ?? null,
        colorName,
        sizeName,
        sku,
        priceEur,
        msrpEur,
        weightGrams,
        stock,
      });
    }
  }
  return out;
}

/** Fonction pure : construit le payload `ProductVariantCreateInput` pour une
 *  expansion donnée. Extrait pour testabilité. */
export function buildOrderchampVariantCreateInput(
  exp: MissingVariantExpansion,
  orderchampProductId: string,
  dimensions: {
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    diameterCm?: number;
  },
  hsCode: string | null | undefined,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    productId: orderchampProductId,
    sku: exp.sku,
    price: exp.priceEur,
    msrp: exp.msrpEur,
    inventoryQuantity: Math.max(0, exp.stock),
    inventoryPolicy: "DENY",
    option1: exp.colorName,
    option2: exp.sizeName,
    weight: exp.weightGrams,
  };
  if (dimensions.lengthCm !== undefined) input.length = dimensions.lengthCm;
  if (dimensions.widthCm !== undefined) input.width = dimensions.widthCm;
  if (dimensions.heightCm !== undefined) input.height = dimensions.heightCm;
  if (dimensions.diameterCm !== undefined) input.diameter = dimensions.diameterCm;
  if (hsCode) input.hsCode = hsCode;
  return input;
}

export interface OrderchampCreateMissingVariantsResult {
  createdCount: number;
  /** Map SKU envoyé → ID de la variante OC créée. Utile pour attribuer les
   *  images côté aval. */
  skuToOrderchampVariantId: Map<string, string>;
  /** Map bjVariantId → premier orderchampVariantId créé (celui persisté sur
   *  `ProductColor`). En multi-tailles, on ne persiste que la première. */
  bjVariantIdToOrderchampVariantId: Map<string, string>;
  warnings: string[];
}

/** Orchestration : appelle `productVariantCreate` pour chaque expansion, puis
 *  persist `ProductColor.orderchampVariantId` sur les couleurs concernées. Ne
 *  jette pas — chaque échec de variante est loggé en warning et le reste
 *  continue. */
export async function orderchampCreateMissingVariants(params: {
  productId: string;
  orderchampProductId: string;
  reference: string;
  missing: readonly OrderchampMissingVariantInput[];
  pricing: OrderchampPricingConfig;
  dimensions: {
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    diameterCm?: number;
  };
  hsCode: string | null;
}): Promise<OrderchampCreateMissingVariantsResult> {
  const warnings: string[] = [];
  const skuToOrderchampVariantId = new Map<string, string>();
  const bjVariantIdToOrderchampVariantId = new Map<string, string>();

  if (params.missing.length === 0) {
    return {
      createdCount: 0,
      skuToOrderchampVariantId,
      bjVariantIdToOrderchampVariantId,
      warnings,
    };
  }

  const expansions = buildMissingVariantExpansions(
    params.missing,
    params.reference,
    params.pricing,
  );

  for (const exp of expansions) {
    const input = buildOrderchampVariantCreateInput(
      exp,
      params.orderchampProductId,
      params.dimensions,
      params.hsCode,
    );
    try {
      const data = await orderchampGraphQL<{
        productVariantCreate: {
          productVariant: { id: string; sku: string } | null;
          userErrors: Array<Record<string, unknown>>;
        };
      }>(
        PRODUCT_VARIANT_CREATE_MUTATION,
        { input },
        "productVariantCreate",
        // Non-idempotent : un retry après 5xx recréerait une variante en
        // doublon. Le SKU inclut la couleur et la taille, donc en cas de
        // doublon involontaire OC rejette au 2ᵉ create (userError « SKU
        // already taken ») plutôt que d'accumuler deux variantes identiques.
        { disableRetry: true },
      );
      const errs = extractUserErrors(data.productVariantCreate);
      if (errs.length > 0 || !data.productVariantCreate.productVariant) {
        warnings.push(
          `Création variante ${exp.colorName} / ${exp.sizeName} : ${
            formatUserErrors(errs) ?? "réponse vide"
          }`,
        );
        continue;
      }
      const ocId = data.productVariantCreate.productVariant.id;
      skuToOrderchampVariantId.set(exp.sku, ocId);
      // Ne persiste que la première variante OC créée pour un bjVariantId
      // donné (cohérent avec le publish : BJ raisonne par couleur, pas par
      // couleur × taille).
      if (!bjVariantIdToOrderchampVariantId.has(exp.bjVariantId)) {
        bjVariantIdToOrderchampVariantId.set(exp.bjVariantId, ocId);
      }
    } catch (err) {
      warnings.push(
        `Création variante ${exp.colorName} / ${exp.sizeName} : ${
          err instanceof Error ? err.message : "?"
        }`,
      );
    }
  }

  // Persist les IDs OC sur les ProductColor BJ.
  for (const [bjVariantId, ocVariantId] of bjVariantIdToOrderchampVariantId) {
    try {
      await prisma.productColor.update({
        where: { id: bjVariantId },
        data: { orderchampVariantId: ocVariantId },
      });
    } catch (err) {
      warnings.push(
        `Persistance orderchampVariantId pour ${bjVariantId} : ${
          err instanceof Error ? err.message : "?"
        }`,
      );
    }
  }

  logger.info("[Orderchamp Update] variantes créées", {
    productId: params.productId,
    orderchampProductId: params.orderchampProductId,
    createdCount: bjVariantIdToOrderchampVariantId.size,
    expansionCount: expansions.length,
  });

  return {
    createdCount: bjVariantIdToOrderchampVariantId.size,
    skuToOrderchampVariantId,
    bjVariantIdToOrderchampVariantId,
    warnings,
  };
}
