/**
 * Orderchamp API Authentication
 *
 * Auth simple : Bearer token privé (Authorization: Bearer <token>).
 * Le token est généré depuis les réglages du back-office Orderchamp
 * (Settings → API) et reste valide jusqu'à révocation manuelle.
 *
 * OAuth 2.0 alternatif possible pour app multi-brand — non implémenté ici
 * (une clé par tenant suffit, chaque tenant a son propre compte fournisseur).
 *
 * La clé est lue depuis SiteConfig.orderchamp_api_key (chiffrée via SENSITIVE_KEYS).
 */

import { getCachedOrderchampApiKey } from "@/lib/cached-data";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";

export const ORDERCHAMP_BASE_URL = "https://api.orderchamp.com/v1/graphql";

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
 */
export function primeOrderchampApiKey(tenantId: string, apiKey: string): void {
  const trimmed = apiKey.trim();
  if (trimmed) primedApiKeyByTenant.set(tenantId, trimmed);
  else primedApiKeyByTenant.delete(tenantId);
}

/**
 * Retourne la clé Orderchamp (déchiffrée) pour le tenant courant, ou null.
 */
export async function getOrderchampApiKey(): Promise<string | null> {
  const tid = await resolveCurrentTenantId();
  const primed = primedApiKeyByTenant.get(tid);
  if (primed) return primed;
  return getCachedOrderchampApiKey();
}

/**
 * Headers standard pour appeler l'endpoint GraphQL Orderchamp.
 * Throw si la clé n'est pas configurée (bug d'appel hors flow normal).
 */
export async function getOrderchampHeaders(): Promise<Record<string, string>> {
  const key = await getOrderchampApiKey();
  if (!key) {
    throw new Error(
      "Clé API Orderchamp manquante — configurer dans Paramètres > Marketplaces",
    );
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (compatible; BeliJolie/1.0; +https://beliandjolie.com)",
  };
}

/**
 * Teste une clé API Orderchamp sans la persister. Ping GraphQL très léger :
 * `{ viewer { id } }` ou équivalent. Distingue invalide (401) / temporaire (5xx).
 */
export async function testOrderchampApiKey(
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  const key = apiKey.trim();
  if (!key) return { valid: false, error: "Clé API vide." };

  try {
    const res = await fetch(ORDERCHAMP_BASE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; BeliJolie/1.0; +https://beliandjolie.com)",
      },
      body: JSON.stringify({ query: "{ viewer { id email } }" }),
    });

    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Clé API Orderchamp invalide ou révoquée." };
    }
    if (!res.ok) {
      return {
        valid: false,
        error: `Orderchamp a répondu HTTP ${res.status}. Réessayez plus tard.`,
      };
    }
    const body = (await res.json().catch(() => null)) as {
      data?: { viewer?: { id?: string } };
      errors?: Array<{ message?: string }>;
    } | null;
    if (body?.errors && body.errors.length > 0) {
      const first = body.errors[0]?.message ?? "Erreur GraphQL inconnue.";
      const lower = first.toLowerCase();
      if (lower.includes("unauth") || lower.includes("token")) {
        return { valid: false, error: "Clé API Orderchamp invalide ou révoquée." };
      }
      return { valid: false, error: first };
    }
    if (!body?.data?.viewer?.id) {
      return { valid: false, error: "Réponse Orderchamp inattendue (pas de viewer)." };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Impossible de contacter Orderchamp." };
  }
}
