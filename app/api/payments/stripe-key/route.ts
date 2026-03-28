import { NextResponse } from "next/server";
import { getStripePublishableKey, getConnectedAccountId } from "@/lib/stripe";

/**
 * GET /api/payments/stripe-key
 * Retourne la clé publique Stripe (DB ou env) + account ID Connect si applicable.
 */
export async function GET() {
  const key = await getStripePublishableKey();
  if (!key) {
    return NextResponse.json({ error: "Stripe non configuré." }, { status: 404 });
  }
  const connectAccountId = await getConnectedAccountId();
  return NextResponse.json({
    publishableKey: key,
    ...(connectAccountId ? { connectAccountId } : {}),
  });
}
