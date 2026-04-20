/**
 * Shared types for marketplace Excel export (PFS + Ankorstore).
 *
 * An ExportProduct is a denormalized view of a Product in DB, with everything
 * needed to emit rows to the Excel templates (resolved names, markup-applied
 * prices, image paths, composition strings, etc.).
 */

export type SaleTypeKey = "UNIT" | "PACK";

export interface ExportVariantSize {
  name: string;
  quantity: number;
  /** PFS reference (e.g. "TU", "XS", "52"). Null/undefined = size not mapped to PFS yet. */
  pfsSizeRef?: string | null;
}

export interface ExportVariant {
  variantId: string;
  saleType: SaleTypeKey;
  // Primary color + optional sub-colors (composition) — UNIT and PACK
  colorNames: string[];
  subColorNames: string[];
  packQuantity: number | null;
  sizes: ExportVariantSize[];
  unitPrice: number; // from DB — total price for PACK, per-unit for UNIT (HT)
  weight: number; // kg per unit (UNIT) or per pack (PACK)
  stock: number;
  sku: string | null;
  // Ordered image DB paths (e.g. "/uploads/products/abc.webp")
  imagePaths: string[];
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

  // Season
  seasonPfsRef: string | null; // "AH2025" | "PE2026" | …

  // Country of manufacture
  manufacturingCountryName: string | null; // French name (e.g. "Chine")
  manufacturingCountryIso: string | null; // ISO2 ("CN")

  // Composition (ordered)
  compositions: { name: string; percentage: number }[];

  // Translations: locale → { name, description }
  translations: Record<string, { name: string; description: string }>;

  variants: ExportVariant[];
}

export interface MarkupConfigs {
  pfs: import("@/lib/marketplace-pricing").MarkupConfig;
  ankorstoreWholesale: import("@/lib/marketplace-pricing").MarkupConfig;
  ankorstoreRetail: import("@/lib/marketplace-pricing").MarkupConfig;
}

export interface ExportContext {
  shopName: string; // brand name (from CompanyInfo.shopName)
  markups: MarkupConfigs;
  ankorstoreVatRate: number; // e.g. 20 (percent)
  r2PublicUrl: string; // e.g. "https://pub-xxx.r2.dev"
}
