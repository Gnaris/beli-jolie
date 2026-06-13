/**
 * Faire Shape — validation d'un produit avant POST/PATCH.
 *
 * Faire refuse silencieusement (ou retourne `lifecycle_state: DELETED`) un
 * produit mal formé. Cette validation locale évite les rejets côté API en
 * pré-vérifiant tout ce qu'on peut. Erreurs renvoyées en français, prêtes
 * à être affichées dans l'admin.
 *
 * Règles dures (rejet API si non respectées) :
 *   1. `name` non vide
 *   2. `taxonomy_type.id` au format `tt_xxxxxxxxxx`
 *   3. `wholesale` et `retail` > 0
 *   4. `retail >= 2 × wholesale` (Faire impose une marge 2× minimum)
 *   5. au moins 1 variante
 *   6. au moins 1 image (au niveau produit OU variante)
 *
 * Règles douces (avertissement, pas rejet) :
 *   - description vide
 *   - made_in_country non résolu → fallback CHN
 *   - composition vide
 */

export interface FaireShapeProductInput {
  name: string;
  shortDescription?: string;
  description?: string;
  taxonomyTypeId?: string | null;
  wholesalePriceCents: number;
  retailPriceCents: number;
  countryAlpha3: string | null;
  materials: string[];
  hsCode?: string | null;
  minimumOrderQuantity?: number;
  perStyleMinimumOrderQuantity?: number;
  productImagesCount: number;
  variants: {
    sku: string;
    wholesalePriceCents: number;
    retailPriceCents: number;
    imagesCount: number;
  }[];
}

export interface FaireShapeValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const TAXONOMY_ID_RE = /^tt_[a-z0-9]{6,}$/i;

export function validateFaireProductShape(
  input: FaireShapeProductInput,
): FaireShapeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.name?.trim()) {
    errors.push("Le nom du produit est obligatoire.");
  }

  if (!input.taxonomyTypeId || !TAXONOMY_ID_RE.test(input.taxonomyTypeId)) {
    errors.push(
      "La catégorie Faire (taxonomy_type) est manquante ou invalide. " +
        "Renseigner le champ « Faire taxonomy » sur la catégorie du produit.",
    );
  }

  if (!Number.isFinite(input.wholesalePriceCents) || input.wholesalePriceCents <= 0) {
    errors.push("Le prix de gros doit être supérieur à 0.");
  }
  if (!Number.isFinite(input.retailPriceCents) || input.retailPriceCents <= 0) {
    errors.push("Le prix conseillé doit être supérieur à 0.");
  }
  if (
    Number.isFinite(input.wholesalePriceCents) &&
    Number.isFinite(input.retailPriceCents) &&
    input.wholesalePriceCents > 0 &&
    input.retailPriceCents < input.wholesalePriceCents * 2
  ) {
    errors.push(
      "Faire exige que le prix conseillé soit au moins 2× le prix de gros.",
    );
  }

  if (!input.variants || input.variants.length === 0) {
    errors.push("Au moins une variante (couleur) est nécessaire.");
  } else {
    const skuSet = new Set<string>();
    for (const v of input.variants) {
      if (!v.sku?.trim()) {
        errors.push("Chaque variante doit avoir un SKU.");
        continue;
      }
      if (skuSet.has(v.sku)) {
        errors.push(`SKU dupliqué : ${v.sku}`);
      }
      skuSet.add(v.sku);

      if (v.wholesalePriceCents > 0 && v.retailPriceCents > 0 && v.retailPriceCents < v.wholesalePriceCents * 2) {
        errors.push(
          `Variante ${v.sku} : prix conseillé < 2× prix de gros (refusé par Faire).`,
        );
      }
    }

    const totalImages = input.productImagesCount + input.variants.reduce((acc, v) => acc + v.imagesCount, 0);
    if (totalImages === 0) {
      errors.push("Au moins une image est nécessaire (au niveau produit ou variante).");
    }
  }

  if (!input.countryAlpha3) {
    warnings.push("Pays de fabrication inconnu — fallback `CHN` appliqué.");
  }
  if (!input.materials || input.materials.length === 0) {
    warnings.push("Aucun matériau (composition) renseigné.");
  }
  if (!input.hsCode) {
    warnings.push("Code HS non renseigné — recommandé pour le dédouanement.");
  }
  if (!input.description?.trim()) {
    warnings.push("Description vide — risque de validation lente côté Faire.");
  }

  return { ok: errors.length === 0, errors, warnings };
}
