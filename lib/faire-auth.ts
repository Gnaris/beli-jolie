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
import { getCurrentTenantIdSync } from "@/lib/tenant-als";

export const FAIRE_BASE_URL = "https://www.faire.com/external-api/v2";

// CRITIQUE multi-tenant : primed API key PAR tenant. Sans ça, si un script CLI
// prime la clé Issyma, tous les tenants suivants (dont BJ) l'utilisent.
const primedApiKeyByTenant = new Map<string, string>();

async function resolveCurrentTenantId(): Promise<string> {
  let tid = getCurrentTenantIdSync();
  if (!tid) {
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      tid = h.get("x-tenant-id");
    } catch {
      // hors requête
    }
  }
  return tid ?? "global";
}

/**
 * Amorce une clé API pour un tenant spécifique (usage CLI).
 * Requiert de passer explicitement le tenantId.
 */
export function primeFaireApiKey(tenantId: string, apiKey: string): void {
  const trimmed = apiKey.trim();
  if (trimmed) primedApiKeyByTenant.set(tenantId, trimmed);
  else primedApiKeyByTenant.delete(tenantId);
}

/**
 * Get the Faire API key (decrypted) POUR LE TENANT COURANT. Returns null si non
 * configurée.
 */
export async function getFaireApiKey(): Promise<string | null> {
  const tid = await resolveCurrentTenantId();
  const primed = primedApiKeyByTenant.get(tid);
  if (primed) return primed;
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
