/**
 * Scoring de pertinence des candidats Faire pour le picker de la modale
 * de liaison marketplace.
 *
 * Faire renvoie souvent une variante avec un SKU qui a des suffixes de
 * finition / couleur (676A, 676GD, ED676P…) OU un SKU multi-segment façon
 * `A2630_argent_UNIT_xxxx`. La modale doit alors présenter plusieurs
 * candidats à l'admin. Ce module trie les candidats par pertinence pour
 * que la meilleure fiche apparaisse en tête.
 *
 * Stratégie : on découpe chaque SKU en tokens aux séparateurs `_ - . espace`
 * puis on matche la query contre CHAQUE token. Cela couvre à la fois les
 * SKU compacts (`676A`) et les SKU multi-segment (`A2630_argent_UNIT_xxxx`
 * → tokens `["a2630", "argent", "unit", "xxxx"]`).
 *
 * Barème (le meilleur score parmi tous les tokens de toutes les variantes) :
 *   100 — SKU entier === query (fiche compacte parfaitement identifiée)
 *    95 — un token du SKU === query (fiche multi-segment, ex token "676"
 *          dans SKU "676_argent_UNIT_ab12")
 *    90 — la query commence par un token (query "A2630D" et token "A2630")
 *    80 — SKU entier commence par `{query}_` (convention SKU BJ)
 *    70 — un token commence par la query (query "676" et token "676a")
 *    60 — la query contient un token (SKU au milieu)
 *    50 — un token contient la query (préfixe/mid, ex ED676P)
 *    40 — nom du produit commence par la query
 *    30 — nom du produit contient la query
 *    10 — match indirect renvoyé par Faire sans rapport direct
 *
 * Les cas "query contient token" (90 et 60) exigent un token d'au moins 3
 * caractères pour éviter qu'un token trop court (ex "AB") ne matche par
 * hasard n'importe quelle query qui contient ces lettres.
 */

const SKU_INVERSE_MATCH_MIN_LEN = 3;
const SKU_TOKEN_SEPARATORS = /[_\-.\s/]+/;

export interface FaireScoreableProduct {
  name?: string;
  variants?: Array<{ sku?: string }>;
}

/** Découpe un SKU en tokens (lowercase, non vides) selon `_ - . espace /`. */
export function skuTokens(sku: string): string[] {
  return sku
    .toLowerCase()
    .split(SKU_TOKEN_SEPARATORS)
    .filter((t) => t.length > 0);
}

/**
 * Un SKU (chaîne entière OU un de ses tokens) matche-t-il la query pour un
 * scan "contient" ? Utilisé par le scan Faire pour décider si un produit
 * doit être ramené comme candidat.
 */
export function skuMatchesQuery(sku: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const s = sku.trim().toLowerCase();
  if (!s) return false;
  // Match direct sur la chaîne entière (rapide chemin heureux).
  if (s.includes(q)) return true;
  if (s.length >= SKU_INVERSE_MATCH_MIN_LEN && q.includes(s)) return true;
  // Fallback tokenisé : cas SKU multi-segment façon "A2630_argent_UNIT_x".
  for (const t of skuTokens(s)) {
    if (t.includes(q)) return true;
    if (t.length >= SKU_INVERSE_MATCH_MIN_LEN && q.includes(t)) return true;
  }
  return false;
}

export function scoreFaireCandidate(
  p: FaireScoreableProduct,
  query: string,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const qUnderscore = `${q}_`;
  const rawSkus = (p.variants ?? [])
    .map((v) => (typeof v.sku === "string" ? v.sku.toLowerCase() : ""))
    .filter((s) => s.length > 0);

  // Tokens de toutes les variantes, aplatis. Doublons acceptés (peu importe
  // pour du `some`).
  const tokens: string[] = [];
  for (const s of rawSkus) tokens.push(...skuTokens(s));

  if (rawSkus.some((s) => s === q)) return 100;
  if (tokens.some((t) => t === q)) return 95;

  if (
    tokens.some(
      (t) => t.length >= SKU_INVERSE_MATCH_MIN_LEN && q.startsWith(t),
    )
  ) {
    return 90;
  }

  if (rawSkus.some((s) => s.startsWith(qUnderscore))) return 80;
  if (tokens.some((t) => t.startsWith(q))) return 70;

  if (
    tokens.some(
      (t) => t.length >= SKU_INVERSE_MATCH_MIN_LEN && q.includes(t),
    )
  ) {
    return 60;
  }

  if (tokens.some((t) => t.includes(q))) return 50;

  const name = typeof p.name === "string" ? p.name.toLowerCase() : "";
  if (name.startsWith(q)) return 40;
  if (name.includes(q)) return 30;

  return 10;
}

/** Trie stable des candidats Faire par pertinence décroissante. */
export function sortFaireCandidates<T extends FaireScoreableProduct>(
  products: T[],
  query: string,
): T[] {
  return products
    .map((p, i) => ({ p, i, score: scoreFaireCandidate(p, query) }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.i - b.i;
    })
    .map((entry) => entry.p);
}
