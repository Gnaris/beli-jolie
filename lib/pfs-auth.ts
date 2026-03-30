/**
 * PFS (Paris Fashion Shop) Authentication
 *
 * Manages Bearer token with in-memory cache.
 * Auto-refreshes 10 minutes before expiration.
 *
 * Credentials are read from admin settings (SiteConfig),
 * with fallback on PFS_EMAIL / PFS_PASSWORD env vars.
 */

import { getCachedPfsCredentials } from "@/lib/cached-data";

// TODO(2026-03): Consider moving to env var PFS_BASE_URL for multi-environment support
const PFS_BASE_URL = "https://wholesaler-api.parisfashionshops.com/api/v1";

interface TokenCache {
  accessToken: string;
  expiresAt: Date;
}

let cachedToken: TokenCache | null = null;

/**
 * Get a valid PFS Bearer token.
 * Returns cached token if still valid (with 10-min buffer), otherwise re-authenticates.
 */
export async function getPfsToken(): Promise<string> {
  // Check if cached token is still valid (10 min buffer)
  if (cachedToken) {
    const bufferMs = 10 * 60 * 1000; // 10 minutes
    if (cachedToken.expiresAt.getTime() - bufferMs > Date.now()) {
      return cachedToken.accessToken;
    }
  }

  const pfsCreds = await getCachedPfsCredentials();
  const email = pfsCreds.email || process.env.PFS_EMAIL;
  const password = pfsCreds.password || process.env.PFS_PASSWORD;
  if (!email || !password) {
    throw new Error("Identifiants PFS manquants — configurer dans Paramètres > Marketplaces");
  }

  const res = await fetch(`${PFS_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PFS auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const accessToken = data.access_token;
  if (!accessToken) {
    throw new Error("PFS auth response missing access_token");
  }

  // Parse expires_at (format: "2026-03-21 03:23:25")
  let expiresAt: Date;
  if (data.expires_at) {
    expiresAt = new Date(data.expires_at.replace(" ", "T") + "Z");
  } else {
    // Fallback: assume 1 year (PFS tokens are long-lived)
    expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  }

  cachedToken = { accessToken, expiresAt };
  return accessToken;
}

/**
 * Invalidate the cached token (e.g., after a 401 response).
 */
export function invalidatePfsToken(): void {
  cachedToken = null;
}

/**
 * Get standard headers for PFS API requests.
 */
export async function getPfsHeaders(): Promise<Record<string, string>> {
  const token = await getPfsToken();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
}

export { PFS_BASE_URL };
