/**
 * eFashion Paris Authentication
 *
 * Cookie-based session with in-memory cache.
 * Credentials from SiteConfig (admin settings) with env var fallback.
 */

import { getCachedEfashionCredentials } from "@/lib/cached-data";
import {
  EFASHION_GRAPHQL_URL,
  setEfashionCookie,
  getEfashionCookie,
  invalidateEfashionCookie,
} from "@/lib/efashion-graphql";
import { logger } from "@/lib/logger";

let cachedVendorId: number | null = null;

export function getEfashionVendorId(): number | null {
  return cachedVendorId;
}

export async function efashionLogin(): Promise<number> {
  const creds = await getCachedEfashionCredentials();
  const email = creds.email || process.env.EFASHION_EMAIL;
  const password = creds.password || process.env.EFASHION_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Identifiants eFashion manquants — configurer dans Paramètres > Marketplaces"
    );
  }

  const res = await fetch(EFASHION_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      query: `mutation { login(email: "${email}", password: "${password}", rememberMe: true) { user { id_vendeur email nomBoutique } message } }`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion login failed (${res.status}): ${text}`);
  }

  const setCookie = res.headers.get("set-cookie");
  if (!setCookie || !setCookie.includes("auth-token=")) {
    throw new Error("eFashion login: no auth-token cookie in response");
  }

  const cookieValue = setCookie.split(";")[0];
  const maxAgeMatch = setCookie.match(/Max-Age=(\d+)/i);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 604800;
  setEfashionCookie(cookieValue, maxAge);

  const data = await res.json();
  const user = data?.data?.login?.user;
  if (!user?.id_vendeur) {
    throw new Error("eFashion login: invalid response — no id_vendeur");
  }

  cachedVendorId = user.id_vendeur;
  logger.info("[eFashion] Authenticated", {
    vendorId: user.id_vendeur,
    boutique: user.nomBoutique,
  });

  return user.id_vendeur;
}

export async function ensureEfashionAuth(): Promise<string> {
  const existing = getEfashionCookie();
  if (existing) return existing;

  await efashionLogin();
  const cookie = getEfashionCookie();
  if (!cookie) throw new Error("eFashion auth: cookie not set after login");
  return cookie;
}

export async function reauthenticateEfashion(): Promise<string> {
  invalidateEfashionCookie();
  return ensureEfashionAuth();
}
