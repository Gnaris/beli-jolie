import { NextResponse } from "next/server";
import { getStripeInstance, getStripeWebhookSecret } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { markOrderPaymentPaid } from "@/lib/order-payments";
import type Stripe from "stripe";

/**
 * Marque un `OrderPayment` PAID à partir du payment_intent ou du checkout
 * session renvoyé par Stripe. Essaie dans l'ordre : (1) PI id, (2) session id,
 * (3) metadata `orderPaymentId`. Retourne true si un paiement a été mis à jour.
 */
async function markOrderPaymentFromStripe(args: {
  paymentIntentId?: string | null;
  checkoutSessionId?: string | null;
  metadataPaymentId?: string | null;
}): Promise<boolean> {
  const { paymentIntentId, checkoutSessionId, metadataPaymentId } = args;
  const where: Array<{ id?: string; stripePaymentIntentId?: string; stripeCheckoutSessionId?: string }> = [];
  if (metadataPaymentId) where.push({ id: metadataPaymentId });
  if (paymentIntentId) where.push({ stripePaymentIntentId: paymentIntentId });
  if (checkoutSessionId) where.push({ stripeCheckoutSessionId: checkoutSessionId });
  if (where.length === 0) return false;

  const payment = await prisma.orderPayment.findFirst({
    where: { OR: where, status: "PENDING" },
    select: { id: true, status: true },
  });
  if (!payment) return false;

  await markOrderPaymentPaid(payment.id, {
    stripePaymentIntentId: paymentIntentId ?? undefined,
  });
  return true;
}

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

  // --- Deduplication: skip already-processed events ---
  // findFirst (pas findUnique) car l'@unique est composite (tenantId, eventId).
  // L'extension Prisma multi-tenant injecte tenantId automatiquement en AND.
  const existingEvent = await prisma.stripeWebhookEvent.findFirst({
    where: { eventId: event.id },
  });
  if (existingEvent) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Record the event before processing (tenantId posé par l'extension).
  await prisma.stripeWebhookEvent.create({
    data: {
      eventId: event.id,
      type: event.type,
    },
  });

  // Purge best-effort des events > 30 jours, tirée ~1 fois sur 100 pour ne pas
  // charger chaque webhook. Évite d'avoir à câbler un cron externe : le trafic
  // Stripe (plusieurs events/jour en prod) garantit un passage régulier.
  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    prisma.stripeWebhookEvent
      .deleteMany({ where: { createdAt: { lt: cutoff } } })
      .then((res) => {
        if (res.count > 0) logger.info("[Stripe Webhook] Purge events anciens", { deleted: res.count });
      })
      .catch((err) => logger.warn("[Stripe Webhook] Purge échouée", { error: err }));
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;

      // Nouveau flow multi-paiements : si un OrderPayment matche ce PI, on
      // marque CE paiement PAID (et markOrderPaymentPaid aligne
      // Order.paymentStatus si le TTC est couvert).
      const metadataPaymentId =
        (pi.metadata && typeof pi.metadata.orderPaymentId === "string" && pi.metadata.orderPaymentId) || null;
      const handled = await markOrderPaymentFromStripe({
        paymentIntentId: pi.id,
        metadataPaymentId,
      });

      // Compat commandes historiques pre-backfill : fallback sur Order direct.
      if (!handled) {
        await prisma.order.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { paymentStatus: "paid" },
        });
      }

      break;
    }

    // Flow "lien de paiement" (paymentMode=STRIPE_LINK ou complément SUPPLEMENT) :
    // quand le client termine le checkout hébergé, Stripe fire à la fois
    // `payment_intent.succeeded` (géré ci-dessus) et `checkout.session.completed`.
    // On garde ce handler comme filet de sécurité au cas où l'event PI serait raté.
    case "checkout.session.completed": {
      const cs = event.data.object as Stripe.Checkout.Session;
      if (cs.payment_status === "paid") {
        const metadataPaymentId =
          (cs.metadata && typeof cs.metadata.orderPaymentId === "string" && cs.metadata.orderPaymentId) || null;
        const piId = typeof cs.payment_intent === "string" ? cs.payment_intent : cs.payment_intent?.id ?? null;
        const handled = await markOrderPaymentFromStripe({
          paymentIntentId: piId,
          checkoutSessionId: cs.id,
          metadataPaymentId,
        });
        if (!handled) {
          await prisma.order.updateMany({
            where: { stripeCheckoutSessionId: cs.id },
            data: { paymentStatus: "paid" },
          });
        }
      }
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

    // PayPal / Billie : le PI peut passer par `processing` avant `succeeded`
    // (~30s le temps que la charge se fixe). On log seulement — la page
    // /panier/retour-paiement retente `finalizeOrderFromPaymentIntent` de son
    // côté, et `payment_intent.succeeded` finira par tomber ici pour poser
    // paymentStatus=paid si la page retour l'a raté.
    case "payment_intent.processing": {
      const pi = event.data.object as Stripe.PaymentIntent;
      logger.info("[Stripe Webhook] Paiement en cours de traitement", {
        paymentIntentId: pi.id,
        methodTypes: pi.payment_method_types,
      });
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

    // Audit checkout §13 — dispute.closed : clôt l'alerte quand le litige est
    // résolu (won / lost / warning_closed). Log distinct du dispute.created
    // pour que la timeline reste lisible ; pas de mutation base à ce stade.
    case "charge.dispute.closed": {
      const dispute = event.data.object as Stripe.Dispute;
      const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : null;
      logger.warn("[Stripe Webhook] Litige clôturé", {
        disputeId: dispute.id,
        paymentIntentId: piId,
        status: dispute.status,
        amountCents: dispute.amount,
        reason: dispute.reason,
      });
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
