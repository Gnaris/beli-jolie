"use server";

/**
 * Finalisation côté cliente d'une commande créée par l'admin (isAdminDraft=true).
 *
 * La cliente a vu la commande dans /espace-pro/commandes avec badge « À
 * finaliser et payer ». Elle a cliqué dessus → page /commandes/[id]/finaliser,
 * elle a choisi son adresse + transporteur + mode de paiement.
 *
 * Cette action :
 *   1. Vérifie que la commande lui appartient ET est en draft admin.
 *   2. Met à jour l'adresse de livraison + le transporteur + les totaux
 *      (recalcul HT + TVA + TTC avec le port choisi).
 *   3. Fixe le paymentMode choisi par la cliente :
 *        - BANK_TRANSFER : rien d'autre à faire ; la fiche /commandes/[id]
 *          affichera l'IBAN avec l'UI standard. Admin confirmera à réception.
 *        - STRIPE_LINK   : génère un Checkout Session, retourne l'URL.
 *   4. Flip isAdminDraft → false (c'est désormais une commande standard).
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { getStripeInstance, isStripeConfigured } from "@/lib/stripe";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { getCachedShopName } from "@/lib/cached-data";

export type FinalizePaymentMode = "BANK_TRANSFER" | "STRIPE_LINK";

export interface FinalizeAdminOrderInput {
  orderId: string;
  // Adresse de livraison (saisie par la cliente)
  shipFirstName: string;
  shipLastName: string;
  shipCompany: string | null;
  shipAddress1: string;
  shipAddress2: string | null;
  shipZipCode: string;
  shipCity: string;
  shipCountry: string;
  // Transporteur choisi (snapshot) — carrierId libre côté client, le prix est
  // ce qui est renvoyé par /api/carriers OU 0 si retrait / privé.
  carrierId: string;
  carrierName: string;
  carrierPrice: number;
  // Mode de paiement
  paymentMode: FinalizePaymentMode;
}

export type FinalizeAdminOrderResult =
  | { success: true; mode: "BANK_TRANSFER"; orderId: string }
  | { success: true; mode: "STRIPE_LINK"; orderId: string; checkoutUrl: string }
  | { success: false; error: string };

function roundCent(n: number): number {
  return Math.round(n * 100) / 100;
}

// Stripe refuse strictement expires_at >= 24h après création (« must be
// less than 24 hours »). Marge 5 min pour couvrir le clock skew.
const CHECKOUT_SESSION_TTL_SECONDS = 24 * 60 * 60 - 5 * 60;

export async function finalizeAdminOrder(
  input: FinalizeAdminOrderInput,
): Promise<FinalizeAdminOrderResult> {
  try {
    const { session } = await requireAuth();

    // 1. Charger la commande draft
    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: {
          select: {
            productName: true,
            unitPrice: true,
            quantity: true,
          },
        },
      },
    });
    if (!order) return { success: false, error: "Commande introuvable." };
    if (order.userId !== session.user.id) {
      return { success: false, error: "Cette commande n'est pas la vôtre." };
    }
    if (!order.isAdminDraft) {
      return { success: false, error: "Cette commande est déjà finalisée." };
    }
    if (order.status === "CANCELLED") {
      return { success: false, error: "Commande annulée." };
    }

    // 2. Validation de base
    const requiredStrings: [string, string][] = [
      ["prénom", input.shipFirstName],
      ["nom", input.shipLastName],
      ["adresse", input.shipAddress1],
      ["code postal", input.shipZipCode],
      ["ville", input.shipCity],
      ["pays", input.shipCountry],
      ["transporteur", input.carrierId],
    ];
    for (const [label, value] of requiredStrings) {
      if (!value || !value.trim()) {
        return { success: false, error: `Le champ ${label} est obligatoire.` };
      }
    }
    if (!Number.isFinite(input.carrierPrice) || input.carrierPrice < 0) {
      return { success: false, error: "Prix de transport invalide." };
    }
    if (input.paymentMode !== "BANK_TRANSFER" && input.paymentMode !== "STRIPE_LINK") {
      return { success: false, error: "Mode de paiement invalide." };
    }

    // 3. Recalcul totals (HT inchangé, port + TVA + TTC recalculés)
    const subtotalHT = Number(order.subtotalHT);
    const tvaRate = Number(order.tvaRate);
    const carrierPrice = roundCent(input.carrierPrice);
    const tvaAmount = roundCent((subtotalHT + carrierPrice) * tvaRate);
    const totalTTC = roundCent(subtotalHT + carrierPrice + tvaAmount);

    // 4. Si Stripe choisi : créer un Checkout Session
    let checkoutUrl: string | null = null;
    let stripeSessionId: string | null = null;
    let stripeSessionExpiresAt: Date | null = null;

    if (input.paymentMode === "STRIPE_LINK") {
      if (!(await isStripeConfigured())) {
        return { success: false, error: "Le paiement par carte n'est pas configuré. Choisissez le virement bancaire." };
      }
      const stripe = await getStripeInstance();
      const baseUrl = await getCurrentTenantBaseUrl();
      const shopName = await getCachedShopName();
      try {
        const unitAmountCents = Math.round(totalTTC * 100);
        const session_ = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "eur",
                unit_amount: unitAmountCents,
                product_data: { name: `Commande ${order.orderNumber} — ${shopName}` },
              },
            },
          ],
          customer_email: order.clientEmail,
          success_url: `${baseUrl}/commandes/${order.id}?payment=success`,
          cancel_url: `${baseUrl}/commandes/${order.id}`,
          expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
        });
        checkoutUrl = session_.url ?? null;
        stripeSessionId = session_.id;
        stripeSessionExpiresAt = new Date((session_.expires_at ?? 0) * 1000);
      } catch (err) {
        logger.error("[finalizeAdminOrder] Stripe Checkout error", { error: err as Error });
        return { success: false, error: "Erreur Stripe. Choisissez le virement bancaire ou réessayez." };
      }
      if (!checkoutUrl) return { success: false, error: "URL Stripe manquante." };
    }

    // 5. Update order : adresse, carrier, totaux, paymentMode, flip isAdminDraft
    await prisma.order.update({
      where: { id: order.id },
      data: {
        shipFirstName: input.shipFirstName.trim(),
        shipLastName: input.shipLastName.trim(),
        shipCompany: input.shipCompany?.trim() || null,
        shipAddress1: input.shipAddress1.trim(),
        shipAddress2: input.shipAddress2?.trim() || null,
        shipZipCode: input.shipZipCode.trim(),
        shipCity: input.shipCity.trim(),
        shipCountry: input.shipCountry.trim().toUpperCase(),
        carrierId: input.carrierId.trim(),
        carrierName: input.carrierName.trim() || input.carrierId.trim(),
        carrierPrice,
        carrierBasePrice: carrierPrice,
        tvaAmount,
        totalTTC,
        paidSubtotalHT: subtotalHT, // snapshot HT « payé » (sert aux modifs post-commande)
        paymentMode: input.paymentMode,
        paymentStatus: "pending",
        isAdminDraft: false,
        stripeCheckoutSessionId: stripeSessionId,
        stripeCheckoutSessionUrl: checkoutUrl,
        stripeCheckoutSessionExpiresAt: stripeSessionExpiresAt,
      },
    });

    // 6. Revalidation caches
    revalidatePath(`/commandes/${order.id}`);
    revalidateTag("admin-dashboard", "default");

    if (input.paymentMode === "STRIPE_LINK" && checkoutUrl) {
      return { success: true, mode: "STRIPE_LINK", orderId: order.id, checkoutUrl };
    }
    return { success: true, mode: "BANK_TRANSFER", orderId: order.id };
  } catch (err) {
    logger.error("[finalizeAdminOrder] Erreur", { error: err as Error });
    return { success: false, error: err instanceof Error ? err.message : "Erreur serveur." };
  }
}
