import { NextResponse } from "next/server";
import { getStripePublishableKey } from "@/lib/stripe";

/**
 * GET /api/payments/stripe-key
 * Retourne la clé publique Stripe (DB ou env).
 */
export async function GET() {
  const key = await getStripePublishableKey();
  if (!key) {
    return NextResponse.json({ error: "Stripe non configuré." }, { status: 404 });
  }
  return NextResponse.json({ publishableKey: key });
}
