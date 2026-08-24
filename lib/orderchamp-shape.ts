/**
 * Orderchamp Shape — validation d'un produit avant mutation productCreate/Update.
 *
 * Orderchamp remonte les erreurs métier via `userErrors[]` mais on pré-valide
 * localement pour éviter les rejets récurrents. Erreurs en français, prêtes
 * à afficher dans l'admin.
 *
 * Règles métier fixées avec la cliente (2026-08-19) :
 *   - **Toujours 2 axes, en ANGLAIS** : au niveau produit on envoie
 *     `option1 = "Color"` + `option2 = "Size"` (impératif — les valeurs
 *     françaises "Couleur"/"Taille" font qu'Orderchamp ne peuple pas les
 *     champs dédiés `variant.color`/`variant.size` et le produit devient
 *     illisible via `product(id)`). Les valeurs de variante restent libres
 *     et localisées : `option1 = "Or"`, `option2 = "TU"` sont OK, Orderchamp
 *     les affiche tels quels dans `variant.color` et `variant.size`.
 *     Fallback `"One Size"` (anglais) si le produit BJ n'a qu'une taille
 *     unique locale, pour cohérence avec le vocabulaire acheteur international.
 *   - **Toujours envoyer les dimensions physiques** : `weight` en grammes,
 *     `length/width/height/diameter` en centimètres (BDD BJ en mm → ÷10 au
 *     moment du payload). Envoyées à la fois au niveau produit et variante.
 *
 * Règles dures :
 *   1. `title` non vide
 *   2. au moins 1 variante avec SKU
 *   3. SKUs uniques
 *   4. wholesalePrice > 0 (obligatoire pour marketplace B2B)
 *   5. retailPrice >= wholesalePrice
 *   6. au moins 1 image (produit ou variante)
 *   7. chaque variante a une valeur `option1` (couleur) non vide
 *
 * Règles douces (avertissement) :
 *   - description vide
 *   - countryAlpha2 non résolu → fallback CN
 *   - categoryId (customCategory OC) non résolu — la fiche OC n'aura pas de
 *     « catégorie perso » (distinct de la feuille standard OC qui, elle,
 *     est validée en amont par `resolveOrderchampCategoryForProduct`).
 *   - dimensions manquantes ou nulles (poids ou 3 dimensions)
 */

export interface OrderchampShapeProductInput {
  title: string;
  description?: string;
  categoryId?: string | null;
  vendor?: string;
  wholesalePriceCents: number;
  retailPriceCents: number;
  /** Pays alpha-2 ISO envoyé en country_of_origin. */
  countryAlpha2: string | null;
  /** Poids produit en grammes (0 = warning). */
  weightGrams?: number | null;
  /** Dimensions produit en centimètres (0 ou null = pas envoyées). */
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  diameterCm?: number | null;
  productImagesCount: number;
  variants: {
    sku: string;
    wholesalePriceCents: number;
    retailPriceCents: number;
    imagesCount: number;
    /** Nom de couleur envoyé en `option1` (obligatoire). */
    colorOption?: string | null;
    /** Nom de taille envoyé en `option2` (fallback "TU" si taille unique). */
    sizeOption?: string | null;
    weightGrams?: number | null;
  }[];
}

export interface OrderchampShapeValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateOrderchampProductShape(
  input: OrderchampShapeProductInput,
): OrderchampShapeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.title?.trim()) {
    errors.push("Le nom du produit est obligatoire.");
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
    input.retailPriceCents < input.wholesalePriceCents
  ) {
    errors.push("Le prix conseillé doit être supérieur ou égal au prix de gros.");
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
      if (!v.colorOption?.trim()) {
        errors.push(`Variante ${v.sku} : couleur (option1) manquante.`);
      }
      // sizeOption : pas d'erreur — le caller fournit "TU" en fallback quand
      // le produit est mono-taille locale (règle métier BJ 2026-08-19).
    }

    const totalImages = input.productImagesCount + input.variants.reduce((acc, v) => acc + v.imagesCount, 0);
    if (totalImages === 0) {
      errors.push("Au moins une image est nécessaire (au niveau produit ou variante).");
    }
  }

  if (!input.categoryId) {
    warnings.push(
      "Catégorie personnalisée Orderchamp non résolue — la fiche n'aura pas de « catégorie perso » côté OC (la catégorie standard reste, elle, obligatoire et vérifiée en amont).",
    );
  }
  if (!input.countryAlpha2) {
    warnings.push("Pays de fabrication inconnu — fallback `CN` appliqué.");
  }
  if (!input.description?.trim()) {
    warnings.push("Description vide.");
  }
  if (!input.weightGrams || input.weightGrams <= 0) {
    warnings.push("Poids produit manquant — recommandé pour le calcul frais de port acheteur.");
  }
  const hasNoDimension =
    (!input.lengthCm || input.lengthCm <= 0) &&
    (!input.widthCm || input.widthCm <= 0) &&
    (!input.heightCm || input.heightCm <= 0) &&
    (!input.diameterCm || input.diameterCm <= 0);
  if (hasNoDimension) {
    warnings.push("Dimensions produit manquantes (longueur/largeur/hauteur/diamètre) — utile pour la carte produit acheteur.");
  }

  return { ok: errors.length === 0, errors, warnings };
}
