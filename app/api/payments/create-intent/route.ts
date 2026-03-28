import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getStripeInstance } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getCachedShopName } from "@/lib/cached-data";

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
 * Crée un Stripe Payment Intent pour le montant TTC de la commande.
 * Tente carte + virement bancaire. Si le virement n'est pas dispo, fallback carte seule.
 *
 * Body: { addressId, carrierId, carrierName, carrierPrice, tvaRate }
 * Returns: { clientSecret, paymentIntentId, bankTransferAvailable }
 */
export async function POST(req: Request) {
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
                weight: true, discountType: true, discountValue: true,
              },
            },
          },
        },
      },
    }),
    prisma.shippingAddress.findFirst({ where: { id: addressId, userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { company: true, email: true, stripeCustomerId: true, discountType: true, discountValue: true, freeShipping: true },
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
    const base = v.saleType === "UNIT" ? v.unitPrice : v.unitPrice * (v.packQuantity ?? 1);
    if (!v.discountType || !v.discountValue) return base;
    if (v.discountType === "PERCENT") return Math.max(0, base * (1 - v.discountValue / 100));
    return Math.max(0, base - v.discountValue);
  }

  const subtotalHT = cartItems.reduce(
    (s, item) => s + computeUnitPrice(item.variant) * item.quantity,
    0
  );

  // Remise commerciale client
  const clientDiscountAmt = (() => {
    if (!user?.discountType || !user.discountValue) return 0;
    if (user.discountType === "PERCENT")
      return Math.min(subtotalHT, subtotalHT * (user.discountValue / 100));
    return Math.min(subtotalHT, user.discountValue);
  })();
  const subtotalAfterDiscount = subtotalHT - clientDiscountAmt;
  const effectiveCarrierPrice = user?.freeShipping ? 0 : carrierPrice;

  const tvaAmount = subtotalAfterDiscount * tvaRate;
  const totalTTC = subtotalAfterDiscount + tvaAmount + effectiveCarrierPrice;

  const amountCents = Math.round(totalTTC * 100);

  if (amountCents < 50) {
    return NextResponse.json({ error: "Le montant minimum est de 0,50 €." }, { status: 400 });
  }

  const shopName = await getCachedShopName();

  // Initialiser Stripe dynamiquement (clés DB ou env)
  let stripe;
  try {
    stripe = await getStripeInstance();
  } catch {
    return NextResponse.json({ error: "Stripe non configuré. Contactez l'administrateur." }, { status: 503 });
  }

  // Créer ou récupérer le Stripe Customer (requis pour le virement bancaire)
  let stripeCustomerId = user?.stripeCustomerId;

  if (!stripeCustomerId) {
    try {
      const customer = await stripe.customers.create({
        email: user?.email ?? undefined,
        name: user?.company ?? undefined,
        metadata: { userId },
      });
      stripeCustomerId = customer.id;

      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id },
      });
    } catch (err) {
      console.error("[create-intent] Erreur création Stripe Customer:", err);
    }
  }

  // Tenter avec carte + virement bancaire
  let bankTransferAvailable = false;

  if (stripeCustomerId) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "eur",
        customer: stripeCustomerId,
        payment_method_types: ["card", "customer_balance"],
        payment_method_options: {
          customer_balance: {
            funding_type: "bank_transfer",
            bank_transfer: {
              type: "eu_bank_transfer",
              eu_bank_transfer: {
                country: "FR",
              },
            },
          },
        },
        metadata: {
          userId,
          addressId,
          carrierId,
          carrierName,
          carrierPrice: String(carrierPrice),
          tvaRate: String(tvaRate),
        },
        receipt_email: user?.email ?? undefined,
        description: `Commande ${shopName} — ${user?.company ?? "Client"}`,
      });

      console.log("[create-intent] PI créé avec carte + virement:", paymentIntent.id);
      bankTransferAvailable = true;

      return NextResponse.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        bankTransferAvailable,
      });
    } catch (err) {
      console.warn("[create-intent] customer_balance non dispo, fallback carte seule:", (err as Error).message);
    }
  }

  // Fallback : carte seule
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "eur",
      customer: stripeCustomerId ?? undefined,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId,
        addressId,
        carrierId,
        carrierName,
        carrierPrice: String(carrierPrice),
        tvaRate: String(tvaRate),
      },
      receipt_email: user?.email ?? undefined,
      description: `Commande ${shopName} — ${user?.company ?? "Client"}`,
    });

    console.log("[create-intent] PI créé (carte seule, fallback):", paymentIntent.id);

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      bankTransferAvailable,
    });
  } catch (err) {
    console.error("[create-intent] Erreur création PI:", err);
    return NextResponse.json({ error: "Impossible de créer le paiement." }, { status: 500 });
  }
}
