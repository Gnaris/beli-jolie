/**
 * Eligibility validation for marketplace Excel export.
 *
 * Each marketplace has different mandatory fields. This module returns,
 * for one product + one marketplace, an object `{ eligible, missing[] }`.
 * The UI shows the reasons in plain French so the admin can fix the source data.
 *
 * Pour Efashion / Microstore / Ankorstore, seules les variantes UNIT sont
 * exportées (la cliente exclut les PACK de ces 3 marketplaces). Le validateur
 * filtre donc les variantes en amont avant d'évaluer prix/poids/images.
 */

import type { ExportProduct, MarketplaceEligibility, MarketplaceKey } from "./types";
import { withUnitVariantsOnly } from "./format-helpers";

/** Returns true iff the product has at least one variant with non-zero stock. */
function hasAnyStock(p: ExportProduct): boolean {
  return p.variants.some((v) => v.stock > 0);
}

/** Returns true iff every variant has a numeric, non-zero weight. */
function allVariantsHaveWeight(p: ExportProduct): boolean {
  return p.variants.length > 0 && p.variants.every((v) => Number(v.weight) > 0);
}

/** Returns true iff every variant has a positive unit price. */
function allVariantsHavePrice(p: ExportProduct): boolean {
  return p.variants.length > 0 && p.variants.every((v) => Number(v.unitPrice) > 0);
}

/** Returns true iff at least one variant has at least one image. */
function anyVariantHasImage(p: ExportProduct): boolean {
  return p.variants.some((v) => v.imagePaths.length > 0);
}

function validatePfs(p: ExportProduct): string[] {
  const missing: string[] = [];
  if (!p.pfsGenderCode) missing.push("genre PFS non renseigné sur la catégorie");
  if (!p.pfsFamilyName) missing.push("famille PFS non renseignée sur la catégorie");
  if (!p.pfsCategoryName && !p.categoryName) missing.push("catégorie PFS manquante");
  if (!p.seasonPfsRef) missing.push("saison sans référence PFS");
  if (!p.manufacturingCountryName) missing.push("pays d'origine manquant");
  if (p.compositions.length === 0) missing.push("aucune composition");
  if (!allVariantsHavePrice(p)) missing.push("au moins une variante sans prix");
  if (!allVariantsHaveWeight(p)) missing.push("au moins une variante sans poids");
  if (p.variants.length === 0) missing.push("aucune variante");
  return missing;
}

function validateEfashion(p: ExportProduct): string[] {
  const unitOnly = withUnitVariantsOnly(p);
  const missing: string[] = [];
  if (!p.efashionCategorieId) missing.push("catégorie sans mapping Efashion");
  if (!p.efashionCategoryPath)
    missing.push("chemin catégorie Efashion introuvable (annexes Efashion indisponibles ?)");
  if (!p.seasonEfashionCollectionId) missing.push("saison sans correspondance Efashion");
  if (!p.manufacturingCountryEfashionProvenanceId)
    missing.push("pays sans correspondance Efashion");
  if (p.compositions.length === 0) missing.push("aucune composition");
  for (const c of p.compositions) {
    if (!c.efashionId) {
      missing.push(`composition « ${c.name} » sans correspondance Efashion`);
      break;
    }
  }
  if (unitOnly.variants.length === 0) {
    missing.push("aucune variante à l'unité (les packs ne sont pas exportés vers Efashion)");
  } else {
    if (!allVariantsHavePrice(unitOnly)) missing.push("au moins une variante sans prix");
    if (!allVariantsHaveWeight(unitOnly)) missing.push("au moins une variante sans poids");
  }
  return missing;
}

function validateMicrostore(p: ExportProduct): string[] {
  const unitOnly = withUnitVariantsOnly(p);
  const missing: string[] = [];
  if (!p.categoryName) missing.push("catégorie manquante");
  if (!p.manufacturingCountryName) missing.push("pays d'origine manquant");
  if (p.compositions.length === 0) missing.push("aucune composition");
  if (unitOnly.variants.length === 0) {
    missing.push("aucune variante à l'unité (les packs ne sont pas exportés vers Microstore)");
  } else {
    if (!allVariantsHavePrice(unitOnly)) missing.push("au moins une variante sans prix");
    if (!allVariantsHaveWeight(unitOnly)) missing.push("au moins une variante sans poids");
  }
  return missing;
}

function validateAnkorstore(p: ExportProduct): string[] {
  const unitOnly = withUnitVariantsOnly(p);
  const missing: string[] = [];
  if (!p.description || p.description.trim().length < 30)
    missing.push("description trop courte (min 30 caractères)");
  if (!p.manufacturingCountryIso) missing.push("pays sans code ISO");
  if (p.compositions.length === 0) missing.push("aucune composition");
  if (unitOnly.variants.length === 0) {
    missing.push("aucune variante à l'unité (les packs ne sont pas exportés vers Ankorstore)");
  } else {
    if (!allVariantsHavePrice(unitOnly)) missing.push("au moins une variante sans prix");
    if (!allVariantsHaveWeight(unitOnly)) missing.push("au moins une variante sans poids");
    // Les images peuvent vivre sur n'importe quelle variante du produit (souvent
    // attachées aux PACK qui ont plus de photos studio). Du moment qu'on en a
    // une quelque part, on l'utilisera comme image pour les variantes UNIT
    // côté générateur — cf. fallback dans `variantImageUrls`.
    if (!anyVariantHasImage(p)) {
      missing.push("aucune image (toutes variantes du produit vides)");
    }
  }
  // Stock pas bloquant : Ankorstore accepte "Hors stock" comme statut.
  void hasAnyStock;
  return missing;
}

/**
 * Faire (Excel) : conditions pour qu'un produit puisse partir dans le fichier
 * d'import Faire. On exporte uniquement les variantes UNIT (les packs ne sont
 * pas pertinents côté Faire).
 *
 * Champs vraiment obligatoires côté modèle Faire :
 *  - nom produit (≤ 60 caractères)
 *  - méthode de vente (toujours « Par article » pour UNIT)
 *  - quantité minimum (1)
 *  - prix EUR wholesale + retail
 *  - au moins 1 image
 *
 * Champs « Facultatifs » mais qu'on remplit si présents : pays d'origine,
 * code SH (recommandé pour les expéditions internationales mais non bloquant
 * à l'import), composition, dimensions. Pour ces champs on N'INTERROMPT PAS
 * l'export — la case reste vide dans le xlsx et la cliente complète après
 * dans le portail Faire si besoin.
 */
function validateFaire(p: ExportProduct): string[] {
  const unitOnly = withUnitVariantsOnly(p);
  const missing: string[] = [];
  const productName = p.translations["fr"]?.name || p.name || "";
  if (!productName.trim()) missing.push("nom produit manquant");
  if (productName.length > 60)
    missing.push("nom produit trop long (max 60 caractères côté Faire)");
  if (unitOnly.variants.length === 0) {
    missing.push("aucune variante à l'unité (les packs ne sont pas exportés vers Faire)");
  } else {
    if (!allVariantsHavePrice(unitOnly)) missing.push("au moins une variante sans prix");
    if (!allVariantsHaveWeight(unitOnly)) missing.push("au moins une variante sans poids");
    if (!anyVariantHasImage(p)) {
      missing.push("aucune image (Faire en exige au moins une par produit)");
    }
  }
  return missing;
}

/** Run validation for a list of products on one marketplace. */
export function validateProductsForMarketplace(
  products: ExportProduct[],
  marketplace: MarketplaceKey,
): MarketplaceEligibility[] {
  const validator =
    marketplace === "pfs"
      ? validatePfs
      : marketplace === "efashion"
        ? validateEfashion
        : marketplace === "microstore"
          ? validateMicrostore
          : marketplace === "ankorstore"
            ? validateAnkorstore
            : validateFaire;

  return products.map((p) => {
    const missing = validator(p);
    return {
      productId: p.id,
      reference: p.reference,
      eligible: missing.length === 0,
      missing,
    };
  });
}
