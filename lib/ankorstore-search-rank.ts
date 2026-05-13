/**
 * Scoring de pertinence pour les résultats de recherche Ankorstore.
 *
 * `filter[skuOrName]` côté API Ankorstore renvoie des résultats dans un
 * ordre opaque (souvent par date de création), donc une référence comme
 * "A405" peut se retrouver perdue derrière 50 produits non pertinents
 * dont un SKU ou un nom contient juste "a405" par hasard.
 *
 * On récupère un panier plus large que ce qu'on veut afficher, puis on
 * trie par score décroissant avant de tronquer.
 */

import type { AnkorstoreProduct } from "@/lib/ankorstore-api";
import { extractReference } from "@/lib/ankorstore-match";

/**
 * Score un produit Ankorstore par rapport à une requête.
 * Plus le score est élevé, plus le résultat est pertinent.
 *
 * Échelle indicative :
 *   100 — référence extraite identique (ex : "A405" === "A405")
 *    90 — un SKU de variante est exactement la requête
 *    80 — un SKU commence par "{query}_" (convention SKU de notre site)
 *    70 — un SKU commence par la requête (autre format)
 *    60 — la référence extraite commence par la requête
 *    50 — un SKU contient la requête
 *    40 — le nom du produit commence par la requête
 *    30 — le nom du produit contient la requête
 *    10 — match indirect renvoyé par Ankorstore mais sans rapport direct
 */
export function scoreAnkorstoreSearchResult(
  product: AnkorstoreProduct,
  query: string,
): number {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 0;

  const qUnderscore = `${q}_`;

  const extracted = extractReference(product)?.toLowerCase() ?? null;
  if (extracted === q) return 100;

  const skus = product.variants
    .map((v) => v.sku?.toLowerCase().trim())
    .filter((s): s is string => !!s);

  if (skus.some((s) => s === q)) return 90;
  if (skus.some((s) => s.startsWith(qUnderscore))) return 80;
  if (skus.some((s) => s.startsWith(q))) return 70;

  if (extracted && extracted.startsWith(q)) return 60;

  if (skus.some((s) => s.includes(q))) return 50;

  const name = product.name?.toLowerCase() ?? "";
  if (name.startsWith(q)) return 40;
  if (name.includes(q)) return 30;

  return 10;
}

/**
 * Trie les résultats par pertinence décroissante. Tri stable : à score égal,
 * l'ordre d'origine renvoyé par Ankorstore est préservé (utile parce qu'ils
 * trient déjà par date plus récente d'abord, ce qui est un proxy raisonnable
 * de pertinence en cas d'égalité).
 */
export function sortAnkorstoreSearchResults(
  products: AnkorstoreProduct[],
  query: string,
): AnkorstoreProduct[] {
  return products
    .map((p, i) => ({ p, i, score: scoreAnkorstoreSearchResult(p, query) }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.i - b.i;
    })
    .map((entry) => entry.p);
}
