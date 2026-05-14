/**
 * Ankorstore OAuth2 Authentication
 *
 * Manages OAuth2 client_credentials flow with in-memory token cache.
 * Auto-refreshes 5 minutes before expiration.
 *
 * Credentials are read from admin settings (SiteConfig).
 */

import { getCachedAnkorstoreCredentials } from "@/lib/cached-data";
import { logger } from "@/lib/logger";

export const ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1";
const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";

interface TokenCache {
  accessToken: string;
  expiresAt: number; // timestamp ms
}

let cachedToken: TokenCache | null = null;

/**
 * Identifiants pré-amorcés pour usage CLI (scripts npx tsx). Quand renseignés,
 * `getAnkorstoreToken` les utilise directement au lieu d'appeler
 * `getCachedAnkorstoreCredentials` qui dépend de `unstable_cache` (lequel
 * plante hors contexte Next.js avec une erreur « incrementalCache missing »).
 *
 * À amorcer en début de script via `primeAnkorstoreCredentials(...)`.
 */
let primedCredentials: { clientId: string; clientSecret: string } | null = null;

/**
 * Get a valid Ankorstore OAuth2 access token.
 * Returns cached token if still valid (with 5-min buffer), otherwise re-authenticates.
 */
export async function getAnkorstoreToken(): Promise<string> {
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (cachedToken && cachedToken.expiresAt - bufferMs > Date.now()) {
    return cachedToken.accessToken;
  }

  let clientId: string | null = null;
  let clientSecret: string | null = null;
  if (primedCredentials) {
    clientId = primedCredentials.clientId;
    clientSecret = primedCredentials.clientSecret;
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

  return authenticateAnkorstore(clientId, clientSecret);
}

/**
 * Authenticate with specific credentials (used internally and for testing).
 */
async function authenticateAnkorstore(
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
  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  logger.info("[Ankorstore] Token acquired", { expiresIn });
  return accessToken;
}

/**
 * Invalidate the cached token (e.g., after a 401 response).
 */
export function invalidateAnkorstoreToken(): void {
  cachedToken = null;
}

/**
 * Amorce le cache de token (usage CLI uniquement).
 * Permet aux scripts qui ne tournent pas dans une requete Next.js de fournir
 * un token deja obtenu, afin que getAnkorstoreToken() court-circuite sans
 * passer par getCachedAnkorstoreCredentials (qui depend de unstable_cache).
 */
export function primeAnkorstoreToken(accessToken: string, expiresInSec: number): void {
  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresInSec * 1000,
  };
}

/**
 * Amorce les identifiants Ankorstore pour usage CLI (scripts longs où le
 * token va expirer en cours de route). Une fois amorcés, `getAnkorstoreToken`
 * peut se ré-authentifier seul sans passer par `unstable_cache`.
 *
 * À appeler une fois au démarrage du script, après avoir lu les credentials
 * en clair depuis SiteConfig (déchiffrés via `decryptIfSensitive`).
 */
export function primeAnkorstoreCredentials(clientId: string, clientSecret: string): void {
  primedCredentials = { clientId, clientSecret };
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
