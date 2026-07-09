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

/* ────────────────────────────────────────────────────────────────────────────
 * Matcher famille / catégorie PFS (pur, testable)
 *
 * Sert les résolveurs `resolvePfsCategoryIds` de `pfs-publish.ts`,
 * `pfs-update.ts` et `pfs-refresh.ts`. Séparé pour que le filtre par genre
 * soit couvert par un test unitaire — sans ce filtre, un mapping ambigu
 * comme « Accessoires » (existe en WOMAN/MAN/KID chez PFS) tombait sur la
 * mauvaise famille au hasard et rendait la catégorie non publiable.
 * ──────────────────────────────────────────────────────────────────────── */

interface PfsFamilyLike {
  id: string;
  labels: Record<string, string> | null | undefined;
  gender: string | null | undefined;
}

interface PfsCategoryLike {
  id: string;
  labels: Record<string, string> | null | undefined;
  gender: string | null | undefined;
  family: string | { id: string } | null | undefined;
}

function pickFrLabel(
  labels: Record<string, string> | null | undefined,
  fallback = "",
): string {
  if (!labels) return fallback;
  return labels.fr ?? labels.en ?? Object.values(labels)[0] ?? fallback;
}

function normalizeName(s: string): string {
  return s.replace(/_/g, " ").trim().toLowerCase();
}

/**
 * Retourne l'ID Salesforce de la famille PFS qui correspond au nom donné
 * pour le genre donné (WOMAN|MAN|KID|SUPPLIES). Retourne null si aucune
 * famille ne matche. Le filtre par genre est indispensable : plusieurs
 * familles PFS partagent le même libellé (ex: « Accessoires » existe en
 * WOMAN, MAN, KID) et sans ce filtre on prend au hasard la première trouvée.
 */
export function matchPfsFamilyId(
  families: PfsFamilyLike[],
  familyName: string | null | undefined,
  gender: string | null | undefined,
): string | null {
  if (!familyName) return null;
  const target = normalizeName(familyName);
  const match = families.find((f) => {
    if (gender && f.gender && f.gender !== gender) return false;
    return normalizeName(pickFrLabel(f.labels, f.id)) === target;
  });
  return match?.id ?? null;
}

/**
 * Retourne l'ID Salesforce de la catégorie PFS qui correspond au nom donné
 * pour le genre + famille donnés. Filtre à la fois par genre (« Corps » existe
 * en WOMAN et MAN chez PFS) et par familyId si connu. Retourne null si aucun
 * match.
 */
export function matchPfsCategoryId(
  categories: PfsCategoryLike[],
  categoryName: string | null | undefined,
  gender: string | null | undefined,
  familyId: string | null | undefined,
): string | null {
  if (!categoryName) return null;
  const target = normalizeName(categoryName);
  const match = categories.find((c) => {
    if (normalizeName(pickFrLabel(c.labels)) !== target) return false;
    if (gender && c.gender && c.gender !== gender) return false;
    if (familyId && c.family) {
      const catFamilyId = typeof c.family === "string" ? c.family : c.family.id;
      if (catFamilyId !== familyId) return false;
    }
    return true;
  });
  return match?.id ?? null;
}
