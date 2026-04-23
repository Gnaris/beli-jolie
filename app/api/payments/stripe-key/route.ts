import { NextResponse } from "next/server";
import { getStripePublishableKey, getConnectedAccountId, isStripeConnectReady } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";

/**
 * GET /api/payments/stripe-key
 * Retourne la clé publique Stripe + account ID Connect.
 * Bloque si le compte Stripe Connect n'est pas relié.
 */
export async function GET() {
  // Rate limit : 20 req/min par IP
  const hdrs = await headers();
  const rateLimited = checkRateLimit({ headers: hdrs }, "stripe-key", 20, 60_000);
  if (rateLimited) return rateLimited;

  const ready = await isStripeConnectReady();
  if (!ready) {
    return NextResponse.json({ error: "Stripe non configuré. Le commerçant doit relier son compte Stripe." }, { status: 503 });
  }

  const key = getStripePublishableKey();
  if (!key) {
    return NextResponse.json({ error: "Stripe non configuré." }, { status: 404 });
  }

  const connectAccountId = await getConnectedAccountId();
  return NextResponse.json({ publishableKey: key, connectAccountId });
}
