/**
 * Alias de compositions PFS — mapping invisible côté cliente.
 *
 * Certaines fiches produits PFS renvoient des libellés ou codes matière
 * qui ne figurent plus dans le dictionnaire PFS canonique (anciens libellés,
 * variantes orthographiques, bugs Salesforce). L'audit/pull compo doit
 * les traiter comme équivalents à leur libellé actuel — sans que la
 * cliente ait à créer un doublon dans sa bibliothèque locale.
 *
 * Chaque entrée mappe une **clé normalisée** (résultat de la normalisation
 * "strip accents + espaces + points + tirets + uppercase" partagée par
 * `normalizeCompositionRef` (pfs-verify.ts) et `normalizeDictKey`
 * (pfs-admin-api.ts)) vers la **clé normalisée canonique** utilisée par
 * les compositions locales.
 *
 * Exemple : PFS envoie "Elastane" (ancien libellé anglais) → normalisation
 * "ELASTANE" → alias vers "ELASTHANNE" (libellé canonique BJ + PFS actuel).
 */
const PFS_COMPOSITION_ALIASES: Record<string, string> = {
  ELASTANE: "ELASTHANNE",
};

/**
 * Applique la table d'alias sur une clé déjà normalisée (uppercase, sans
 * accents ni ponctuation). Retourne la clé canonique si un alias existe,
 * sinon la clé d'origine. Callable en fin de chaque fonction de
 * normalisation compo.
 */
export function canonicalizePfsCompositionKey(normalizedKey: string): string {
  return PFS_COMPOSITION_ALIASES[normalizedKey] ?? normalizedKey;
}
