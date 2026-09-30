/**
 * Suffixe de ref eFashion pour désambiguïser plusieurs ProductColor BJ qui
 * partagent la même `Color` (typiquement quand la cliente vend 3 combos de
 * tailles distincts sur la même couleur — S/M, M/L, L/XL — comme lots UNIT
 * séparés). Sans suffixe, les fiches eFashion héritent toutes de la même ref
 * (`10037-NOIR`) → conflit d'unicité au push.
 *
 * Cf. `lib/efashion-update.ts` où la map est consommée pour forcer une
 * `input.reference` unique par variante quand plusieurs ProductColor pointent
 * vers la même Color.
 */

interface ReferenceSuffixInput {
  key: string;
  colorId: string | null;
  sizeName: string | null;
}

/**
 * Sanitize un nom de taille pour l'utiliser en suffixe de ref : retire
 * espaces, slashes, tirets et met en majuscules. "S/M" → "SM", "36 / 38" →
 * "3638", "Taille unique" → "TAILLEUNIQUE".
 */
function sanitizeSizeLabel(sizeName: string): string {
  return sizeName.replace(/[\s/\-]/g, "").toUpperCase();
}

/**
 * Renvoie une map `key → suffixe` pour les variants qui partagent une Color
 * avec un autre variant. Les variants sans doublon de Color sont absents de
 * la map (l'appelant garde alors la ref actuelle telle quelle).
 */
export function computeEfashionReferenceSuffixes(
  variants: ReadonlyArray<ReferenceSuffixInput>,
): Map<string, string> {
  const result = new Map<string, string>();

  const byColor = new Map<string, ReferenceSuffixInput[]>();
  for (const v of variants) {
    if (v.colorId === null) continue;
    const arr = byColor.get(v.colorId) ?? [];
    arr.push(v);
    byColor.set(v.colorId, arr);
  }

  for (const group of byColor.values()) {
    if (group.length < 2) continue;

    const used = new Set<string>();
    for (let i = 0; i < group.length; i++) {
      const v = group[i]!;
      const baseSuffix = v.sizeName ? sanitizeSizeLabel(v.sizeName) : "";
      const fallback = baseSuffix || String(i + 1);
      let candidate = fallback;
      let dedupe = 2;
      while (used.has(candidate)) {
        candidate = `${fallback}-${dedupe}`;
        dedupe++;
      }
      used.add(candidate);
      result.set(v.key, candidate);
    }
  }

  return result;
}
