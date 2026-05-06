import { NextResponse } from "next/server";
import { getStripePublishableKey } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";

export async function GET() {
  const hdrs = await headers();
  const rateLimited = checkRateLimit({ headers: hdrs }, "stripe-key", 20, 60_000);
  if (rateLimited) return rateLimited;

  const key = getStripePublishableKey();
  if (!key) {
    return NextResponse.json({ error: "Stripe non configuré." }, { status: 503 });
  }

  return NextResponse.json({ publishableKey: key });
}
