/**
 * Synonymes de noms de couleur utilisés lors du matching variant local ↔
 * Ankorstore. Permet à « Brun » et « Marron » (par exemple) d'être considérés
 * comme la même couleur quand on apparie une variante locale à sa jumelle
 * Ankorstore.
 *
 * À chaque clé canonique on associe l'ensemble des libellés qui s'y rattachent.
 * Toutes les comparaisons se font normalisées (uppercase, sans accents, sans
 * caractères non alphanumériques).
 *
 * Utilisé par :
 *   - lib/ankorstore-match.ts (`matchVariants` côté liste de produits AS)
 *   - lib/ankorstore-variant-link.ts (`colorKeyOf` côté filet de rattrapage)
 */

const SYNONYM_GROUPS: string[][] = [
  // Brun / Marron — chez Ankorstore les SKU utilisent souvent "Marron" alors
  // que dans notre bibliothèque la couleur s'appelle "Brun".
  ["BRUN", "MARRON"],
];

const synonymMap = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  const canonical = group[0];
  for (const term of group) synonymMap.set(term, canonical);
}

/**
 * Normalise un libellé couleur en une clé canonique comparable.
 *   - uppercase
 *   - sans accents (NFD + suppression des diacritiques)
 *   - sans caractères non alphanumériques
 *   - puis remappé sur la forme canonique si synonyme connu
 */
export function canonicalColorKey(raw: string): string {
  const normalized = raw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return synonymMap.get(normalized) ?? normalized;
}
