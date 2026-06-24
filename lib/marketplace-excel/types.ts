/**
 * Shared types for marketplace Excel export (PFS, Efashion, Microstore, Ankorstore).
 *
 * An ExportProduct is a denormalized view of a Product in DB, with everything
 * needed to emit rows to the Excel templates of any of the 4 marketplaces.
 */

import type {
  MarkupConfig,
  AllMarkupConfigs,
} from "@/lib/marketplace-pricing";

export type SaleTypeKey = "UNIT" | "PACK";

export type MarketplaceKey = "pfs" | "efashion" | "microstore" | "ankorstore";

/**
 * Choix du contenu inclus dans l'export marketplace :
 *  - "both"        : Excel + images (comportement historique, défaut)
 *  - "excel-only"  : uniquement le(s) fichier(s) Excel
 *  - "images-only" : uniquement les images
 *
 * Ankorstore : "images-only" n'a pas de sens (images via URL), refusé côté
 * orchestrator + API et désactivé dans l'UI.
 */
export type ExportMode = "both" | "excel-only" | "images-only";

export interface ExportVariantSize {
  name: string;
  quantity: number;
  /** PFS reference (e.g. "TU", "XS", "52"). Null/undefined = size not mapped to PFS yet. */
  pfsSizeRef?: string | null;
}

export interface ExportPackLine {
  /** Resolved color name (Color.name). */
  colorName: string;
  sizes: ExportVariantSize[];
}

export interface ExportVariant {
  variantId: string;
  saleType: SaleTypeKey;
  /** UNIT/PACK mono-couleur : 1 nom. PACK multi-couleurs : N noms (lignes du pack). */
  colorNames: string[];
  packQuantity: number | null;
  sizes: ExportVariantSize[];
  /** PACK multi-couleurs : si présent, supplante colorNames/sizes pour la composition réelle. */
  packLines?: ExportPackLine[];
  unitPrice: number;
  weight: number;
  stock: number;
  sku: string | null;
  imagePaths: string[];
}

export interface ExportCompositionEntry {
  name: string;
  percentage: number;
  /** Référence PFS (libellé FR utilisé tel quel, ex : "Acier Inoxydable"). */
  pfsRef?: string | null;
  /** ID eFashion (entier) pour la composition — requis pour Efashion. */
  efashionId?: number | null;
  /** Libellé eFashion résolu depuis les annexes (ex : "Acier" — distinct de "Acier Inoxydable" local). */
  efashionLabel?: string | null;
}

export interface ExportProduct {
  id: string;
  reference: string;
  name: string;
  description: string;

  // PFS taxonomy
  pfsGenderCode: string | null; // WOMAN | MAN | KID | SUPPLIES
  pfsFamilyName: string | null; // ex: "Bijoux_Fantaisie"
  pfsCategoryName: string | null; // ex: "Bagues", "Colliers" — PFS column 4
  categoryName: string; // local name, fallback when pfsCategoryName is null
  /** Étiquette à utiliser dans la colonne « Catégorie » de l'export Microstore.
   *  - Si la cliente a choisi une sous-catégorie comme étiquette Microstore :
   *    nom de cette sous-catégorie.
   *  - Sinon (défaut) : null. Le générateur retombe alors sur la catégorie
   *    principale (cf. generate-microstore.ts). */
  microstoreCategoryOverride: string | null;

  /** Code SH (Système Harmonisé) — pour Ankorstore (douane). */
  hsCode: string | null;

  // eFashion category (3-level path: top > sub > leaf)
  efashionCategorieId: number | null;
  efashionCategoryPath: { top: string; sub: string; leaf: string } | null;

  // Season
  seasonPfsRef: string | null; // "AH2025" | "PE2026" | …
  seasonEfashionCollectionId: number | null;
  /** Libellé collection eFashion résolu depuis les annexes (ex : "Toutes les saisons"). */
  seasonEfashionLabel: string | null;
  seasonName: string | null; // local season name (fallback)

  // Country of manufacture
  manufacturingCountryName: string | null; // French name (e.g. "Chine")
  manufacturingCountryIso: string | null; // ISO2 ("CN")
  manufacturingCountryEfashionProvenanceId: number | null;

  // Composition (ordered)
  compositions: ExportCompositionEntry[];

  // Dimensions (mm, all optional)
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;

  // Translations: locale → { name, description }
  translations: Record<string, { name: string; description: string }>;

  variants: ExportVariant[];
}

/** Legacy alias (kept for backwards-compat — used by helpers.ts and tests). */
export interface MarkupConfigs {
  pfs: MarkupConfig;
  efashion: MarkupConfig;
  microstore: MarkupConfig;
  ankorstoreWholesale: MarkupConfig;
  ankorstoreRetail: MarkupConfig;
  ankorstoreVatRate: number;
}

export interface ExportContext {
  shopName: string; // brand name (from CompanyInfo.shopName)
  markups: AllMarkupConfigs;
  /** Public base URL of the site (e.g. "https://beliandjolie.com"). */
  publicBaseUrl: string;
}

/** Result of validating one product against one marketplace's required fields. */
export interface MarketplaceEligibility {
  productId: string;
  reference: string;
  eligible: boolean;
  /** Human-readable French reasons why the product can't be exported, e.g. ["pas de poids", "catégorie sans mapping Efashion"]. */
  missing: string[];
}

/** Header row index (1-based) for each marketplace template — used so the
 * generator can start writing data rows at the correct offset. */
export const MARKETPLACE_LIMITS: Record<MarketplaceKey, number | null> = {
  pfs: 500,
  efashion: 60,
  microstore: null, // pas de limite
  ankorstore: null, // pas de limite
};
