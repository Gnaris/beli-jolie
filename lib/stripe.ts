import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

// ─── Cache pour éviter de lire la DB à chaque appel ───────────────────────────
let _cachedStripe: Stripe | null = null;
let _cachedSecretKey: string | null = null;

/**
 * Retourne une instance Stripe configurée.
 * Priorité : clé en DB (SiteConfig) > variable d'environnement.
 */
export async function getStripeInstance(): Promise<Stripe> {
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
 * Retourne la clé publique Stripe depuis la DB ou l'env.
 */
export async function getStripePublishableKey(): Promise<string | null> {
  const dbConfig = await prisma.siteConfig.findUnique({
    where: { key: "stripe_publishable_key" },
  });
  return (dbConfig?.value ? decryptIfSensitive("stripe_publishable_key", dbConfig.value) : null) || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null;
}

/**
 * Invalide le cache en mémoire (après mise à jour des clés).
 */
export function invalidateStripeCache() {
  _cachedStripe = null;
  _cachedSecretKey = null;
}
