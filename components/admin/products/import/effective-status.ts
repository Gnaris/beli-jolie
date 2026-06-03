/**
 * Évalue le statut effectif d'un produit en tenant compte des modifications
 * locales (overrides) faites dans la carte éditable. Permet au bouton
 * « Confirmer l'importation » de s'activer dès que les erreurs serveur ont
 * été corrigées en ligne — sans attendre un re-upload du fichier.
 */
import type { PreviewProduct } from "@/app/api/admin/products/import/preview/route";
import type { ProductOverride } from "./EditableProductCard";

/** Liste des erreurs serveur qui sont automatiquement levées dès que la valeur
 *  correspondante n'est plus vide dans l'override (ou la donnée d'origine). */
const ERROR_RESOLUTIONS: { pattern: string; field: keyof ProductOverride | "_size_details_tu" }[] = [
  { pattern: "Nom manquant",                  field: "name" },
  { pattern: "Description manquante",         field: "description" },
  { pattern: "Catégorie manquante",           field: "category" },
  { pattern: "Composition manquante",         field: "composition" },
  { pattern: "Pays de fabrication manquant",  field: "manufacturingCountry" },
  { pattern: "Saison manquante",              field: "season" },
  { pattern: "Détail taille unique manquant", field: "sizeDetailsTu" },
];

/** Retourne les erreurs « produit » effectives — celles qui restent après
 *  application des overrides locaux. */
export function effectiveProductErrors(
  product: PreviewProduct,
  override: ProductOverride,
): string[] {
  const value = (field: keyof ProductOverride | "_size_details_tu"): string => {
    if (field === "_size_details_tu") return String(override.sizeDetailsTu ?? "").trim();
    const ov = override[field];
    if (ov !== undefined) return String(ov ?? "").trim();
    // Fallback sur la donnée serveur (uniquement pour les champs qui sont
    // exposés sur PreviewProduct)
    const fallback = (product as unknown as Record<string, unknown>)[field as string];
    return typeof fallback === "string" ? fallback.trim() : "";
  };

  return product.productErrors.filter((err) => {
    for (const r of ERROR_RESOLUTIONS) {
      if (err.includes(r.pattern) && value(r.field)) return false;
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
