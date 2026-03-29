import { NextResponse } from "next/server";
import { getStripeInstance, getStripeWebhookSecret, getConnectedAccountId } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import type Stripe from "stripe";

/**
 * POST /api/payments/webhook
 * Webhook Stripe — confirme le paiement et met à jour la commande (carte uniquement).
 */
export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Signature manquante." }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const stripe = await getStripeInstance();
    const webhookSecret = await getStripeWebhookSecret();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("[Stripe Webhook] Signature invalide:", err);
    return NextResponse.json({ error: "Signature invalide." }, { status: 400 });
  }

  // En mode Connect, les events peuvent venir du compte connecté
  const connectAccountId = await getConnectedAccountId();
  if (connectAccountId && event.account) {
    // Event from connected account
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;

      await prisma.order.updateMany({
        where: { stripePaymentIntentId: pi.id },
        data: { paymentStatus: "paid" },
      });

      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await prisma.order.updateMany({
        where: { stripePaymentIntentId: pi.id },
        data: { paymentStatus: "failed" },
      });
      console.warn(`[Stripe Webhook] Paiement échoué: ${pi.id}`);
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
