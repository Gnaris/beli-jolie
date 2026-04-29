import { NextResponse } from "next/server";
import { getStripeInstance, getStripeWebhookSecret, getConnectedAccountId } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
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
    logger.error("[Stripe Webhook] Signature invalide", { detail: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Signature invalide." }, { status: 400 });
  }

  // En mode Connect, les events peuvent venir du compte connecté
  const connectAccountId = await getConnectedAccountId();
  if (connectAccountId && event.account) {
    // Event from connected account
  }

  // --- Deduplication: skip already-processed events ---
  const existingEvent = await prisma.stripeWebhookEvent.findUnique({
    where: { eventId: event.id },
  });
  if (existingEvent) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Record the event before processing
  await prisma.stripeWebhookEvent.create({
    data: {
      eventId: event.id,
      type: event.type,
    },
  });
  // TODO(2026-03): Set up a cron job (or Next.js API route triggered by external scheduler)
  // to periodically delete StripeWebhookEvent records older than 30 days.
  // Without cleanup, this table grows unboundedly (~1 row per webhook event).
  // SQL: DELETE FROM StripeWebhookEvent WHERE createdAt < NOW() - INTERVAL 30 DAY

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
      logger.warn("[Stripe Webhook] Paiement échoué", { paymentIntentId: pi.id });
      break;
    }

    // P2-04 — Paiement annulé (avant capture). Marque la commande comme
    // payment_failed. La logique métier d'annulation reste manuelle côté admin.
    case "payment_intent.canceled": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await prisma.order.updateMany({
        where: { stripePaymentIntentId: pi.id },
        data: { paymentStatus: "failed" },
      });
      logger.warn("[Stripe Webhook] Paiement annulé (canceled)", {
        paymentIntentId: pi.id,
      });
      break;
    }

    // P2-04 — Remboursement (partiel ou total). On marque la commande comme
    // remboursée et on log le montant. Cas total = annulation effective.
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
      if (!piId) {
        logger.warn("[Stripe Webhook] charge.refunded sans payment_intent", {
          chargeId: charge.id,
        });
        break;
      }
      const refunded = charge.amount_refunded; // en centimes
      const total = charge.amount;
      const isFullRefund = refunded >= total;
      await prisma.order.updateMany({
        where: { stripePaymentIntentId: piId },
        data: {
          paymentStatus: isFullRefund ? "refunded" : "partially_refunded",
        },
      });
      logger.info("[Stripe Webhook] Remboursement", {
        paymentIntentId: piId,
        refundedCents: refunded,
        totalCents: total,
        full: isFullRefund,
      });
      break;
    }

    // P2-04 — Litige client (chargeback). Notification admin + log critique.
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : null;
      logger.error("[Stripe Webhook] LITIGE CRÉÉ — action urgente", {
        disputeId: dispute.id,
        paymentIntentId: piId,
        amountCents: dispute.amount,
        reason: dispute.reason,
      });
      // Note : pour l'instant on log seulement. L'admin reçoit l'alerte
      // depuis le dashboard Stripe (notifications email natives Stripe).
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
