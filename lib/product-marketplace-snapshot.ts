/**
 * Helper pur de calcul du "snapshot marketplace" pour la modale post-save du
 * formulaire produit (`components/admin/products/ProductForm.tsx`).
 *
 * Le snapshot est une sérialisation déterministe des champs du produit qui ont
 * un impact direct sur les marketplaces (PFS / Ankorstore / eFashion). Si ce
 * snapshot ne change pas entre l'ouverture de la fiche et le save, on saute la
 * modale "Pousser aux marketplaces" — l'utilisatrice n'a touché que des champs
 * locaux et il n'y a rien à propager.
 *
 * Liste des champs EXCLUS (locaux uniquement, jamais envoyés aux marketplaces) :
 *   - `tagNames` (mots-clés)
 *   - `subCategoryIds` (sous-catégories)
 *   - `similarProductIds` (produits similaires)
 *   - `bundleChildIds` (contenu de l'ensemble)
 *
 * ⚠️ Cohérence : si un nouveau champ marketplace-relevant est ajouté à
 * `buildSnapshot` côté ProductForm, il doit être ajouté ici AUSSI. Le test
 * unitaire `product-marketplace-snapshot.test.ts` documente la liste attendue.
 */

export interface ProductMarketplaceSnapshotInput {
  reference: string;
  name: string;
  description: string;
  categoryId: string | null;
  variants: Array<{
    colorId: string | null;
    unitPrice: number | string;
    weight: number | string;
    stock: number | string | null;
    saleType: "UNIT" | "PACK";
    packQuantity: number | string | null;
    sizeEntries: unknown;
    disabled?: boolean;
    pfsColorRefOverride?: string | null;
    packLines: Array<{
      colorId: string | null;
      sizeEntries: unknown;
      pfsColorRefOverride?: string | null;
    }>;
  }>;
  colorImages: Array<{
    groupKey: string;
    uploadedPaths: unknown;
    orders?: unknown;
  }>;
  compositions: unknown;
  isBestSeller: boolean;
  discountPercent: number | string | null;
  dimLength: number | string | null;
  dimWidth: number | string | null;
  dimHeight: number | string | null;
  dimDiameter: number | string | null;
  dimCircumference: number | string | null;
  hsCodeId: string | null;
  productStatus: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  manufacturingCountryId: string | null;
  seasonId: string | null;
  sizeDetailsTu: unknown;
  primaryColorId: string | null;
}

/**
 * Champs présents dans le snapshot complet (`buildSnapshot`) mais volontairement
 * exclus du snapshot marketplace. Exporté pour les tests de drift.
 */
export const LOCAL_ONLY_PRODUCT_FIELDS = [
  "tagNames",
  "subCategoryIds",
  "similarProductIds",
  "bundleChildIds",
] as const;

export function buildProductMarketplaceSnapshot(
  input: ProductMarketplaceSnapshotInput,
): string {
  return JSON.stringify({
    reference: input.reference,
    name: input.name,
    description: input.description,
    categoryId: input.categoryId,
    variants: input.variants.map((v) => ({
      colorId: v.colorId,
      unitPrice: v.unitPrice,
      weight: v.weight,
      stock: v.stock,
      saleType: v.saleType,
      packQuantity: v.packQuantity,
      sizeEntries: v.sizeEntries,
      disabled: v.disabled ?? false,
      pfsColorRefOverride: v.pfsColorRefOverride ?? null,
      packLines: v.packLines.map((pl) => ({
        colorId: pl.colorId,
        sizeEntries: pl.sizeEntries,
        pfsColorRefOverride: pl.pfsColorRefOverride ?? null,
      })),
    })),
    colorImages: input.colorImages.map((ci) => ({
      groupKey: ci.groupKey,
      uploadedPaths: ci.uploadedPaths,
      orders: ci.orders,
    })),
    compositions: input.compositions,
    isBestSeller: input.isBestSeller,
    discountPercent: input.discountPercent,
    dimLength: input.dimLength,
    dimWidth: input.dimWidth,
    dimHeight: input.dimHeight,
    dimDiameter: input.dimDiameter,
    dimCircumference: input.dimCircumference,
    hsCodeId: input.hsCodeId,
    productStatus: input.productStatus,
    manufacturingCountryId: input.manufacturingCountryId,
    seasonId: input.seasonId,
    sizeDetailsTu: input.sizeDetailsTu,
    primaryColorId: input.primaryColorId,
  });
}
