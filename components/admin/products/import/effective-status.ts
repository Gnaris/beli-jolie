/**
 * Évalue le statut effectif d'un produit en tenant compte des modifications
 * locales (overrides) faites dans la carte éditable.
 *
 * Distinction clé :
 *  - Erreurs « X manquant » → résolues dès que le champ est rempli (non vide)
 *  - Erreurs « X "valeur" introuvable » → résolues uniquement si la nouvelle
 *    valeur (override ou Excel) est présente dans la liste des entités valides
 *
 * Sans cette distinction, l'erreur « Catégorie "Bracelet" introuvable »
 * disparaissait alors que la valeur restait incorrecte (parce que le champ
 * était simplement non vide).
 */
import type { PreviewProduct } from "@/app/api/admin/products/import/preview/route";
import type { ProductOverride } from "./EditableProductCard";

type OverrideField = keyof ProductOverride | "_size_details_tu";

export interface ValidOptions {
  categories?: string[];
  subCategories?: string[];
  colors?: string[];
  countries?: string[];
  seasons?: string[];
  compositions?: string[];
  hsCodes?: string[];
  /** Couleurs des variantes du produit (pour valider la « Couleur principale »). */
  variantColors?: string[];
}

interface ResolutionRule {
  matcher: RegExp;
  field: OverrideField;
  /** Si défini, la valeur effective doit aussi appartenir à cette liste. */
  validIn?: keyof ValidOptions;
}

const ERROR_RESOLUTIONS: ResolutionRule[] = [
  // ── Erreurs « manquant » : non-vide suffit ──
  { matcher: /nom\s+manquant/i,                  field: "name" },
  { matcher: /description\s+manquante/i,         field: "description" },
  { matcher: /cat[ée]gorie\s+manquante/i,        field: "category" },
  { matcher: /composition\s+manquante/i,         field: "composition" },
  { matcher: /pays\s+de\s+fabrication\s+manquant/i, field: "manufacturingCountry" },
  { matcher: /saison\s+manquante/i,              field: "season" },
  { matcher: /d[ée]tail\s+taille\s+unique\s+manquant/i, field: "_size_details_tu" },

  // ── Erreurs « introuvable / inexistant » : valeur doit être valide ──
  { matcher: /cat[ée]gorie\b.*\b(introuvable|inexistante|inconnue|invalide)/i,
    field: "category", validIn: "categories" },
  { matcher: /sous[\s-]?cat[ée]gorie/i,                                       // tolérant
    field: "subCategories" },
  { matcher: /composition\b.*\b(introuvable|inexistante|inconnue|invalide)/i,
    field: "composition", validIn: "compositions" },
  { matcher: /pays\b.*\b(introuvable|inexistant|inconnu|invalide)/i,
    field: "manufacturingCountry", validIn: "countries" },
  { matcher: /saison\b.*\b(introuvable|inexistante|inconnue|invalide)/i,
    field: "season", validIn: "seasons" },
  { matcher: /couleur\s+principale\b.*\b(introuvable|inexistante|inconnue|invalide)/i,
    field: "primaryColor", validIn: "variantColors" },
  { matcher: /code\s+sh|hs\s*code/i,
    field: "hsCode", validIn: "hsCodes" },
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

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Retourne les erreurs « produit » effectives — celles qui restent après
 *  application des overrides locaux ET vérification de la validité des entités. */
export function effectiveProductErrors(
  product: PreviewProduct,
  override: ProductOverride,
  validOptions: ValidOptions = {},
): string[] {
  return product.productErrors.filter((err) => {
    for (const r of ERROR_RESOLUTIONS) {
      if (!r.matcher.test(err)) continue;
      const value = readValue(override, product, r.field);
      if (!value) continue; // non vide requis dans tous les cas

      if (r.validIn) {
        const list = validOptions[r.validIn];
        if (!list || list.length === 0) continue; // pas de liste fournie → on ne peut pas valider, on laisse l'erreur
        const valueNorm = normalize(value);
        const isValid = list.some((v) => normalize(v) === valueNorm);
        if (!isValid) continue; // valeur encore invalide → erreur reste
      }

      return false; // erreur résolue
    }
    return true;
  });
}

/** Un produit est « prêt à importer » s'il n'a aucune erreur effective et
 *  qu'il n'existe pas déjà en base. */
export function isProductReady(
  product: PreviewProduct,
  override: ProductOverride,
  validOptions: ValidOptions = {},
): boolean {
  if (product.referenceExists) return false;
  if (product.variants.some((v) => v.errors.length > 0)) return false;
  if (effectiveProductErrors(product, override, validOptions).length > 0) return false;
  return true;
}
