"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { roundCent } from "@/lib/money";
import { getCachedShopName } from "@/lib/cached-data";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import {
  buildStatementDescriptor,
  getStripeInstance,
  getStripePublishableKey,
  isStripeConfigured,
} from "@/lib/stripe";
import { cancelPendingSupplements, sumPaidTTC } from "@/lib/order-payments";

// Stripe refuse strictement expires_at >= 24h après création de la session
// (« must be less than 24 hours »). On garde une marge de 5 min pour couvrir
// le clock skew entre notre serveur et l'API Stripe.
const CHECKOUT_SESSION_TTL_SECONDS = 24 * 60 * 60 - 5 * 60;

type SupplementMethod = "STRIPE_LINK" | "BANK_TRANSFER";

interface Result {
  success: boolean;
  error?: string;
  /** Secret client de la Checkout Session (ui_mode = embedded) à monter avec <EmbeddedCheckout />. */
  clientSecret?: string;
  /** Clé publique Stripe pour instancier le SDK côté navigateur. */
  publishableKey?: string;
  method?: SupplementMethod;
}

/**
 * Appelée par la cliente propriétaire de la commande pour choisir comment
 * régler le dépassement (différence) : lien Stripe ou virement bancaire. On ne
 * peut PAS payer le total : seul l'écart `totalTTC − sumPaidTTC` est encaissé.
 *
 * - Vérifie l'ownership de la commande.
 * - Annule les SUPPLEMENT PENDING précédents (un seul lien actif).
 * - Crée un OrderPayment SUPPLEMENT PENDING du montant du dépassement.
 * - Pour STRIPE_LINK : génère la Checkout Session Stripe (24 h de validité).
 */
export async function requestSupplementPayment(
  orderId: string,
  method: SupplementMethod,
): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Vous devez être connectée pour continuer." };

  if (method !== "STRIPE_LINK" && method !== "BANK_TRANSFER") {
    return { success: false, error: "Mode de règlement non supporté." };
  }

  try {
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: session.user.id },
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
      return { success: false, error: "Cette commande n'accepte plus de règlement complémentaire." };
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
      return {
        success: false,
        error: "Le règlement par carte est momentanément indisponible. Choisissez le virement.",
      };
    }

    // Annulation des SUPPLEMENT PENDING précédents + création du nouveau,
    // dans la même transaction (évite deux liens actifs si clic rapide).
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

    let clientSecret: string | null = null;
    let publishableKey: string | null = null;

    if (method === "STRIPE_LINK") {
      try {
        const [shopName, baseUrl, pk] = await Promise.all([
          getCachedShopName(),
          getCurrentTenantBaseUrl(),
          getStripePublishableKey(),
        ]);
        publishableKey = pk;
        const statementDescriptor = buildStatementDescriptor(shopName);
        const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS;
        const stripe = await getStripeInstance();
        const returnUrl = `${baseUrl}/fr/commandes/${order.id}?supplement_session={CHECKOUT_SESSION_ID}`;
        // ui_mode "embedded" : Stripe renvoie un `client_secret` à monter avec
        // <EmbeddedCheckout /> directement dans la page commande — mêmes
        // méthodes de paiement activées dans le Dashboard que le panier.
        const checkoutSession = await stripe.checkout.sessions.create({
          mode: "payment",
          ui_mode: "embedded",
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
                  description: `Montant restant à régler sur la commande : ${overshoot.toFixed(2)} €.`,
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
          return_url: returnUrl,
        });
        if (!checkoutSession.client_secret) {
          throw new Error("Session Stripe embedded créée sans client_secret");
        }

        clientSecret = checkoutSession.client_secret;
        const paymentIntentId =
          typeof checkoutSession.payment_intent === "string"
            ? checkoutSession.payment_intent
            : checkoutSession.payment_intent?.id ?? null;

        await prisma.orderPayment.update({
          where: { id: payment.id },
          data: {
            stripeCheckoutSessionId: checkoutSession.id,
            stripeExpiresAt: new Date(expiresAtUnix * 1000),
            stripePaymentIntentId: paymentIntentId,
          },
        });
      } catch (stripeErr) {
        logger.error("[requestSupplementPayment] Stripe error — rollback payment", {
          orderId,
          paymentId: payment.id,
          error: stripeErr,
        });
        await prisma.orderPayment.update({
          where: { id: payment.id },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
        return {
          success: false,
          error: "Impossible de générer la session de paiement. Réessayez dans quelques instants.",
        };
      }
    }

    revalidatePath(`/commandes/${orderId}`);

    return {
      success: true,
      method,
      clientSecret: clientSecret ?? undefined,
      publishableKey: publishableKey ?? undefined,
    };
  } catch (err) {
    logger.error("[requestSupplementPayment] Error", { error: err });
    return { success: false, error: "Erreur lors de la demande de règlement." };
  }
}

/**
 * Permet à la cliente de changer d'avis : annule le SUPPLEMENT PENDING actif
 * pour pouvoir en demander un nouveau d'un autre mode.
 */
export async function cancelMySupplementPayment(orderId: string): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Vous devez être connectée pour continuer." };

  try {
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: session.user.id },
      select: { id: true },
    });
    if (!order) return { success: false, error: "Commande introuvable." };

    await cancelPendingSupplements(orderId);
    revalidatePath(`/commandes/${orderId}`);
    return { success: true };
  } catch (err) {
    logger.error("[cancelMySupplementPayment] Error", { error: err });
    return { success: false, error: "Erreur lors de l'annulation." };
  }
}
