/**
 * Helpers liés à l'étiquette « Catégorie » envoyée à Microstore.
 *
 * La cliente peut choisir, sur la page produit, soit la catégorie principale
 * (défaut) soit l'une des sous-catégories attribuées au produit. Ce choix
 * est stocké dans `Product.microstoreSubCategoryId` (null = catégorie
 * principale). Ce module factorise la normalisation entre create/update/bulk
 * pour garantir qu'un id stocké pointe toujours vers une sous-catégorie
 * réellement attribuée au produit.
 */

/**
 * Retourne l'id de sous-catégorie à stocker dans `Product.microstoreSubCategoryId`.
 *
 * Règles :
 *   - `null` / `undefined` → `null` (= catégorie principale par défaut).
 *   - id présent mais absent de `attributedSubCategoryIds` → `null` (la
 *     cliente a décoché la sous-catégorie sans changer l'étiquette ; on
 *     retombe sur la catégorie principale plutôt que de garder un id
 *     orphelin).
 *   - sinon : id tel quel.
 */
export function normalizeMicrostoreSubCategoryId(
  microstoreSubCategoryId: string | null | undefined,
  attributedSubCategoryIds: string[],
): string | null {
  if (!microstoreSubCategoryId) return null;
  return attributedSubCategoryIds.includes(microstoreSubCategoryId)
    ? microstoreSubCategoryId
    : null;
}

/**
 * Décide, au moment du push Microstore, quelle source (catégorie principale
 * OU sous-catégorie choisie) doit servir d'étiquette « Catégorie » et vérifie
 * qu'elle est bien mappée à un ID Microstore.
 *
 * Règle métier confirmée par la cliente le 2026-08-25 : la sous-catégorie peut
 * remplacer la catégorie principale à condition qu'elle ait son propre mapping
 * Microstore. Sinon le push doit être refusé (message clair remonté à la
 * modale save).
 *
 * Retourne :
 *   - `{ok: true, source, categoryId, categoryName}` si la source retenue est
 *     mappée. `source` distingue l'origine pour le journal/messages.
 *   - `{ok: false, missing}` avec la raison humaine du refus (à ajouter à
 *     `MicrostoreMappingMissingError`).
 */
export interface MicrostoreCategoryChoiceInput {
  categoryName: string;
  categoryMicrostoreId: number | null;
  subCategoryName: string | null;
  subCategoryMicrostoreId: number | null;
}

export type MicrostoreCategoryChoice =
  | {
      ok: true;
      source: "category" | "subcategory";
      categoryId: number;
      categoryName: string;
    }
  | { ok: false; missing: string };

export function resolveMicrostoreCategoryChoice(
  input: MicrostoreCategoryChoiceInput,
): MicrostoreCategoryChoice {
  if (input.subCategoryName) {
    if (input.subCategoryMicrostoreId == null) {
      return {
        ok: false,
        missing: `Sous-catégorie « ${input.subCategoryName} » → à mapper dans /admin/categories (badge M sur la chip de la sous-catégorie)`,
      };
    }
    return {
      ok: true,
      source: "subcategory",
      categoryId: input.subCategoryMicrostoreId,
      categoryName: input.subCategoryName,
    };
  }
  if (input.categoryMicrostoreId == null) {
    return {
      ok: false,
      missing: `Catégorie « ${input.categoryName} » → à mapper dans /admin/categories (carte Microstore)`,
    };
  }
  return {
    ok: true,
    source: "category",
    categoryId: input.categoryMicrostoreId,
    categoryName: input.categoryName,
  };
}
