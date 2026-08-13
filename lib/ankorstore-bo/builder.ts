/**
 * Builder BJ Product → BoProductPayload.
 *
 * Prend un produit BJ (avec ses variantes, couleurs, prix, composition,
 * dimensions, pays) et le transforme en payload prêt pour POST /api/me/brand/products.
 *
 * MVP UNIT — les variantes PACK ne sont pas encore couvertes ici, à ajouter
 * dans une itération dédiée si nécessaire.
 */

import type { BoProductPayload, BoProductImage, BoVariantPayload, BoOptionPayload } from "./types";
import { buildAnkorstoreBoSku } from "./sku";
import {
  ANKORSTORE_OPTION_IDS,
  ANKORSTORE_TAG_IDS,
  ankorstoreCountryIdFromIso,
  ankorstoreVatRate,
} from "./referentials";
import {
  getAnkorstorePackedPrice,
  getAnkorstoreChainedRetailPrice,
  type AnkorstorePricingConfig,
} from "@/lib/ankorstore-pricing";

/** Input attendu — sous-ensemble minimal d'un ProductColor BJ pour construire une variante Ankor. */
export interface BjColorInputForBo {
  id: string;
  saleType: "UNIT" | "PACK";
  colorName: string | null;
  ankorsColorNameOverride: string | null;
  unitPrice: number;
  packQuantity: number | null;
  stock: number;
  weight: number | null;
  disabled: boolean;
  /** Images DÉJÀ uploadées via `uploadImagesSequential`. Passer les keys `file-upload:...`. */
  imageKeys: string[];
  /** SKU IAN/EAN optionnel. */
  ian?: string | null;
}

export interface BjProductInputForBo {
  reference: string;
  name: string;
  description: string;
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  hsCode: string | null;
  countryIsoCode: string | null;
  /** BestSeller côté BJ ? Si oui, on ajoute le tag 8 Ankor. */
  isBestSeller: boolean;
  /** Dimensions LxlxH en cm — text libre. */
  dimensionsText: string;
  /** Composition matière — text libre (ex "50% Coton 50% Polyester"). */
  compositionText: string;
  /** Images produit "vitrine" (utilisées hors sélection variante). Keys `file-upload:...`. */
  productImageKeys: string[];
  colors: BjColorInputForBo[];
}

export interface BuildContext {
  brandId: number;
  pricingConfig: AnkorstorePricingConfig;
}

/**
 * Construit le payload Ankor à partir des données BJ + le contexte pricing.
 * Les images doivent être déjà uploadées (keys `file-upload:...`).
 */
export function buildProductPayloadFromBjProduct(
  bj: BjProductInputForBo,
  ctx: BuildContext
): BoProductPayload {
  const enabledColors = bj.colors.filter((c) => c.saleType === "UNIT" && !c.disabled);
  if (enabledColors.length === 0) {
    throw new Error(
      "Aucune variante UNIT active à publier chez Ankorstore — vérifie que le produit a au moins une couleur active en UNIT."
    );
  }

  const productImages: BoProductImage[] = bj.productImageKeys.map((key, i) => ({
    filename: key,
    order: i,
  }));

  const colorValues = enabledColors.map((c) => resolveColorName(c));

  const options: BoOptionPayload[] = [
    {
      id: ANKORSTORE_OPTION_IDS.COLOR,
      name: "color",
      displayName: "Color",
      values: colorValues,
    },
  ];

  const variants: BoVariantPayload[] = enabledColors.map((c) => {
    const colorName = resolveColorName(c);
    const sku = buildAnkorstoreBoSku(bj.reference, colorName);

    const wholesaleEUR = getAnkorstorePackedPrice(
      Number(c.unitPrice),
      c.packQuantity,
      c.saleType,
      ctx.pricingConfig.wholesale
    );
    const retailEUR = getAnkorstoreChainedRetailPrice(
      Number(c.unitPrice),
      c.packQuantity,
      c.saleType,
      ctx.pricingConfig.wholesale,
      ctx.pricingConfig.retail
    );

    const wholesaleCents = Math.round(wholesaleEUR * 100);
    const retailCents = Math.round(retailEUR * 100);

    // On envoie TOUJOURS le vrai stock BJ, peu importe le statut. La mise hors
    // ligne côté Ankor passe désormais par mass-action disable (retire le
    // produit du catalogue), donc plus besoin de le camoufler via stock=0.
    const effectiveStock = Math.max(0, c.stock);

    return {
      sku,
      ian: c.ian ?? null,
      images: c.imageKeys.map((key, i) => ({ filename: key, order: i })),
      stock: {
        stock_quantity: effectiveStock,
        is_always_in_stock: false,
        inventory_policy: "continue",
      },
      shape_properties: {
        capacity: null,
        capacity_unit: null,
        height: null,
        length: null,
        width: null,
        dimensions_unit: null,
        weight: c.weight && c.weight > 0 ? c.weight : null,
        weight_unit: c.weight && c.weight > 0 ? "g" : null,
      },
      options: [
        {
          id: ANKORSTORE_OPTION_IDS.COLOR,
          name: "color",
          value: colorName,
        },
      ],
      price: {
        currency: "EUR",
        original_wholesale_price: { amount: wholesaleCents },
        retail_price: { amount: retailCents },
        discount_rate: 0,
      },
    };
  });

  // Prix "produit" = ceux de la 1re variante (Ankor stocke un default au niveau produit).
  const firstVariant = variants[0];

  return {
    name: bj.name,
    hs_code: bj.hsCode ?? "",
    original_description: bj.description || bj.name,
    brand_id: ctx.brandId,
    unit_multiplier: 1,
    vat_rate: ankorstoreVatRate(ctx.pricingConfig.vatRate),
    discount_rate: 0,
    retail_price: firstVariant.price.retail_price.amount,
    original_wholesale_price: firstVariant.price.original_wholesale_price.amount,
    images: productImages,
    options,
    // On envoie catégories vides — Ankor fait sa propre classification via nom/description.
    categories: [],
    tags: bj.isBestSeller ? [ANKORSTORE_TAG_IDS.BESTSELLER] : [],
    product_type_id: null,
    attributes: [],
    variants,
    made_in_country_id: ankorstoreCountryIdFromIso(bj.countryIsoCode),
    storage_temperature: null,
    needs_fresh_input: false,
    dimensions: bj.dimensionsText,
    fashion_composition: bj.compositionText,
  };
}

function resolveColorName(c: BjColorInputForBo): string {
  const override = c.ankorsColorNameOverride?.trim();
  if (override) return override;
  return c.colorName?.trim() || "Standard";
}
