import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

// ─── Cache pour éviter de lire la DB à chaque appel ───────────────────────────
let _cachedStripe: Stripe | null = null;
let _cachedConnectAccountId: string | null | undefined = undefined; // undefined = not loaded

// ─── Stripe Connect ─────────────────────────────────────────────────────────

/**
 * Retourne le stripe_connect_account_id si configuré, sinon null.
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
 * Vérifie si Stripe Connect est prêt (clé plateforme + compte connecté).
 */
export async function isStripeConnectReady(): Promise<boolean> {
  const platformKey = process.env.STRIPE_PLATFORM_SECRET_KEY;
  if (!platformKey) return false;
  const accountId = await getConnectedAccountId();
  return !!accountId;
}

// ─── Instance Stripe ─────────────────────────────────────────────────────────

/**
 * Retourne une instance Stripe configurée avec la clé plateforme.
 */
export async function getStripeInstance(): Promise<Stripe> {
  const platformKey = process.env.STRIPE_PLATFORM_SECRET_KEY;
  if (!platformKey) {
    throw new Error("Stripe non configuré. La clé plateforme (STRIPE_PLATFORM_SECRET_KEY) est manquante.");
  }

  if (_cachedStripe) return _cachedStripe;

  _cachedStripe = new Stripe(platformKey);
  return _cachedStripe;
}

/**
 * Retourne le webhook secret depuis l'env.
 */
export async function getStripeWebhookSecret(): Promise<string> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Stripe webhook secret non configuré (STRIPE_WEBHOOK_SECRET).");
  }
  return secret;
}

/**
 * Retourne la clé publique Stripe (plateforme).
 */
export function getStripePublishableKey(): string | null {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null;
}

/**
 * Récupère le taux de commission plateforme depuis les metadata du compte connecté.
 * Retourne le taux en décimal (ex: 0.0025 pour 0.25%). Défaut: 0 (pas de commission).
 */
export async function getCommissionRate(): Promise<number> {
  const accountId = await getConnectedAccountId();
  if (!accountId) return 0;

  const stripe = await getStripeInstance();
  const account = await stripe.accounts.retrieve(accountId);
  const rate = parseFloat(account.metadata?.commission_rate || "0");
  return rate / 100;
}

/**
 * Invalide le cache en mémoire (après mise à jour de la config).
 */
export function invalidateStripeCache() {
  _cachedStripe = null;
  _cachedConnectAccountId = undefined;
}
