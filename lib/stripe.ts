import Stripe from "stripe";

let _cachedStripe: Stripe | null = null;

export async function getStripeInstance(): Promise<Stripe> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Stripe non configuré. STRIPE_SECRET_KEY manquante dans .env.");
  }

  if (_cachedStripe) return _cachedStripe;

  _cachedStripe = new Stripe(secretKey);
  return _cachedStripe;
}

export async function getStripeWebhookSecret(): Promise<string> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Stripe webhook secret non configuré (STRIPE_WEBHOOK_SECRET).");
  }
  return secret;
}

export function getStripePublishableKey(): string | null {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
}

export function invalidateStripeCache() {
  _cachedStripe = null;
}
