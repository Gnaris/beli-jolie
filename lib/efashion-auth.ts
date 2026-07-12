/**
 * eFashion Paris — Authentification (mutation GraphQL `Login`).
 *
 * Pas de Bearer token : le serveur pose un cookie httpOnly de session,
 * géré par le cookie jar de lib/efashion-client.ts.
 *
 * Crédentials lus depuis SiteConfig (chiffrés via `SENSITIVE_KEYS`).
 */

import { getCachedEfashionCredentials } from "@/lib/cached-data";
import {
  clearEfashionSession,
  efashionGraphql,
  hasEfashionCookies,
} from "@/lib/efashion-client";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";
import { logger } from "@/lib/logger";

export interface EfashionVendorUser {
  id_vendeur: number;
  email: string;
  nomContact: string;
  nomBoutique: string;
  siret: string;
  tva: string;
}

interface LoginResult {
  login: {
    user: EfashionVendorUser;
    message: string;
  };
}

const LOGIN_MUTATION = `
  mutation Login($email: String!, $password: String!, $rememberMe: Boolean!) {
    login(email: $email, password: $password, rememberMe: $rememberMe) {
      user { id_vendeur email nomContact nomBoutique siret tva }
      message
    }
  }
`;

const SESSION_TTL_MS = 30 * 60 * 1000;
// CRITIQUE multi-tenant : timestamp par tenant. Sinon le login BJ marque
// "encore frais" pour Issyma qui réutilise la session BJ.
const lastLoginAtByTenant = new Map<string, number>();

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
 * Authentifie avec un couple email/mot de passe spécifique sans cacher la session.
 * Utilisé par le bouton « Tester la connexion » dans Paramètres > Marketplaces.
 */
async function performLogin(email: string, password: string): Promise<EfashionVendorUser> {
  await clearEfashionSession();
  const data = await efashionGraphql<LoginResult>(LOGIN_MUTATION, {
    email,
    password,
    rememberMe: true,
  });
  if (!data.login?.user) {
    throw new Error("eFashion: réponse de connexion invalide");
  }
  return data.login.user;
}

/**
 * Garantit qu'une session eFashion est active. Re-login si le cookie a expiré
 * (heuristique : TTL local de 30 min OU jar vide).
 */
export async function ensureEfashionSession(): Promise<EfashionVendorUser> {
  const tid = await resolveCurrentTenantId();
  const lastLoginAt = lastLoginAtByTenant.get(tid) ?? null;
  const stillFresh =
    lastLoginAt !== null &&
    Date.now() - lastLoginAt < SESSION_TTL_MS &&
    (await hasEfashionCookies());

  if (!stillFresh) {
    const creds = await getCachedEfashionCredentials();
    if (!creds.email || !creds.password) {
      throw new Error(
        "Identifiants eFashion manquants — configurer dans Paramètres > Marketplaces",
      );
    }
    const user = await performLogin(creds.email, creds.password);
    lastLoginAtByTenant.set(tid, Date.now());
    logger.info("[eFashion] Login OK", { idVendeur: user.id_vendeur, boutique: user.nomBoutique, tid });
    return user;
  }

  return {} as EfashionVendorUser;
}

/**
 * Force une réauthentification au prochain appel (pour le tenant courant).
 */
export async function invalidateEfashionSession(): Promise<void> {
  const tid = await resolveCurrentTenantId();
  await clearEfashionSession();
  lastLoginAtByTenant.delete(tid);
}

/**
 * Test sans persistance — utilisé par le bouton « Tester la connexion ».
 * Ne touche pas au cache de session normal (force un re-login après).
 */
export async function testEfashionCredentials(
  email: string,
  password: string,
): Promise<{ valid: boolean; error?: string; vendor?: { id: number; name: string } }> {
  try {
    const user = await performLogin(email, password);
    await invalidateEfashionSession();
    return {
      valid: true,
      vendor: { id: user.id_vendeur, name: user.nomBoutique },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return { valid: false, error: msg };
  }
}
