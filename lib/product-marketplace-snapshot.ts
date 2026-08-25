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
 *   - `similarProductIds` (produits similaires)
 *   - `bundleChildIds` (contenu de l'ensemble)
 *
 * `subCategoryIds` est inclus depuis 2026-08-24 : le mapping catégorie
 * Orderchamp est résolu en priorité via la 1ʳᵉ sous-catégorie mappée
 * (cf. `lib/orderchamp-category-resolve.ts`). Changer une sous-catégorie
 * peut donc changer la catégorie envoyée à OC. Les autres marketplaces
 * ignorent ce champ — la modale n'affiche qu'OC dans ce cas via
 * `buildProductMarketplaceSnapshotExcludingOrderchampFields`.
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
  /** IDs des sous-catégories BJ. Impacte la catégorie envoyée à Orderchamp
   *  (résolue en priorité via la 1ʳᵉ sous-cat mappée alphabétiquement).
   *  Ignoré par PFS / Ankor / eFa / Faire / Microstore. */
  subCategoryIds: string[];
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
    efashionColorIdOverride?: number | null;
    ankorsColorNameOverride?: string | null;
    faireColorNameOverride?: string | null;
    packLines: Array<{
      colorId: string | null;
      sizeEntries: unknown;
      pfsColorRefOverride?: string | null;
      efashionColorIdOverride?: number | null;
      ankorsColorNameOverride?: string | null;
      faireColorNameOverride?: string | null;
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
  countryIsoCode: string | null;
  seasonId: string | null;
  sizeDetailsTu: unknown;
  primaryColorId: string | null;
  /** Sous-catégorie choisie comme étiquette Microstore (null = catégorie
   *  principale). N'impacte QUE Microstore — les autres marketplaces
   *  ignorent complètement ce champ. */
  microstoreSubCategoryId: string | null;
}

/**
 * Champs présents dans le snapshot complet (`buildSnapshot`) mais volontairement
 * exclus du snapshot marketplace. Exporté pour les tests de drift.
 */
export const LOCAL_ONLY_PRODUCT_FIELDS = [
  "tagNames",
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
    // Tri déterministe — l'ordre dans le multi-select peut varier sans
    // impact sémantique, on veut le même snapshot pour {A,B} et {B,A}.
    subCategoryIds: input.subCategoryIds.slice().sort(),
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
      efashionColorIdOverride: v.efashionColorIdOverride ?? null,
      ankorsColorNameOverride: (v.ankorsColorNameOverride ?? "").trim() || null,
      faireColorNameOverride: (v.faireColorNameOverride ?? "").trim() || null,
      packLines: v.packLines.map((pl) => ({
        colorId: pl.colorId,
        sizeEntries: pl.sizeEntries,
        pfsColorRefOverride: pl.pfsColorRefOverride ?? null,
        efashionColorIdOverride: pl.efashionColorIdOverride ?? null,
        ankorsColorNameOverride: (pl.ankorsColorNameOverride ?? "").trim() || null,
        faireColorNameOverride: (pl.faireColorNameOverride ?? "").trim() || null,
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
    countryIsoCode: input.countryIsoCode,
    seasonId: input.seasonId,
    sizeDetailsTu: input.sizeDetailsTu,
    primaryColorId: input.primaryColorId,
    microstoreSubCategoryId: input.microstoreSubCategoryId,
  });
}

/**
 * Snapshot marketplace SANS les champs qui ne concernent QUE Microstore.
 * Permet à `ProductForm` de détecter le cas « seule la sous-catégorie Microstore
 * a changé » : si ce snapshot est inchangé mais que le snapshot complet a
 * changé, alors on peut proposer uniquement Microstore dans la modale de
 * propagation post-save (pas PFS/Ankor/eFa/Faire — ils n'ont rien à recevoir).
 */
export function buildProductMarketplaceSnapshotExcludingMicrostore(
  input: ProductMarketplaceSnapshotInput,
): string {
  return buildProductMarketplaceSnapshot({
    ...input,
    microstoreSubCategoryId: null,
  });
}

/**
 * Snapshot marketplace SANS les champs qui ne concernent QUE Orderchamp.
 * Aujourd'hui = `subCategoryIds` (résolution catégorie OC). Permet à
 * `ProductForm` de détecter « seule la sous-catégorie a changé » → dans ce
 * cas seule la case Orderchamp est proposée dans la modale de propagation.
 */
export function buildProductMarketplaceSnapshotExcludingOrderchampFields(
  input: ProductMarketplaceSnapshotInput,
): string {
  return buildProductMarketplaceSnapshot({
    ...input,
    subCategoryIds: [],
  });
}
