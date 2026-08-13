/**
 * Authentification back-office Ankorstore.
 *
 * Flow reversé depuis les HARs :
 *   1. GET https://fr.ankorstore.com/ → pose cookies session anonymes
 *      (browser_id, ankorstore_session, aks-auth, aks_browser_id)
 *   2. GET /auth/csrf → renvoie {csrf: "…"}
 *   3. POST /auth/login {email, password} + headers X-Aks-Csrf/X-Csrf-Token
 *      → 200 avec body user+brand, et header x-aks-csrf rotaté
 *
 * Auth par cookie de session Laravel — aucun token Bearer, aucun JWT à stocker.
 *
 * Cache session par tenant (Map<tenantId, BoSession>) — sinon 2 tenants
 * partagent le même compte et polluent leurs push mutuellement.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";
import { setSiteConfig } from "@/lib/site-config-write";
import { logger } from "@/lib/logger";
import type { BoSession } from "./types";

export const ANKORSTORE_BO_BASE_URL = "https://fr.ankorstore.com";

/** Durée de session estimée. Laravel session dure ~2h par défaut ; on renouvelle à 25 min pour sécu. */
const SESSION_TTL_MS = 25 * 60 * 1000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Cache par tenant. Sans ça, tenant B réutilise la session de tenant A. */
const sessionCacheByTenant = new Map<string, BoSession>();
const pendingLoginByTenant = new Map<string, Promise<BoSession>>();
/** Credentials injectés en mémoire (scripts/tests hors contexte Next). Prioritaire sur BDD. */
const primedCredentialsByTenant = new Map<string, { email: string; password: string }>();
/** Device ID injecté en mémoire — pour scripts/tests, évite l'écriture SiteConfig. */
const primedDeviceIdByTenant = new Map<string, string>();

/**
 * Injecte des credentials en mémoire pour un tenant donné.
 * Prioritaire sur la lecture SiteConfig — utile pour les scripts CLI et les tests
 * qui n'ont pas de contexte Next ni de row SiteConfig.
 */
export function primeBoCredentials(tenantId: string, email: string, password: string): void {
  primedCredentialsByTenant.set(tenantId, { email, password });
}

/** Injecte un Device ID en mémoire (bypass la lecture/écriture SiteConfig). */
export function primeBoDeviceId(tenantId: string, deviceId: string): void {
  primedDeviceIdByTenant.set(tenantId, deviceId);
}

/**
 * Résout le tenant courant en essayant plusieurs sources :
 *   1. ALS (bindTenantId posé par un helper `getCurrentTenant*`)
 *   2. headers `x-tenant-id` posé par le middleware (fallback si ALS pas encore populée)
 *   3. "global" (scripts CLI / jobs hors requête)
 */
async function resolveTenantIdForBo(): Promise<string> {
  const fromAls = getCurrentTenantIdSync();
  if (fromAls) return fromAls;
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const fromHeader = h.get("x-tenant-id");
    if (fromHeader) return fromHeader;
  } catch {
    /* hors requête */
  }
  return "global";
}

/**
 * Récupère (ou crée) une session valide pour le tenant courant.
 * Concurrent callers partagent la même promise de login (dédup).
 */
export async function getBoSession(): Promise<BoSession> {
  const tenantId = await resolveTenantIdForBo();

  const cached = sessionCacheByTenant.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const pending = pendingLoginByTenant.get(tenantId);
  if (pending) return pending;

  const p = doLogin(tenantId).finally(() => {
    pendingLoginByTenant.delete(tenantId);
  });
  pendingLoginByTenant.set(tenantId, p);
  return p;
}

/** Force un re-login (utilisé quand un 401/419 est détecté ailleurs). */
export function invalidateBoSession(tenantId?: string): void {
  if (tenantId) {
    sessionCacheByTenant.delete(tenantId);
    return;
  }
  const tid = getCurrentTenantIdSync() ?? "global";
  sessionCacheByTenant.delete(tid);
}

async function doLogin(tenantId: string): Promise<BoSession> {
  const { email, password } = await readCredentials(tenantId);
  if (!email || !password) {
    throw new Error(
      "Identifiants Ankorstore back-office manquants — configurer email/mot de passe dans Paramètres > Marketplaces > Ankorstore"
    );
  }

  const deviceId = await getOrCreateDeviceId(tenantId);
  const cookies = new Map<string, string>();

  // Étape 0 — poser cookies anonymes
  const rootRes = await fetch(ANKORSTORE_BO_BASE_URL + "/", {
    method: "GET",
    headers: baseHeaders(deviceId),
    redirect: "manual",
  });
  absorbCookies(cookies, rootRes);

  // Étape 1 — récupérer csrf initial
  const csrfRes = await fetch(ANKORSTORE_BO_BASE_URL + "/auth/csrf", {
    method: "GET",
    headers: {
      ...baseHeaders(deviceId),
      Cookie: serializeCookies(cookies),
    },
    redirect: "manual",
  });
  absorbCookies(cookies, csrfRes);
  const csrfBody = (await csrfRes.json()) as { csrf?: string };
  const initialCsrf = csrfBody.csrf;
  if (!initialCsrf) {
    throw new Error("Ankorstore back-office : token CSRF initial vide (endpoint /auth/csrf a changé ?)");
  }

  // Étape 2 — login
  const loginRes = await fetch(ANKORSTORE_BO_BASE_URL + "/auth/login", {
    method: "POST",
    headers: {
      ...baseHeaders(deviceId),
      Cookie: serializeCookies(cookies),
      "Content-Type": "application/json",
      "X-Aks-Csrf": initialCsrf,
      "X-Csrf-Token": initialCsrf,
    },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  absorbCookies(cookies, loginRes);

  if (loginRes.status !== 200) {
    const errText = await loginRes.text().catch(() => "");
    throw new Error(
      `Ankorstore back-office : login échoué (status ${loginRes.status}) — vérifier email/mot de passe. ${errText.slice(0, 200)}`
    );
  }

  const loginBody = (await loginRes.json()) as {
    success?: boolean;
    brand?: { id?: number; uuid?: string; name?: string };
  };
  if (!loginBody.success || !loginBody.brand?.id || !loginBody.brand?.uuid) {
    throw new Error("Ankorstore back-office : réponse login invalide (brand.id ou brand.uuid manquants)");
  }

  const rotatedCsrf = loginRes.headers.get("x-aks-csrf") ?? initialCsrf;

  const session: BoSession = {
    cookieHeader: serializeCookies(cookies),
    csrfToken: rotatedCsrf,
    deviceId,
    brandId: loginBody.brand.id,
    brandUuid: loginBody.brand.uuid,
    expiresAt: Date.now() + SESSION_TTL_MS,
    tenantId,
  };

  sessionCacheByTenant.set(tenantId, session);
  logger.info("[ankorstore-bo] login OK", {
    tenantId,
    brand: loginBody.brand.name,
    brandId: session.brandId,
  });
  return session;
}

async function readCredentials(
  tenantId: string
): Promise<{ email: string | null; password: string | null }> {
  const primed = primedCredentialsByTenant.get(tenantId);
  if (primed) return primed;

  const rows = await prisma.siteConfig.findMany({
    where:
      tenantId === "global"
        ? { key: { in: ["ankorstore_bo_email", "ankorstore_bo_password"] } }
        : { tenantId, key: { in: ["ankorstore_bo_email", "ankorstore_bo_password"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  return {
    email: map.get("ankorstore_bo_email") ?? null,
    password: map.get("ankorstore_bo_password") ?? null,
  };
}

async function getOrCreateDeviceId(tenantId: string): Promise<string> {
  const primed = primedDeviceIdByTenant.get(tenantId);
  if (primed) return primed;

  const row = await prisma.siteConfig.findFirst({
    where:
      tenantId === "global"
        ? { key: "ankorstore_bo_device_id" }
        : { tenantId, key: "ankorstore_bo_device_id" },
    select: { value: true },
  });
  if (row?.value) return row.value;

  const newId = `rjs-${randomUUID()}`;
  try {
    await setSiteConfig("ankorstore_bo_device_id", newId, {
      tenantId: tenantId === "global" ? undefined : tenantId,
    });
  } catch (err) {
    // Hors contexte requête (script CLI), l'extension tenantScope est passthrough
    // et le create échoue faute de tenantId. On garde le device en mémoire pour la session.
    primedDeviceIdByTenant.set(tenantId, newId);
    logger.warn("[ankorstore-bo] deviceId non-persisté (script CLI ?)", { tenantId, err });
  }
  return newId;
}

function baseHeaders(deviceId: string): Record<string, string> {
  return {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    Origin: ANKORSTORE_BO_BASE_URL,
    Referer: `${ANKORSTORE_BO_BASE_URL}/`,
    "X-Requested-With": "XMLHttpRequest",
    "X-Device-Id": deviceId,
  };
}

function absorbCookies(jar: Map<string, string>, res: Response): void {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const first = line.split(";")[0];
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    if (value === "" || value === "deleted") jar.delete(name);
    else jar.set(name, value);
  }
}

function serializeCookies(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** Export interne pour client.ts (mêmes helpers, pas dupliqués). */
export { baseHeaders as _boBaseHeaders };
