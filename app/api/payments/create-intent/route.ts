import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getStripeInstance, getConnectedAccountId, getCommissionRate, isStripeConnectReady } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getCachedShopName } from "@/lib/cached-data";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const CreateIntentSchema = z.object({
  addressId: z.string().min(1),
  carrierId: z.string().min(1),
  carrierName: z.string().min(1),
  carrierPrice: z.number().min(0),
  tvaRate: z.number().refine((v) => [0, 0.2].includes(v), {
    message: "Taux de TVA invalide.",
  }),
});

/**
 * POST /api/payments/create-intent
 * Crée un Stripe Payment Intent pour le montant TTC de la commande (carte uniquement).
 *
 * Body: { addressId, carrierId, carrierName, carrierPrice, tvaRate }
 * Returns: { clientSecret, paymentIntentId }
 */
export async function POST(req: Request) {
  // Rate limit : 5 req/min par IP (protection abus de paiement)
  const rateLimited = checkRateLimit(req, "create-intent", 5, 60_000);
  if (rateLimited) return rateLimited;

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = await req.json();
  const parsed = CreateIntentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { addressId, carrierId, carrierName, carrierPrice, tvaRate } = parsed.data;

  const userId = session.user.id;

  // Récupérer panier + adresse + user
  const [cart, address, user] = await Promise.all([
    prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            variant: {
              select: {
                id: true, unitPrice: true, saleType: true, packQuantity: true,
                weight: true,
                product: { select: { discountPercent: true } },
              },
            },
          },
        },
      },
    }),
    prisma.shippingAddress.findFirst({ where: { id: addressId, userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { company: true, email: true, discountType: true, discountValue: true, discountMode: true, discountMinAmount: true, discountMinQuantity: true, freeShipping: true, shippingDiscountType: true, shippingDiscountValue: true },
    }),
  ]);

  if (!cart || cart.items.length === 0) {
    return NextResponse.json({ error: "Panier vide." }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: "Adresse introuvable." }, { status: 400 });
  }

  // Recalculer le total côté serveur (sécurité)
  const cartItems = cart.items;
  type Variant = (typeof cartItems)[0]["variant"];

  function computeUnitPrice(v: Variant): number {
    const price = Number(v.unitPrice);
    const base = v.saleType === "UNIT" ? price : price * (v.packQuantity ?? 1);
    const discountPercent = v.product?.discountPercent != null ? Number(v.product.discountPercent) : null;
    if (!discountPercent || discountPercent <= 0) return base;
    return Math.max(0, base * (1 - discountPercent / 100));
  }

  const subtotalHT = cartItems.reduce(
    (s, item) => s + computeUnitPrice(item.variant) * item.quantity,
    0
  );

  // Remise commerciale client (check mode THRESHOLD with quantity)
  const totalItemQuantity = cartItems.reduce((s, item) => s + item.quantity, 0);
  const clientDiscountAmt = (() => {
    if (!user?.discountType || !user.discountValue) return 0;
    const mode = user.discountMode ?? "PERMANENT";
    if (mode === "THRESHOLD") {
      const minAmount = user.discountMinAmount != null ? Number(user.discountMinAmount) : 0;
      const minQty = user.discountMinQuantity ?? 0;
      if ((minAmount > 0 && subtotalHT < minAmount) || (minQty > 0 && totalItemQuantity < minQty)) return 0;
    }
    const dv = Number(user.discountValue);
    if (user.discountType === "PERCENT")
      return Math.min(subtotalHT, subtotalHT * (dv / 100));
    return Math.min(subtotalHT, dv);
  })();
  const subtotalAfterDiscount = subtotalHT - clientDiscountAmt;
  const effectiveCarrierPrice = (() => {
    if (user?.freeShipping) return 0;
    if (user?.shippingDiscountType && user.shippingDiscountValue != null) {
      const sdv = Number(user.shippingDiscountValue);
      if (user.shippingDiscountType === "PERCENT") return Math.max(0, carrierPrice * (1 - sdv / 100));
      return Math.max(0, carrierPrice - sdv);
    }
    return carrierPrice;
  })();

  const tvaAmount = subtotalAfterDiscount * tvaRate;
  const totalTTC = subtotalAfterDiscount + tvaAmount + effectiveCarrierPrice;

  const amountCents = Math.round(totalTTC * 100);

  if (amountCents < 50) {
    return NextResponse.json({ error: "Le montant minimum est de 0,50 €." }, { status: 400 });
  }

  const shopName = await getCachedShopName();

  // Vérifier que Stripe Connect est prêt
  const connectReady = await isStripeConnectReady();
  if (!connectReady) {
    return NextResponse.json({ error: "Paiement indisponible. Le compte Stripe n'est pas encore relié." }, { status: 503 });
  }

  let stripe;
  try {
    stripe = await getStripeInstance();
  } catch {
    return NextResponse.json({ error: "Stripe non configuré. Contactez l'administrateur." }, { status: 503 });
  }

  const connectAccountId = await getConnectedAccountId();

  try {
    // Calculer la commission plateforme
    const commissionRate = await getCommissionRate();
    const applicationFeeAmount = Math.round(amountCents * commissionRate);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "eur",
      payment_method_types: ["card"],
      application_fee_amount: applicationFeeAmount > 0 ? applicationFeeAmount : undefined,
      metadata: {
        userId,
        addressId,
        carrierId,
        carrierName,
        carrierPrice: String(carrierPrice),
        tvaRate: String(tvaRate),
      },
      receipt_email: user?.email ?? undefined,
      description: `${shopName} — ${user?.company ?? "Client"} (${user?.email ?? "?"}) — ${(totalTTC).toFixed(2)} € TTC`,
    }, { stripeAccount: connectAccountId! });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    logger.error("[create-intent] Erreur création PI", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Impossible de créer le paiement." }, { status: 500 });
  }
}
