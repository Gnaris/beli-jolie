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
  /**
   * Nom de la taille de la variante côté BJ (ex "S/M", "36", "Taille unique").
   * `null` / vide → fallback `DEFAULT_ANKOR_SIZE_NAME` ("Taille unique") pour qu'Ankor
   * accepte plusieurs ProductColor sur la même couleur (ex Issyma : Noir en S/M+M/L+L/XL)
   * sans collision d'option "color".
   */
  sizeName: string | null;
  unitPrice: number;
  packQuantity: number | null;
  stock: number;
  weight: number | null;
  disabled: boolean;
  /** Images DÉJÀ uploadées via `uploadImagesSequential`. Passer les keys `file-upload:...`. */
  imageKeys: string[];
  /** SKU IAN/EAN optionnel. */
  ian?: string | null;
  /**
   * SKU final à envoyer à Ankorstore. Doit être pré-résolu par l'appelant :
   * réutilisé depuis ProductColor.ankorsSku si présent (update), sinon fraîchement
   * généré + persisté avant l'appel (nouvelle publication ou re-publish après delete).
   */
  sku: string;
}

/**
 * Valeur envoyée en option "size" par défaut. Pour BJ, la majorité des produits
 * sont vendus en taille unique — Ankor exige quand même une valeur pour
 * différencier les variantes qui partagent la même couleur.
 */
export const DEFAULT_ANKOR_SIZE_NAME = "Taille unique";

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
  // On inclut TOUTES les couleurs UNIT — même désactivées — pour que la variante
  // existe côté Ankor. Une couleur désactivée est envoyée avec stock=0 plus bas :
  // Ankor refuse alors la commande (inventory_policy=deny) → équivalent visuel
  // "rupture de stock", mais la variante reste dans le catalogue Ankor et retrouve
  // son stock dès que la cliente la réactive côté BJ.
  const unitColors = bj.colors.filter((c) => c.saleType === "UNIT");
  if (unitColors.length === 0) {
    throw new Error(
      "Aucune variante UNIT à publier chez Ankorstore — Ankorstore ne gère que les ventes à l'unité. Ajoute au moins une couleur en UNIT au produit."
    );
  }

  const productImages: BoProductImage[] = bj.productImageKeys.map((key, i) => ({
    filename: key,
    order: i,
  }));

  const colorValues = uniqueOrdered(unitColors.map((c) => resolveColorName(c)));
  const sizeValues = uniqueOrdered(unitColors.map((c) => resolveSizeName(c)));

  // On envoie TOUJOURS les deux options (size + color). Sans "size", Ankor refuse
  // les cas où deux variantes partagent la même couleur (ex "Noir" en 3 tailles :
  // erreur 422 « share the same options value color:Noir »). Pour les produits
  // taille unique, on envoie DEFAULT_ANKOR_SIZE_NAME sur toutes les variantes.
  const options: BoOptionPayload[] = [
    {
      id: ANKORSTORE_OPTION_IDS.SIZE,
      name: "size",
      displayName: "Size",
      values: sizeValues,
    },
    {
      id: ANKORSTORE_OPTION_IDS.COLOR,
      name: "color",
      displayName: "Color",
      values: colorValues,
    },
  ];

  const variants: BoVariantPayload[] = unitColors.map((c) => {
    const colorName = resolveColorName(c);
    const sizeName = resolveSizeName(c);
    if (!c.sku) {
      throw new Error(
        `SKU manquant pour la variante ${c.id} — l'appelant doit pré-résoudre ankorsSku avant de builder le payload.`
      );
    }
    const sku = c.sku;

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

    // Statut PRODUIT (ONLINE/OFFLINE) → géré par mass-action disable côté BJ.
    // Statut VARIANTE (disabled=true côté ProductColor) → on garde la variante
    // dans le catalogue Ankor pour ne pas casser les liens SKU/images, mais on
    // force le stock à 0 : combiné à inventory_policy="deny" ci-dessous, Ankor
    // affiche la variante en rupture et refuse toute commande dessus. Dès que
    // la cliente réactive la couleur côté BJ, le stock réel remonte au prochain
    // sync.
    const effectiveStock = c.disabled ? 0 : Math.max(0, c.stock);

    return {
      sku,
      ian: c.ian ?? null,
      images: c.imageKeys.map((key, i) => ({ filename: key, order: i })),
      stock: {
        stock_quantity: effectiveStock,
        is_always_in_stock: false,
        inventory_policy: "deny",
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
          id: ANKORSTORE_OPTION_IDS.SIZE,
          name: "size",
          value: sizeName,
        },
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

function resolveSizeName(c: BjColorInputForBo): string {
  const raw = c.sizeName?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_ANKOR_SIZE_NAME;
}

/** Renvoie les valeurs distinctes en conservant l'ordre d'apparition. */
function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
