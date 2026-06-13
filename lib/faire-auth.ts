/**
 * Faire API Authentication
 *
 * Auth très simple : un seul header `X-FAIRE-ACCESS-TOKEN` sur toutes les
 * requêtes. Pas d'OAuth, pas de refresh — la clé reste valide jusqu'à
 * révocation manuelle côté brand Faire.
 *
 * Voir docs/faire-api.md §1 pour le détail (mode OAuth alternatif possible
 * mais non implémenté — utile seulement pour des apps multi-brands).
 *
 * La clé est lue depuis SiteConfig.faire_api_key (chiffrée via SENSITIVE_KEYS).
 */

import { getCachedFaireApiKey } from "@/lib/cached-data";

export const FAIRE_BASE_URL = "https://www.faire.com/external-api/v2";

/**
 * Identifiant pré-amorcé pour usage CLI (scripts npx tsx), même pattern que
 * `primeAnkorstoreCredentials`. Quand renseigné, `getFaireApiKey` court-circuite
 * `getCachedFaireApiKey` qui dépend de `unstable_cache` (lequel plante hors
 * contexte Next.js avec une erreur « incrementalCache missing »).
 */
let primedApiKey: string | null = null;

export function primeFaireApiKey(apiKey: string): void {
  primedApiKey = apiKey.trim() || null;
}

/**
 * Get the Faire API key (decrypted). Returns null si non configurée.
 */
export async function getFaireApiKey(): Promise<string | null> {
  if (primedApiKey) return primedApiKey;
  return getCachedFaireApiKey();
}

/**
 * Headers standard pour les requêtes Faire. Throw si la clé n'est pas
 * configurée (= bug d'appel hors flow normal).
 */
export async function getFaireHeaders(): Promise<Record<string, string>> {
  const key = await getFaireApiKey();
  if (!key) {
    throw new Error(
      "Clé API Faire manquante — configurer dans Paramètres > Marketplaces"
    );
  }
  return {
    "X-FAIRE-ACCESS-TOKEN": key,
    Accept: "application/json",
    // UA réaliste obligatoire — Cloudflare devant www.faire.com renvoie 403
    // sur les UA "bot" (curl, node-fetch par défaut, etc.).
    "User-Agent":
      "Mozilla/5.0 (compatible; BeliJolie/1.0; +https://beliandjolie.com)",
  };
}

/**
 * Teste une clé API Faire sans la persister. Fait un appel léger sur
 * `GET /products?limit=10` (la plus petite valeur acceptée par l'API).
 * Distingue invalid (401) / temporaire (5xx, réseau) pour un message utile.
 */
export async function testFaireApiKey(
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  const key = apiKey.trim();
  if (!key) return { valid: false, error: "Clé API vide." };

  try {
    const res = await fetch(`${FAIRE_BASE_URL}/products?limit=10&page=1`, {
      method: "GET",
      headers: {
        "X-FAIRE-ACCESS-TOKEN": key,
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; BeliJolie/1.0; +https://beliandjolie.com)",
      },
    });

    if (res.status === 200) {
      return { valid: true };
    }
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Clé API Faire invalide ou révoquée." };
    }
    return {
      valid: false,
      error: `Faire a répondu HTTP ${res.status}. Réessayez plus tard.`,
    };
  } catch {
    return { valid: false, error: "Impossible de contacter Faire." };
  }
}
