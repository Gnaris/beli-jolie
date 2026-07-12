/**
 * Ankorstore OAuth2 Authentication
 *
 * Manages OAuth2 client_credentials flow with in-memory token cache.
 * Auto-refreshes 5 minutes before expiration.
 *
 * Credentials are read from admin settings (SiteConfig).
 */

import { getCachedAnkorstoreCredentials } from "@/lib/cached-data";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";
import { logger } from "@/lib/logger";

export const ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1";
const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";

interface TokenCache {
  accessToken: string;
  expiresAt: number; // timestamp ms
}

// CRITIQUE multi-tenant : cache PAR tenant. Sans ça, le token du 1er tenant qui
// s'authentifie est réutilisé par TOUS les tenants suivants → un push BJ part
// sur le compte Ankorstore d'Issyma (et inversement).
const tokenCacheByTenant = new Map<string, TokenCache>();
const primedCredentialsByTenant = new Map<string, { clientId: string; clientSecret: string }>();
const pendingAuthByTenant = new Map<string, Promise<string>>();

async function resolveCurrentTenantId(): Promise<string> {
  let tid = getCurrentTenantIdSync();
  if (!tid) {
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      tid = h.get("x-tenant-id");
    } catch {
      // hors requête → clé fallback (jobs cron/tests)
    }
  }
  return tid ?? "global";
}

/**
 * Get a valid Ankorstore OAuth2 access token.
 * Returns cached token if still valid (with 5-min buffer), otherwise re-authenticates.
 * Concurrent callers share a single auth round-trip.
 */
export async function getAnkorstoreToken(): Promise<string> {
  const tid = await resolveCurrentTenantId();
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  const cachedToken = tokenCacheByTenant.get(tid);
  if (cachedToken && cachedToken.expiresAt - bufferMs > Date.now()) {
    return cachedToken.accessToken;
  }

  const pending = pendingAuthByTenant.get(tid);
  if (pending) return pending;

  const primed = primedCredentialsByTenant.get(tid);

  const authPromise = (async () => {
    try {
      let clientId: string | null = null;
      let clientSecret: string | null = null;
      if (primed) {
        clientId = primed.clientId;
        clientSecret = primed.clientSecret;
      } else {
        const creds = await getCachedAnkorstoreCredentials();
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      }

      if (!clientId || !clientSecret) {
        throw new Error(
          "Identifiants Ankorstore manquants — configurer dans Paramètres > Marketplaces"
        );
      }

      return await authenticateAnkorstore(tid, clientId, clientSecret);
    } finally {
      pendingAuthByTenant.delete(tid);
    }
  })();

  pendingAuthByTenant.set(tid, authPromise);
  return authPromise;
}

/**
 * Authenticate with specific credentials (used internally and for testing).
 */
async function authenticateAnkorstore(
  tid: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "*",
  });

  const res = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("[Ankorstore] Auth failed", {
      status: res.status,
      body: text.slice(0, 300),
    });
    if (text.includes("Client authentication failed")) {
      throw new Error(
        "L'authentification Ankorstore a échoué. Veuillez vérifier vos identifiants dans Paramètres > Marketplaces."
      );
    }
    throw new Error(`Ankorstore auth failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const accessToken = data.access_token;
  if (!accessToken) {
    throw new Error("Ankorstore auth response missing access_token");
  }

  const expiresIn = data.expires_in ?? 3600; // seconds, default 1h
  tokenCacheByTenant.set(tid, {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  logger.info("[Ankorstore] Token acquired", { expiresIn, tid });
  return accessToken;
}

/**
 * Invalidate the cached token (e.g., after a 401 response) pour le tenant courant.
 */
export async function invalidateAnkorstoreToken(): Promise<void> {
  const tid = await resolveCurrentTenantId();
  tokenCacheByTenant.delete(tid);
}

/**
 * Amorce le cache de token (usage CLI uniquement) POUR UN TENANT DONNÉ.
 * Requiert de passer explicitement le tenantId.
 */
export function primeAnkorstoreToken(tenantId: string, accessToken: string, expiresInSec: number): void {
  tokenCacheByTenant.set(tenantId, {
    accessToken,
    expiresAt: Date.now() + expiresInSec * 1000,
  });
}

/**
 * Amorce les identifiants Ankorstore pour usage CLI (scripts longs) POUR UN
 * TENANT DONNÉ. Requiert de passer explicitement le tenantId.
 */
export function primeAnkorstoreCredentials(tenantId: string, clientId: string, clientSecret: string): void {
  primedCredentialsByTenant.set(tenantId, { clientId, clientSecret });
}

/**
 * Get standard headers for Ankorstore API requests.
 * Includes Bearer token and JSON:API Accept header.
 */
export async function getAnkorstoreHeaders(): Promise<Record<string, string>> {
  const token = await getAnkorstoreToken();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
    "User-Agent": "BeliJolie/1.0",
  };
}

/**
 * Test Ankorstore credentials without caching the token.
 * Returns true if authentication succeeds.
 */
export async function testAnkorstoreCredentials(
  clientId: string,
  clientSecret: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "*",
    });

    const res = await fetch(ANKORSTORE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    if (!res.ok) {
      return { valid: false, error: `Erreur d'authentification (${res.status})` };
    }

    const data = await res.json();
    if (!data.access_token) {
      return { valid: false, error: "Réponse invalide (pas de token)." };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Impossible de contacter Ankorstore." };
  }
}
