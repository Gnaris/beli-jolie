"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildStatementDescriptor,
  getStripeInstance,
  isStripeConfigured,
} from "@/lib/stripe";
import { getCachedShopName } from "@/lib/cached-data";
import { notifyOrderStatusChange } from "@/lib/notifications";

/**
 * Crée un PaymentIntent Stripe pour régler par carte une commande initialement
 * passée en virement (encore en attente de paiement). Écrit `stripePaymentIntentId`
 * sur la commande — le webhook Stripe fera passer `paymentStatus` à "paid"
 * automatiquement, mais on double-check côté serveur via `confirmOrderCardPayment`
 * (plus rapide que d'attendre le webhook).
 */
export async function createOrderCardPaymentIntent(
  orderId: string,
): Promise<
  | { success: true; clientSecret: string; paymentIntentId: string; amountCents: number }
  | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non authentifié." };
  const userId = session.user.id;

  const rl = rateLimit(`pay-order-card:${userId}`, 5, 60_000);
  if (!rl.success) {
    return { success: false, error: "Trop de tentatives. Merci de patienter." };
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      orderNumber: true,
      totalTTC: true,
      status: true,
      paymentMode: true,
      paymentStatus: true,
      clientEmail: true,
      clientCompany: true,
    },
  });
  if (!order) return { success: false, error: "Commande introuvable." };
  if (order.status === "CANCELLED") {
    return { success: false, error: "Cette commande est annulée." };
  }
  if (order.paymentStatus === "paid") {
    return { success: false, error: "Cette commande est déjà payée." };
  }
  if (order.paymentMode !== "BANK_TRANSFER") {
    return { success: false, error: "Cette commande n'est pas un virement en attente." };
  }

  if (!(await isStripeConfigured())) {
    return { success: false, error: "Paiement par carte indisponible pour cette boutique." };
  }

  const amountCents = Math.round(Number(order.totalTTC) * 100);
  if (amountCents < 50) {
    return { success: false, error: "Le montant minimum est de 0,50 €." };
  }

  try {
    const stripe = await getStripeInstance();
    const shopName = await getCachedShopName();
    const statementDescriptor = buildStatementDescriptor(shopName);

    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "eur",
      payment_method_types: ["card"],
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId,
        switchFromBankTransfer: "1",
      },
      receipt_email: order.clientEmail,
      description: `${shopName} — ${order.clientCompany} — Commande ${order.orderNumber} (bascule virement → carte)`,
      ...(statementDescriptor ? { statement_descriptor_suffix: statementDescriptor } : {}),
    });

    // On enregistre l'ID PI sur la commande : le webhook Stripe pourra la
    // rattacher automatiquement en cas de succès (double filet avec
    // confirmOrderCardPayment côté client).
    await prisma.order.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: pi.id },
    });

    return {
      success: true,
      clientSecret: pi.client_secret!,
      paymentIntentId: pi.id,
      amountCents,
    };
  } catch (err) {
    logger.error("[createOrderCardPaymentIntent] Erreur Stripe", { error: err, orderId });
    return { success: false, error: "Impossible de préparer le paiement. Réessayez." };
  }
}

/**
 * Après que le client a validé le paiement carte côté Stripe, on double-check
 * ici que le PI est bien `succeeded`, on met à jour la commande (paymentMode
 * bascule à CARD, paymentStatus à paid) et on envoie l'email de confirmation.
 * Idempotent : si le webhook a déjà mis paymentStatus à paid, on ne re-envoie
 * pas l'email.
 */
export async function confirmOrderCardPayment(
  orderId: string,
  paymentIntentId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non authentifié." };
  const userId = session.user.id;

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      orderNumber: true,
      totalTTC: true,
      status: true,
      paymentMode: true,
      paymentStatus: true,
      stripePaymentIntentId: true,
    },
  });
  if (!order) return { success: false, error: "Commande introuvable." };
  if (order.stripePaymentIntentId !== paymentIntentId) {
    return { success: false, error: "PaymentIntent non rattaché à cette commande." };
  }

  try {
    const stripe = await getStripeInstance();
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== "succeeded") {
      return { success: false, error: `Paiement non confirmé (statut Stripe: ${pi.status}).` };
    }
    const expectedCents = Math.round(Number(order.totalTTC) * 100);
    if (Math.abs(pi.amount - expectedCents) > 1) {
      logger.error("[confirmOrderCardPayment] Montant incohérent", {
        paid: pi.amount,
        expected: expectedCents,
        orderId,
      });
      return { success: false, error: "Le montant Stripe ne correspond pas à la commande." };
    }
  } catch (err) {
    logger.error("[confirmOrderCardPayment] Erreur retrieve PI", { error: err, orderId });
    return { success: false, error: "Impossible de vérifier le paiement." };
  }

  const wasAlreadyPaid = order.paymentStatus === "paid";
  if (!wasAlreadyPaid) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentMode: "CARD",
        paymentStatus: "paid",
      },
    });

    // Email de confirmation client (réutilise le template « virement reçu »
    // qui est neutre côté texte — « nous avons bien reçu votre paiement »).
    notifyOrderStatusChange({
      orderId: order.id,
      newStatus: "BANK_TRANSFER_CONFIRMED",
    }).catch((err) =>
      logger.error("[confirmOrderCardPayment] Email client error", { error: err }),
    );
  }

  revalidatePath("/commandes");
  revalidatePath(`/commandes/${orderId}`);
  revalidatePath("/admin/commandes");
  revalidatePath(`/admin/commandes/${orderId}`);

  return { success: true };
}
