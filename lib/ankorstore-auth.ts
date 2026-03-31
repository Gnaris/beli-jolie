import { getCachedAnkorstoreCredentials } from "@/lib/cached-data";
import { logger } from "@/lib/logger";

export const AK_BASE_URL = "https://www.ankorstore.com/api/v1";
const TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const REFRESH_BUFFER_MS = 10 * 60 * 1000; // 10 min before expiry

interface TokenCache {
  accessToken: string;
  expiresAt: Date;
}

let cachedToken: TokenCache | null = null;

export async function getAnkorstoreToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return cachedToken.accessToken;
  }

  const creds = await getCachedAnkorstoreCredentials();
  const clientId = creds.clientId || process.env.ANKORSTORE_CLIENT_ID;
  const clientSecret = creds.clientSecret || process.env.ANKORSTORE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Identifiants Ankorstore manquants — configurer dans Paramètres > Marketplaces");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "*",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ankorstore OAuth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };

  logger.info("[Ankorstore] Token acquired", {
    expiresIn: data.expires_in,
    expiresAt: cachedToken.expiresAt.toISOString(),
  });

  return cachedToken.accessToken;
}

export function invalidateAnkorstoreToken(): void {
  cachedToken = null;
}

/**
 * Base fetch helper with auth, retry on 401, and rate limit handling.
 */
export async function akFetch(
  path: string,
  options: RequestInit = {},
  retries = 3,
): Promise<Response> {
  const token = await getAnkorstoreToken();
  const url = path.startsWith("http") ? path : `${AK_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
    ...(options.headers as Record<string, string> || {}),
  };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/vnd.api+json";
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers });

      // 401 — token expired, retry with fresh token
      if (res.status === 401 && attempt === 0) {
        invalidateAnkorstoreToken();
        const newToken = await getAnkorstoreToken();
        headers.Authorization = `Bearer ${newToken}`;
        continue;
      }

      // 429 — rate limited
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
        logger.warn("[Ankorstore] Rate limited", { retryAfter, attempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      // 5xx — server error, retry with backoff
      if (res.status >= 500 && attempt < retries) {
        const backoff = Math.min(2000 * Math.pow(2, attempt), 30000);
        logger.warn("[Ankorstore] Server error, retrying", { status: res.status, backoff, attempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        const backoff = Math.min(2000 * Math.pow(2, attempt), 30000);
        logger.warn("[Ankorstore] Network error, retrying", { error: lastError.message, backoff });
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  throw lastError || new Error("Ankorstore fetch failed after retries");
}
