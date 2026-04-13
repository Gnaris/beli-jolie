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
 * Get a valid Ankorstore OAuth2 access token.
 * Returns cached token if still valid (with 5-min buffer), otherwise re-authenticates.
 */
export async function getAnkorstoreToken(): Promise<string> {
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (cachedToken && cachedToken.expiresAt - bufferMs > Date.now()) {
    return cachedToken.accessToken;
  }

  const creds = await getCachedAnkorstoreCredentials();
  const clientId = creds.clientId;
  const clientSecret = creds.clientSecret;

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
 * Get standard headers for Ankorstore API requests.
 * Includes Bearer token and JSON:API Accept header.
 */
export async function getAnkorstoreHeaders(): Promise<Record<string, string>> {
  const token = await getAnkorstoreToken();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
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
