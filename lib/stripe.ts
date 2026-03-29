import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

// ─── Cache pour éviter de lire la DB à chaque appel ───────────────────────────
let _cachedStripe: Stripe | null = null;
let _cachedSecretKey: string | null = null;
let _cachedConnectAccountId: string | null | undefined = undefined; // undefined = not loaded

// ─── Stripe Connect helpers ──────────────────────────────────────────────────

/**
 * Vérifie si Stripe Connect est activé (env var plateforme configurée).
 */
export function isConnectEnabled(): boolean {
  return !!process.env.STRIPE_PLATFORM_SECRET_KEY;
}

/**
 * Retourne le stripe_connect_account_id si configuré (mode Connect), sinon null.
 */
export async function getConnectedAccountId(): Promise<string | null> {
  if (_cachedConnectAccountId !== undefined) return _cachedConnectAccountId;

  const row = await prisma.siteConfig.findUnique({
    where: { key: "stripe_connect_account_id" },
  });
  const val = row?.value ? decryptIfSensitive("stripe_connect_account_id", row.value) : null;
  _cachedConnectAccountId = val || null;
  return _cachedConnectAccountId;
}

/**
 * Vérifie si on est en mode Stripe Connect (compte connecté via OAuth).
 */
export async function isStripeConnectMode(): Promise<boolean> {
  const accountId = await getConnectedAccountId();
  return !!accountId && isConnectEnabled();
}

// ─── Instance Stripe ─────────────────────────────────────────────────────────

/**
 * Retourne une instance Stripe configurée.
 * - Mode Connect : utilise STRIPE_PLATFORM_SECRET_KEY (env var hébergeur)
 * - Mode manuel : clé en DB (SiteConfig) > variable d'environnement
 */
export async function getStripeInstance(): Promise<Stripe> {
  // Mode Connect : utiliser la clé plateforme
  const connectMode = await isStripeConnectMode();

  if (connectMode) {
    const platformKey = process.env.STRIPE_PLATFORM_SECRET_KEY!;
    if (_cachedStripe && _cachedSecretKey === platformKey) {
      return _cachedStripe;
    }
    _cachedStripe = new Stripe(platformKey);
    _cachedSecretKey = platformKey;
    return _cachedStripe;
  }

  // Mode manuel : clé en DB ou env
  const dbConfig = await prisma.siteConfig.findUnique({
    where: { key: "stripe_secret_key" },
  });
  const secretKey = (dbConfig?.value ? decryptIfSensitive("stripe_secret_key", dbConfig.value) : null) || process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Stripe non configuré. Ajoutez vos clés Stripe dans Paramètres > Paiement Stripe.");
  }

  // Réutiliser l'instance si la clé n'a pas changé
  if (_cachedStripe && _cachedSecretKey === secretKey) {
    return _cachedStripe;
  }

  _cachedStripe = new Stripe(secretKey);
  _cachedSecretKey = secretKey;
  return _cachedStripe;
}

/**
 * Retourne le webhook secret depuis la DB ou l'env.
 */
export async function getStripeWebhookSecret(): Promise<string> {
  const dbConfig = await prisma.siteConfig.findUnique({
    where: { key: "stripe_webhook_secret" },
  });
  const secret = (dbConfig?.value ? decryptIfSensitive("stripe_webhook_secret", dbConfig.value) : null) || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Stripe webhook secret non configuré.");
  }
  return secret;
}

/**
 * Retourne la clé publique Stripe.
 * - Mode Connect : clé publique plateforme (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
 * - Mode manuel : clé en DB ou env
 */
export async function getStripePublishableKey(): Promise<string | null> {
  // Mode Connect : utiliser la clé publique de la plateforme
  const connectMode = await isStripeConnectMode();
  if (connectMode) {
    return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null;
  }

  // Mode manuel
  const dbConfig = await prisma.siteConfig.findUnique({
    where: { key: "stripe_publishable_key" },
  });
  return (dbConfig?.value ? decryptIfSensitive("stripe_publishable_key", dbConfig.value) : null) || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null;
}

/**
 * Récupère le taux de commission plateforme depuis les metadata du compte connecté.
 * Retourne le taux en décimal (ex: 0.0025 pour 0.25%). Défaut: 0.25%.
 */
export async function getCommissionRate(): Promise<number> {
  const accountId = await getConnectedAccountId();
  if (!accountId) return 0;

  const stripe = await getStripeInstance();
  const account = await stripe.accounts.retrieve(accountId);
  const rate = parseFloat(account.metadata?.commission_rate || "0.25");
  return rate / 100;
}

/**
 * Invalide le cache en mémoire (après mise à jour des clés).
 */
export function invalidateStripeCache() {
  _cachedStripe = null;
  _cachedSecretKey = null;
  _cachedConnectAccountId = undefined;
}
