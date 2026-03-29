import { NextResponse } from "next/server";
import { getStripePublishableKey, getConnectedAccountId, isConnectEnabled } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";

/**
 * GET /api/payments/stripe-key
 * Retourne la clé publique Stripe + account ID Connect.
 * Bloque si Stripe Connect n'est pas relié.
 */
export async function GET() {
  // Rate limit : 20 req/min par IP
  const hdrs = await headers();
  const rateLimited = checkRateLimit({ headers: hdrs }, "stripe-key", 20, 60_000);
  if (rateLimited) return rateLimited;
  // En mode plateforme, le compte connecté doit être relié
  if (isConnectEnabled()) {
    const connectAccountId = await getConnectedAccountId();
    if (!connectAccountId) {
      return NextResponse.json({ error: "Stripe non configuré. Le commerçant doit relier son compte Stripe." }, { status: 503 });
    }
    const key = await getStripePublishableKey();
    if (!key) {
      return NextResponse.json({ error: "Stripe non configuré." }, { status: 404 });
    }
    return NextResponse.json({ publishableKey: key, connectAccountId });
  }

  // Mode manuel (pas de plateforme) — fallback existant
  const key = await getStripePublishableKey();
  if (!key) {
    return NextResponse.json({ error: "Stripe non configuré." }, { status: 404 });
  }
  return NextResponse.json({ publishableKey: key });
}
