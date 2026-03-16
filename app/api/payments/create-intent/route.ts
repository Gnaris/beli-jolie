import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

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
  const { addressId, carrierId, carrierName, carrierPrice, tvaRate } = body as {
    addressId: string;
    carrierId: string;
    carrierName: string;
    carrierPrice: number;
    tvaRate: number;
  };

  const userId = session.user.id;

  // Récupérer panier + adresse + user
  const [cart, address, user] = await Promise.all([
    prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            saleOption: {
              include: {
                productColor: true,
              },
            },
          },
        },
      },
    }),
    prisma.shippingAddress.findFirst({ where: { id: addressId, userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { company: true, email: true, stripeCustomerId: true },
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
  type SaleOpt = (typeof cartItems)[0]["saleOption"];

  function computeUnitPrice(opt: SaleOpt): number {
    const { unitPrice } = opt.productColor;
    const base = opt.saleType === "UNIT" ? unitPrice : unitPrice * (opt.packQuantity ?? 1);
    if (!opt.discountType || !opt.discountValue) return base;
    if (opt.discountType === "PERCENT") return Math.max(0, base * (1 - opt.discountValue / 100));
    return Math.max(0, base - opt.discountValue);
  }

  const subtotalHT = cartItems.reduce(
    (s, item) => s + computeUnitPrice(item.saleOption) * item.quantity,
    0
  );
  const tvaAmount = subtotalHT * tvaRate;
  const totalTTC = subtotalHT + tvaAmount + carrierPrice;

  const amountCents = Math.round(totalTTC * 100);

  if (amountCents < 50) {
    return NextResponse.json({ error: "Le montant minimum est de 0,50 €." }, { status: 400 });
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
        description: `Commande Beli & Jolie — ${user?.company ?? "Client"}`,
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
      description: `Commande Beli & Jolie — ${user?.company ?? "Client"}`,
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
