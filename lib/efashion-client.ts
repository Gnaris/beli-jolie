/**
 * eFashion Paris — HTTP client avec gestion de cookies de session.
 *
 * API mixte GraphQL + REST sous https://wapi.efashion-paris.com.
 * Origin attendu : https://wholesaler.efashion-paris.com (CORS).
 *
 * Cookie jar in-memory partagé entre toutes les requêtes (1 process = 1 session).
 * Pas de dépendance externe — parsing Set-Cookie minimaliste.
 */

import { logger } from "@/lib/logger";

export const EFASHION_BASE_URL = "https://wapi.efashion-paris.com";
export const EFASHION_ORIGIN = "https://wholesaler.efashion-paris.com";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

interface CookieEntry {
  value: string;
  expiresAt?: number;
}

const cookieJar = new Map<string, CookieEntry>();

function parseSetCookie(header: string): { name: string; value: string; expiresAt?: number } | null {
  const semi = header.indexOf(";");
  const nv = semi >= 0 ? header.slice(0, semi) : header;
  const eq = nv.indexOf("=");
  if (eq <= 0) return null;
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  if (!name) return null;

  let expiresAt: number | undefined;
  if (semi >= 0) {
    const attrs = header.slice(semi + 1).split(";");
    for (const raw of attrs) {
      const attr = raw.trim();
      const idx = attr.indexOf("=");
      const key = (idx >= 0 ? attr.slice(0, idx) : attr).toLowerCase();
      const val = idx >= 0 ? attr.slice(idx + 1).trim() : "";
      if (key === "max-age") {
        const sec = parseInt(val, 10);
        if (!Number.isNaN(sec)) expiresAt = Date.now() + sec * 1000;
      } else if (key === "expires" && expiresAt === undefined) {
        const ts = Date.parse(val);
        if (!Number.isNaN(ts)) expiresAt = ts;
      }
    }
  }
  return { name, value, expiresAt };
}

function captureCookies(res: Response): void {
  const headersWithCookies = res.headers as Headers & { getSetCookie?: () => string[] };
  const raw =
    typeof headersWithCookies.getSetCookie === "function"
      ? headersWithCookies.getSetCookie()
      : null;

  const list: string[] = raw && raw.length > 0
    ? raw
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);

  for (const header of list) {
    const parsed = parseSetCookie(header);
    if (!parsed) continue;
    if (parsed.expiresAt !== undefined && parsed.expiresAt <= Date.now()) {
      cookieJar.delete(parsed.name);
    } else {
      cookieJar.set(parsed.name, { value: parsed.value, expiresAt: parsed.expiresAt });
    }
  }
}

function buildCookieHeader(): string {
  const now = Date.now();
  for (const [name, entry] of cookieJar) {
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      cookieJar.delete(name);
    }
  }
  return Array.from(cookieJar.entries())
    .map(([name, entry]) => `${name}=${entry.value}`)
    .join("; ");
}

export function clearEfashionSession(): void {
  cookieJar.clear();
}

export function hasEfashionCookies(): boolean {
  return buildCookieHeader().length > 0;
}

/**
 * Helpers exportés pour les tests unitaires uniquement.
 * @internal
 */
export const __testing__ = {
  parseSetCookie,
  cookieJar,
  buildCookieHeader,
};

/**
 * Appel HTTP avec cookie jar partagé. Pose Origin + Referer + UA navigateur
 * pour passer la validation CORS du serveur eFashion.
 */
export async function efashionFetch(
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${EFASHION_BASE_URL}${pathOrUrl}`;
  const headers = new Headers(init.headers);

  if (!headers.has("Origin")) headers.set("Origin", EFASHION_ORIGIN);
  if (!headers.has("Referer")) headers.set("Referer", `${EFASHION_ORIGIN}/`);
  if (!headers.has("User-Agent")) headers.set("User-Agent", DEFAULT_USER_AGENT);
  if (!headers.has("Accept")) headers.set("Accept", "*/*");

  const cookieHeader = buildCookieHeader();
  if (cookieHeader) headers.set("Cookie", cookieHeader);

  const res = await fetch(url, { ...init, headers });
  captureCookies(res);
  return res;
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: unknown[] }>;
}

/**
 * Wrapper GraphQL : envoie une query/mutation et déballe le champ `data`.
 * Throw si `errors` est présent dans la réponse, même quand le HTTP est 200.
 */
export async function efashionGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await efashionFetch("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`eFashion GraphQL HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as GraphqlResponse<T>;
  if (json.errors && json.errors.length > 0) {
    const msg = json.errors.map((e) => e.message).join("; ");
    logger.warn("[eFashion] GraphQL errors", { errors: json.errors });
    throw new Error(`eFashion GraphQL: ${msg}`);
  }
  if (json.data === undefined || json.data === null) {
    throw new Error("eFashion GraphQL: réponse sans data");
  }
  return json.data;
}
