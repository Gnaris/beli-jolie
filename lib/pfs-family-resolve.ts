/**
 * Helpers purs (pas d'I/O, pas de Prisma) pour résoudre / valider les
 * noms de familles PFS. Vit dans son propre module pour pouvoir être
 * importé depuis des server actions légères sans tirer toute la chaîne
 * `pfs-import.ts` (qui dépend de Prisma, de l'API PFS, du cache, etc.).
 */

import {
  PFS_FAMILIES_BY_GENDER,
  PFS_SUBCATEGORIES_BY_FAMILY,
} from "@/lib/marketplace-excel/pfs-taxonomy";

/**
 * Renvoie une `pfsFamilyName` validée :
 *   - Si la valeur correspond à un nom déjà connu dans la taxonomie → la garde
 *   - Sinon (ex: identifiant Salesforce brut "a035J00000185J7QAI") → null
 *
 * Évite que des IDs bruts non lisibles s'affichent dans la modale ou se
 * retrouvent enregistrés dans `Category.pfsFamilyName`.
 */
export function sanitizePfsFamilyName(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  for (const families of Object.values(PFS_FAMILIES_BY_GENDER)) {
    if (families.includes(trimmed)) return trimmed;
  }
  return null;
}

/**
 * Recherche inverse : à partir du libellé de catégorie PFS (ex: "Bagues"),
 * retrouve la famille qui la contient (ex: "Bijoux_Fantaisie") en parcourant
 * la taxonomie locale. Sert de filet de sécurité quand la résolution via
 * `pfsGetFamilies()` échoue (ID Salesforce non résolu) — sans cette piste
 * de secours, on retomberait sur l'ID brut côté UI et en BDD.
 *
 * Quand une sous-catégorie apparaît dans plusieurs familles (ex: "Bagues"
 * existe en Bijoux_Fantaisie ET Bijoux_H), on renvoie la première trouvée
 * dans l'ordre d'insertion de la taxonomie — généralement la plus large /
 * la plus probable. C'est suffisant pour le filet de sécurité ; si l'API
 * répond correctement, sa résolution prend la priorité avant cet helper.
 */
export function inferPfsFamilyFromCategoryLabel(
  catLabel: string | null | undefined,
): string | null {
  if (!catLabel) return null;
  const trimmed = catLabel.trim();
  if (!trimmed) return null;
  for (const [family, subs] of Object.entries(PFS_SUBCATEGORIES_BY_FAMILY)) {
    if (subs.includes(trimmed)) return family;
  }
  return null;
}
