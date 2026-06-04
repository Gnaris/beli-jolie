/**
 * Évalue le statut effectif d'un produit en tenant compte des modifications
 * locales (overrides) faites dans la carte éditable. Permet au bouton
 * « Confirmer l'importation » de s'activer dès que les erreurs serveur ont
 * été corrigées en ligne — sans attendre un re-upload du fichier.
 */
import type { PreviewProduct } from "@/app/api/admin/products/import/preview/route";
import type { ProductOverride } from "./EditableProductCard";

type OverrideField = keyof ProductOverride | "_size_details_tu";

/**
 * Règles de résolution : un message d'erreur serveur est considéré comme
 * « résolu » dès que le `field` correspondant a une valeur non vide dans
 * l'override (ou dans la donnée d'origine).
 *
 * Le matcher utilise une regex pour couvrir les variantes :
 *  - « Catégorie manquante. »
 *  - « Catégorie "Bracelet" introuvable. »
 *  - « Catégorie XYZ inexistante »
 */
const ERROR_RESOLUTIONS: { matcher: RegExp; field: OverrideField }[] = [
  { matcher: /nom\s+(manquant|introuvable|inexistant|inconnu|invalide)/i,                               field: "name" },
  { matcher: /description\s+(manquante|introuvable|inexistante|invalide)/i,                             field: "description" },
  { matcher: /cat[ée]gorie\b/i,                                                                         field: "category" },
  { matcher: /sous[\s-]?cat[ée]gorie/i,                                                                 field: "subCategories" },
  { matcher: /composition/i,                                                                            field: "composition" },
  { matcher: /pays(\s+de\s+fabrication)?\b/i,                                                           field: "manufacturingCountry" },
  { matcher: /saison/i,                                                                                 field: "season" },
  { matcher: /couleur\s+principale/i,                                                                   field: "primaryColor" },
  { matcher: /d[ée]tail\s+taille\s+unique/i,                                                            field: "_size_details_tu" },
  { matcher: /code\s+sh|hs\s*code/i,                                                                    field: "hsCode" },
];

function readValue(override: ProductOverride, product: PreviewProduct, field: OverrideField): string {
  if (field === "_size_details_tu") {
    return String(override.sizeDetailsTu ?? (product as unknown as { sizeDetailsTu?: string }).sizeDetailsTu ?? "").trim();
  }
  const ov = override[field];
  if (ov !== undefined && ov !== null) return String(ov).trim();
  const fallback = (product as unknown as Record<string, unknown>)[field as string];
  return typeof fallback === "string" ? fallback.trim() : "";
}

/** Retourne les erreurs « produit » effectives — celles qui restent après
 *  application des overrides locaux. */
export function effectiveProductErrors(
  product: PreviewProduct,
  override: ProductOverride,
): string[] {
  return product.productErrors.filter((err) => {
    for (const r of ERROR_RESOLUTIONS) {
      if (r.matcher.test(err) && readValue(override, product, r.field)) {
        return false;
      }
    }
    return true;
  });
}

/** Un produit est « prêt à importer » s'il n'a aucune erreur effective et
 *  qu'il n'existe pas déjà en base. */
export function isProductReady(
  product: PreviewProduct,
  override: ProductOverride,
): boolean {
  if (product.referenceExists) return false;
  if (product.variants.some((v) => v.errors.length > 0)) return false;
  if (effectiveProductErrors(product, override).length > 0) return false;
  return true;
}
