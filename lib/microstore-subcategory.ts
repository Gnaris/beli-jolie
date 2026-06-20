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
