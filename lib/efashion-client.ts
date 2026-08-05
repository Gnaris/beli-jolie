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
import { getCurrentTenantIdSync } from "@/lib/tenant-als";

export const EFASHION_BASE_URL = "https://wapi.efashion-paris.com";
export const EFASHION_ORIGIN = "https://wholesaler.efashion-paris.com";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

interface CookieEntry {
  value: string;
  expiresAt?: number;
}

// CRITIQUE multi-tenant : cookie jar PAR tenant. Sans ça, la session eFashion
// du 1er tenant qui s'authentifie est réutilisée par TOUS les tenants suivants
// → un push BJ part sur le compte eFashion d'Issyma (et inversement).
const cookieJarByTenant = new Map<string, Map<string, CookieEntry>>();

async function resolveCurrentTenantId(): Promise<string> {
  let tid = getCurrentTenantIdSync();
  if (!tid) {
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      tid = h.get("x-tenant-id");
    } catch {
      // hors requête → clé fallback
    }
  }
  return tid ?? "global";
}

function getCookieJarForTenant(tid: string): Map<string, CookieEntry> {
  let jar = cookieJarByTenant.get(tid);
  if (!jar) {
    jar = new Map();
    cookieJarByTenant.set(tid, jar);
  }
  return jar;
}

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

function captureCookies(res: Response, jar: Map<string, CookieEntry>): void {
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
      jar.delete(parsed.name);
    } else {
      jar.set(parsed.name, { value: parsed.value, expiresAt: parsed.expiresAt });
    }
  }
}

function buildCookieHeaderFor(jar: Map<string, CookieEntry>): string {
  const now = Date.now();
  for (const [name, entry] of jar) {
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      jar.delete(name);
    }
  }
  return Array.from(jar.entries())
    .map(([name, entry]) => `${name}=${entry.value}`)
    .join("; ");
}

export async function clearEfashionSession(): Promise<void> {
  const tid = await resolveCurrentTenantId();
  cookieJarByTenant.delete(tid);
}

export async function hasEfashionCookies(): Promise<boolean> {
  const tid = await resolveCurrentTenantId();
  const jar = cookieJarByTenant.get(tid);
  if (!jar) return false;
  return buildCookieHeaderFor(jar).length > 0;
}

/**
 * Helpers exportés pour les tests unitaires uniquement.
 * @internal
 */
export const __testing__ = {
  parseSetCookie,
  cookieJarByTenant,
  buildCookieHeaderFor,
};

/**
 * Appel HTTP avec cookie jar partagé. Pose Origin + Referer + UA navigateur
 * pour passer la validation CORS du serveur eFashion.
 */
export async function efashionFetch(
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  const tid = await resolveCurrentTenantId();
  const jar = getCookieJarForTenant(tid);

  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${EFASHION_BASE_URL}${pathOrUrl}`;
  const headers = new Headers(init.headers);

  if (!headers.has("Origin")) headers.set("Origin", EFASHION_ORIGIN);
  if (!headers.has("Referer")) headers.set("Referer", `${EFASHION_ORIGIN}/`);
  if (!headers.has("User-Agent")) headers.set("User-Agent", DEFAULT_USER_AGENT);
  if (!headers.has("Accept")) headers.set("Accept", "*/*");

  const cookieHeader = buildCookieHeaderFor(jar);
  if (cookieHeader) headers.set("Cookie", cookieHeader);

  const res = await fetch(url, { ...init, headers });
  captureCookies(res, jar);
  return res;
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: unknown[] }>;
}

// Deadlocks côté MySQL eFashion (ER_LOCK_DEADLOCK) : le serveur a déjà
// rollback la transaction perdante, la doc MySQL dit littéralement « try
// restarting transaction ». Retry sûr et idempotent (la mutation n'a rien
// commité). Incident 2026-08-05 sur la bascule main de la boutique Issyma.
const DEADLOCK_MAX_ATTEMPTS = 3;
const DEADLOCK_BACKOFF_MS = [500, 1000, 2000] as const;

function isDeadlockMessage(msg: string): boolean {
  return msg.includes("ER_LOCK_DEADLOCK");
}

/**
 * Wrapper GraphQL : envoie une query/mutation et déballe le champ `data`.
 * Throw si `errors` est présent dans la réponse, même quand le HTTP est 200.
 *
 * Retry automatique sur `ER_LOCK_DEADLOCK` uniquement (jusqu'à 3 tentatives,
 * backoff 500ms → 1s → 2s). Toute autre erreur (auth, validation, HTTP) est
 * levée sans nouvelle tentative.
 */
export async function efashionGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= DEADLOCK_MAX_ATTEMPTS; attempt++) {
    try {
      return await efashionGraphqlOnce<T>(query, variables);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isDeadlockMessage(msg) || attempt === DEADLOCK_MAX_ATTEMPTS) {
        throw err;
      }
      lastError = err;
      const wait = DEADLOCK_BACKOFF_MS[attempt - 1] ?? 2000;
      logger.warn("[eFashion] GraphQL deadlock — retry", {
        attempt,
        maxAttempts: DEADLOCK_MAX_ATTEMPTS,
        waitMs: wait,
      });
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  // Sécurité — la boucle ci-dessus throw ou return, on ne sort jamais ici
  // sauf bug de logique. On relance le dernier throw plutôt que renvoyer T.
  throw lastError ?? new Error("eFashion GraphQL: échec inconnu après retry");
}

async function efashionGraphqlOnce<T>(
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
