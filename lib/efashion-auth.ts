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
let lastLoginAt: number | null = null;

/**
 * Authentifie avec un couple email/mot de passe spécifique sans cacher la session.
 * Utilisé par le bouton « Tester la connexion » dans Paramètres > Marketplaces.
 */
async function performLogin(email: string, password: string): Promise<EfashionVendorUser> {
  clearEfashionSession();
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
  const stillFresh =
    lastLoginAt !== null &&
    Date.now() - lastLoginAt < SESSION_TTL_MS &&
    hasEfashionCookies();

  if (!stillFresh) {
    const creds = await getCachedEfashionCredentials();
    if (!creds.email || !creds.password) {
      throw new Error(
        "Identifiants eFashion manquants — configurer dans Paramètres > Marketplaces",
      );
    }
    const user = await performLogin(creds.email, creds.password);
    lastLoginAt = Date.now();
    logger.info("[eFashion] Login OK", { idVendeur: user.id_vendeur, boutique: user.nomBoutique });
    return user;
  }

  // Session encore valide — on n'a pas l'objet user en cache, on retourne
  // un placeholder minimal. Si l'appelant a besoin de l'info vendeur, qu'il
  // utilise efashionGetMe() qui fait l'appel `query me`.
  return {} as EfashionVendorUser;
}

/**
 * Force une réauthentification au prochain appel.
 */
export function invalidateEfashionSession(): void {
  clearEfashionSession();
  lastLoginAt = null;
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
    // On vide la session — la vraie session sera re-créée au prochain
    // appel via ensureEfashionSession avec les credentials sauvegardés.
    invalidateEfashionSession();
    return {
      valid: true,
      vendor: { id: user.id_vendeur, name: user.nomBoutique },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return { valid: false, error: msg };
  }
}
