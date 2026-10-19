"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { roundCent } from "@/lib/money";
import { getCachedShopName } from "@/lib/cached-data";
import { getCurrentTenantId, getCurrentTenantSlug } from "@/lib/tenant";
import { tenantALS } from "@/lib/tenant-als";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import {
  buildStatementDescriptor,
  getStripeInstance,
  isStripeConfigured,
} from "@/lib/stripe";
import {
  cancelPendingSupplements,
  markOrderPaymentPaid as markPaymentPaidHelper,
  sumPaidTTC,
} from "@/lib/order-payments";
import { notifyClientSupplementRequest } from "@/lib/notifications";
import { recomputeOrderTotals } from "@/lib/order-totals";
import { getPromoItemsDiscount } from "@/lib/order-promo-items";

// Stripe refuse strictement expires_at >= 24h après création de la session
// (« must be less than 24 hours »). On garde une marge de 5 min pour couvrir
// le clock skew entre notre serveur et l'API Stripe.
const CHECKOUT_SESSION_TTL_SECONDS = 24 * 60 * 60 - 5 * 60;

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
  return session;
}

type SupplementMethod = "STRIPE_LINK" | "BANK_TRANSFER";

interface SupplementResult {
  success: boolean;
  error?: string;
  paymentId?: string;
  checkoutUrl?: string;
}

/**
 * Crée un OrderPayment SUPPLEMENT PENDING pour régulariser un dépassement.
 * Annule tout lien SUPPLEMENT PENDING précédent, génère un Stripe Checkout
 * Session si method=STRIPE_LINK, puis envoie l'email au client.
 */
export async function requestOrderSupplement(
  orderId: string,
  method: SupplementMethod,
): Promise<SupplementResult> {
  await requireAdmin();

  if (method !== "STRIPE_LINK" && method !== "BANK_TRANSFER") {
    return { success: false, error: "Mode de paiement non supporté." };
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalTTC: true,
        clientEmail: true,
        tenantId: true,
      },
    });
    if (!order) return { success: false, error: "Commande introuvable." };
    if (order.status !== "PENDING") {
      return { success: false, error: "Commande verrouillée (déjà expédiée ou annulée)." };
    }

    const paidTTC = await sumPaidTTC(orderId);
    const overshoot = roundCent(Number(order.totalTTC) - paidTTC);
    if (overshoot <= 0.01) {
      return {
        success: false,
        error: "Aucun montant restant à régler sur cette commande.",
      };
    }

    if (method === "STRIPE_LINK" && !(await isStripeConfigured())) {
      return { success: false, error: "Stripe n'est pas configuré sur cette boutique." };
    }

    // On annule les SUPPLEMENT PENDING existants et on crée le nouveau dans la
    // même transaction pour éviter 2 liens actifs si l'admin reclique vite.
    const payment = await prisma.$transaction(async (tx) => {
      await cancelPendingSupplements(orderId, tx);
      return tx.orderPayment.create({
        data: {
          orderId,
          tenantId: order.tenantId,
          kind: "SUPPLEMENT",
          method,
          status: "PENDING",
          amount: overshoot,
        },
      });
    });

    let checkoutUrl: string | null = null;
    let expiresAt: Date | null = null;

    if (method === "STRIPE_LINK") {
      try {
        const [shopName, baseUrl] = await Promise.all([
          getCachedShopName(),
          getCurrentTenantBaseUrl(),
        ]);
        const statementDescriptor = buildStatementDescriptor(shopName);
        const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS;
        const stripe = await getStripeInstance();
        const successUrl = `${baseUrl}/fr/commandes/${order.id}?supplement_success=1`;
        const cancelUrl = `${baseUrl}/fr/commandes/${order.id}?supplement_canceled=1`;
        const checkoutSession = await stripe.checkout.sessions.create({
          mode: "payment",
          // Pas de payment_method_types figé : Stripe utilise toutes les
          // méthodes activées dans le Dashboard (carte, PayPal, Apple/Google
          // Pay, Klarna, SEPA…), ce qui laisse le choix à la cliente.
          customer_email: order.clientEmail,
          locale: "fr",
          expires_at: expiresAtUnix,
          line_items: [
            {
              price_data: {
                currency: "eur",
                unit_amount: Math.round(overshoot * 100),
                product_data: {
                  name: `${shopName} — Complément commande ${order.orderNumber}`,
                  description: `Ajustement après modification. Montant restant à régler : ${overshoot.toFixed(2)} €.`,
                },
              },
              quantity: 1,
            },
          ],
          payment_intent_data: {
            metadata: {
              orderPaymentId: payment.id,
              orderId: order.id,
              orderNumber: order.orderNumber,
              kind: "SUPPLEMENT",
            },
            receipt_email: order.clientEmail,
            description: `${shopName} — Complément ${order.orderNumber}`,
            ...(statementDescriptor
              ? { statement_descriptor_suffix: statementDescriptor }
              : {}),
          },
          success_url: successUrl,
          cancel_url: cancelUrl,
        });
        if (!checkoutSession.url) throw new Error("Session Stripe créée sans URL");

        checkoutUrl = checkoutSession.url;
        expiresAt = new Date(expiresAtUnix * 1000);

        const paymentIntentId =
          typeof checkoutSession.payment_intent === "string"
            ? checkoutSession.payment_intent
            : checkoutSession.payment_intent?.id ?? null;

        await prisma.orderPayment.update({
          where: { id: payment.id },
          data: {
            stripeCheckoutSessionId: checkoutSession.id,
            stripeCheckoutUrl: checkoutSession.url,
            stripeExpiresAt: expiresAt,
            stripePaymentIntentId: paymentIntentId,
          },
        });
      } catch (stripeErr) {
        logger.error("[requestOrderSupplement] Stripe error — rollback payment", {
          orderId,
          paymentId: payment.id,
          error: stripeErr,
        });
        // On annule immédiatement le payment créé pour ne pas laisser un
        // SUPPLEMENT PENDING sans lien.
        await prisma.orderPayment.update({
          where: { id: payment.id },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
        return {
          success: false,
          error: "Impossible de générer le lien Stripe. Réessayez dans quelques instants.",
        };
      }
    }

    // Email client (fire-and-forget, scope tenant).
    const tenantId = await getCurrentTenantId();
    (async () => {
      try {
        await notifyClientSupplementRequest({
          email: order.clientEmail,
          orderNumber: order.orderNumber,
          amountTTC: overshoot,
          method,
          checkoutUrl,
          expiresAt,
          orderId: order.id,
        });
      } catch (err) {
        logger.error("[requestOrderSupplement] Email supplement error", { error: err });
      }
    })().catch(() => {});
    // (Pas de ALS requise ici — notifyClientSupplementRequest lit déjà
    // ce dont il a besoin via les helpers qui résolvent via headers.)
    void tenantId;
    void getCurrentTenantSlug;
    void tenantALS;

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath(`/commandes/${orderId}`);

    return {
      success: true,
      paymentId: payment.id,
      checkoutUrl: checkoutUrl ?? undefined,
    };
  } catch (err) {
    logger.error("[requestOrderSupplement] Error", { error: err });
    return { success: false, error: "Erreur lors de la demande de complément." };
  }
}

/**
 * Considère le dépassement comme une remise commerciale offerte : augmente
 * `Order.commercialGiftHT` du montant HT du dépassement, recompute les totaux
 * (le TTC baisse pour coller au payé). N'alimente PAS l'historique des
 * paiements : le client n'a rien payé, c'est la boutique qui absorbe.
 */
export async function applyOvershootAsDiscount(
  orderId: string,
  _note?: string,
): Promise<SupplementResult> {
  await requireAdmin();

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        totalTTC: true,
        tvaRate: true,
        carrierPrice: true,
        clientDiscountType: true,
        clientDiscountValue: true,
        promoDiscount: true,
        appliedPromotions: true,
        commercialGiftHT: true,
        tenantId: true,
      },
    });
    if (!order) return { success: false, error: "Commande introuvable." };
    if (order.status !== "PENDING") {
      return { success: false, error: "Commande verrouillée." };
    }

    const paidTTC = await sumPaidTTC(orderId);
    const overshoot = roundCent(Number(order.totalTTC) - paidTTC);
    if (overshoot <= 0.01) {
      return { success: false, error: "Aucun dépassement à offrir." };
    }

    // Conversion TTC → HT (le TTC baissera de `overshoot` = HT × (1 + tvaRate)).
    const tvaRate = order.tvaRate ?? 0;
    const giftIncrementHT = roundCent(overshoot / (1 + tvaRate));
    const newGiftHT = roundCent(Number(order.commercialGiftHT ?? 0) + giftIncrementHT);

    await prisma.$transaction(async (tx) => {
      // Annule les éventuels SUPPLEMENT PENDING (devenus inutiles).
      await cancelPendingSupplements(orderId, tx);

      // Recalcule les totaux en intégrant la nouvelle remise offerte.
      const items = await tx.orderItem.findMany({ where: { orderId } });
      const totals = recomputeOrderTotals({
        items,
        tvaRate: order.tvaRate,
        carrierPrice: order.carrierPrice,
        clientDiscountType: order.clientDiscountType,
        clientDiscountValue: order.clientDiscountValue,
        promoItemsDiscount: getPromoItemsDiscount(order),
        commercialGiftHT: newGiftHT,
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          commercialGiftHT: totals.commercialGiftHT,
          subtotalHT: totals.subtotalHT,
          tvaAmount: totals.tvaAmount,
          totalTTC: totals.totalTTC,
          clientDiscountAmt: totals.clientDiscountAmt,
          paymentStatus: "paid",
        },
      });
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath(`/commandes/${orderId}`);

    return { success: true };
  } catch (err) {
    logger.error("[applyOvershootAsDiscount] Error", { error: err });
    return { success: false, error: "Erreur lors de l'application de la remise commerciale." };
  }
}

/**
 * Annule la remise commerciale offerte précédemment sur une modification :
 * remet `Order.commercialGiftHT = 0` et recompute les totaux. Le reste à
 * régler réapparaît pour que la cliente puisse à nouveau être facturée.
 */
export async function cancelOvershootDiscount(
  orderId: string,
): Promise<SupplementResult> {
  await requireAdmin();

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        tvaRate: true,
        carrierPrice: true,
        clientDiscountType: true,
        clientDiscountValue: true,
        promoDiscount: true,
        appliedPromotions: true,
        commercialGiftHT: true,
      },
    });
    if (!order) return { success: false, error: "Commande introuvable." };
    if (order.status !== "PENDING") {
      return { success: false, error: "Commande verrouillée." };
    }
    if (Number(order.commercialGiftHT ?? 0) <= 0) {
      return { success: false, error: "Aucun dépassement offert à annuler." };
    }

    await prisma.$transaction(async (tx) => {
      const items = await tx.orderItem.findMany({ where: { orderId } });
      const totals = recomputeOrderTotals({
        items,
        tvaRate: order.tvaRate,
        carrierPrice: order.carrierPrice,
        clientDiscountType: order.clientDiscountType,
        clientDiscountValue: order.clientDiscountValue,
        promoItemsDiscount: getPromoItemsDiscount(order),
        commercialGiftHT: 0,
      });
      await tx.order.update({
        where: { id: orderId },
        data: {
          commercialGiftHT: 0,
          subtotalHT: totals.subtotalHT,
          tvaAmount: totals.tvaAmount,
          totalTTC: totals.totalTTC,
          clientDiscountAmt: totals.clientDiscountAmt,
          // La commande redevient potentiellement sous-payée (un reste à
          // régler peut apparaître). On repasse paymentStatus en "pending"
          // pour matcher la nouvelle balance ; il repassera à "paid" quand
          // la cliente soldera via carte/virement ou qu'une nouvelle offre
          // sera appliquée.
          paymentStatus: "pending",
        },
      });
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath(`/commandes/${orderId}`);

    return { success: true };
  } catch (err) {
    logger.error("[cancelOvershootDiscount] Error", { error: err });
    return { success: false, error: "Erreur lors de l'annulation de la remise." };
  }
}

/**
 * Marque un paiement en attente (virement, retrait) comme reçu. Met également
 * à jour `Order.paymentStatus = "paid"` si la commande est désormais couverte.
 */
export async function markOrderPaymentReceived(
  orderId: string,
  paymentId: string,
): Promise<SupplementResult> {
  const session = await requireAdmin();

  try {
    const payment = await prisma.orderPayment.findFirst({
      where: { id: paymentId, orderId },
      select: { id: true, status: true, method: true },
    });
    if (!payment) return { success: false, error: "Paiement introuvable." };
    if (payment.status !== "PENDING") {
      return { success: false, error: "Ce paiement n'est pas en attente." };
    }

    await markPaymentPaidHelper(payment.id, { confirmedBy: session.user.id });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath(`/commandes/${orderId}`);

    return { success: true, paymentId: payment.id };
  } catch (err) {
    logger.error("[markOrderPaymentReceived] Error", { error: err });
    return { success: false, error: "Erreur lors de la validation du paiement." };
  }
}

/** Annule un OrderPayment PENDING (lien Stripe inutilisé, virement annulé…). */
export async function cancelOrderPayment(
  orderId: string,
  paymentId: string,
): Promise<SupplementResult> {
  await requireAdmin();

  try {
    const payment = await prisma.orderPayment.findFirst({
      where: { id: paymentId, orderId },
      select: { id: true, status: true },
    });
    if (!payment) return { success: false, error: "Paiement introuvable." };
    if (payment.status !== "PENDING") {
      return { success: false, error: "Seul un paiement en attente peut être annulé." };
    }

    await prisma.orderPayment.update({
      where: { id: payment.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath(`/commandes/${orderId}`);

    return { success: true, paymentId: payment.id };
  } catch (err) {
    logger.error("[cancelOrderPayment] Error", { error: err });
    return { success: false, error: "Erreur lors de l'annulation du paiement." };
  }
}
