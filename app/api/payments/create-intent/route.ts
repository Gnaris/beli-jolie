import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildStatementDescriptor, getStripeInstance, isStripeConfigured } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getCachedShopName } from "@/lib/cached-data";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { loadActivePromotions, validatePromoCode } from "@/lib/promotions";
import { buildCartPromoContexts } from "@/lib/promotion-cart-context";
import { computeOrderPricing } from "@/lib/order-pricing";
import { stockUnitsForCartLine } from "@/lib/stock-units";
import { verifyCarrierSignature } from "@/lib/carrier-signature";

const CreateIntentSchema = z.object({
  addressId: z.string().min(1),
  carrierId: z.string().min(1),
  carrierName: z.string().min(1),
  carrierPrice: z.number().min(0),
  // transactionId + carrierSig : anti-fraude carrierPrice (audit checkout §8).
  // Optionnels au niveau du schéma pour accepter les carriers spéciaux
  // (pickup_store, private_carrier) — vérifiés plus bas.
  transactionId: z.string().optional(),
  carrierSig: z.string().optional(),
  promoCode: z.string().optional(),
});

/**
 * POST /api/payments/create-intent
 * Crée un Stripe Payment Intent pour le montant TTC de la commande (carte uniquement).
 *
 * Body: { addressId, carrierId, carrierName, carrierPrice, promoCode? }
 * Returns: { clientSecret, paymentIntentId }
 */
export async function POST(req: Request) {
  const rateLimited = checkRateLimit(req, "create-intent", 5, 60_000);
  if (rateLimited) return rateLimited;

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = await req.json();
  const parsed = CreateIntentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { addressId, carrierId, carrierName, carrierPrice, transactionId, carrierSig, promoCode } = parsed.data;

  const userId = session.user.id;

  const [cart, address, user] = await Promise.all([
    prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            variant: {
              select: {
                id: true,
                unitPrice: true,
                saleType: true,
                packQuantity: true,
                weight: true,
                stock: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    status: true,
                    discountPercent: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.shippingAddress.findFirst({ where: { id: addressId, userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        company: true, email: true, vatExempt: true,
        discountType: true, discountValue: true, discountMode: true, discountMinAmount: true, discountMinQuantity: true,
        freeShipping: true, freeShippingMaxPrice: true,
        shippingDiscountType: true, shippingDiscountValue: true, shippingDiscountMode: true,
        shippingDiscountMinAmount: true, shippingDiscountMinQuantity: true,
      },
    }),
  ]);

  if (!cart || cart.items.length === 0) {
    return NextResponse.json({ error: "Panier vide." }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: "Adresse introuvable." }, { status: 400 });
  }
  // Re-vérif du statut d'approbation (audit §11) : le middleware bloque les
  // PENDING sur /panier mais pas les endpoints API. Si l'admin retire
  // l'approbation pendant que le client a l'onglet ouvert, on doit refuser.
  if (user && user.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Votre compte n'est pas encore approuvé pour passer commande." },
      { status: 403 },
    );
  }

  // Refuser tout produit qui n'est plus en ligne (double garde : middleware
  // catalog + ici, au moment de la préparation du paiement).
  const offline = cart.items.find((i) => i.variant.product.status !== "ONLINE");
  if (offline) {
    return NextResponse.json(
      {
        error: `Le produit « ${offline.variant.product.name} » n'est plus disponible. Retirez-le du panier pour continuer.`,
      },
      { status: 400 },
    );
  }

  // Pré-check stock AVANT création du PaymentIntent Stripe : le client ne doit
  // JAMAIS être débité d'un article en rupture. Le check final atomique dans
  // placeOrder reste le filet anti-race si un autre client vide le stock
  // pendant que Mme X saisit sa carte.
  const shortStock = cart.items.find(
    (i) => i.variant.stock < stockUnitsForCartLine(i),
  );
  if (shortStock) {
    const packQty = shortStock.variant.packQuantity ?? 1;
    const remaining =
      shortStock.variant.saleType === "PACK" && packQty > 1
        ? Math.floor(shortStock.variant.stock / packQty)
        : shortStock.variant.stock;
    const unit =
      shortStock.variant.saleType === "PACK" && packQty > 1
        ? `paquet${remaining > 1 ? "s" : ""}`
        : "";
    return NextResponse.json(
      {
        error: `Stock insuffisant pour « ${shortStock.variant.product.name} » : il en reste ${remaining}${unit ? ` ${unit}` : ""}, vous en demandez ${shortStock.quantity}. Retirez ou réduisez cet article pour continuer.`,
      },
      { status: 409 },
    );
  }

  // Vérif signature transporteur (anti-fraude carrierPrice) — audit §8.
  // Un client malicieux peut poster `carrierPrice=0` pour payer 0 € de port.
  // On vérifie que le trio (carrierId, carrierPrice, transactionId) a bien été
  // signé côté serveur dans la réponse de /api/carriers. On la place APRÈS le
  // pré-check stock/produit-hors-ligne pour privilégier l'erreur métier claire
  // ("Bague X en rupture") si les deux échouent en même temps.
  const sigOk = verifyCarrierSignature({
    carrierId,
    carrierPrice,
    transactionId: transactionId ?? "",
    carrierSig: carrierSig ?? "",
  });
  if (!sigOk) {
    logger.warn("[create-intent] Signature transporteur invalide", {
      carrierId,
      carrierPrice,
      hasTransactionId: !!transactionId,
      hasSig: !!carrierSig,
    });
    return NextResponse.json(
      { error: "Le transporteur ou son tarif ne peuvent pas être vérifiés. Rechargez la page." },
      { status: 400 },
    );
  }

  const [activePromos, promoContexts] = await Promise.all([
    loadActivePromotions(),
    buildCartPromoContexts(cart.items),
  ]);

  const pricingItems = cart.items
    .map((i) => {
      const ctx = promoContexts.get(i.id);
      if (!ctx) return null;
      return { id: i.id, quantity: i.quantity, promoContext: ctx.context };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  // Valider le code promo si fourni
  let appliedCodePromo = null;
  if (promoCode && promoCode.trim()) {
    const subtotalPreCode = pricingItems.reduce((s, it) => {
      const resolved = computeOrderPricing({
        items: [it],
        carrierId,
        carrierPrice: 0,
        addressCountry: address.country,
        user: userToPricing(user),
        activePromos,
        appliedCodePromo: null,
      });
      return s + resolved.subtotalHT;
    }, 0);
    const check = await validatePromoCode(
      promoCode.trim(),
      {
        items: pricingItems.map((i) => ({ ...i.promoContext, quantity: i.quantity })),
        subtotalHT: subtotalPreCode,
        carrierPrice,
        userId,
        userShipping: { isFree: user?.freeShipping ?? false, savedAmount: 0 },
      },
      activePromos,
    );
    if (!check.valid) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    appliedCodePromo = activePromos.find((p) => p.id === check.result.promotionId) ?? null;
  }

  const pricing = computeOrderPricing({
    items: pricingItems,
    carrierId,
    carrierPrice,
    addressCountry: address.country,
    user: userToPricing(user),
    activePromos,
    appliedCodePromo,
  });

  // Pré-check minimum de commande (audit §14) : refuser AVANT création PI si
  // subtotalHT < min_order_ht configuré. Sinon le débit passe et placeOrder
  // rembourse — ce qui est visible pour la cliente mais évitable.
  const minConfig = await prisma.siteConfig.findFirst({ where: { key: "min_order_ht" } });
  const minHT = minConfig ? parseFloat(minConfig.value) : 0;
  if (minHT > 0 && pricing.subtotalHT < minHT) {
    return NextResponse.json(
      { error: `Montant minimum de commande non atteint. Minimum requis : ${minHT.toFixed(2)} € HT.` },
      { status: 400 },
    );
  }

  if (pricing.totalTTCCents < 50) {
    return NextResponse.json({ error: "Le montant minimum est de 0,50 €." }, { status: 400 });
  }

  const shopName = await getCachedShopName();

  if (!(await isStripeConfigured())) {
    return NextResponse.json({ error: "Paiement indisponible. Stripe n'est pas configuré." }, { status: 503 });
  }

  let stripe;
  try {
    stripe = await getStripeInstance();
  } catch {
    return NextResponse.json({ error: "Stripe non configuré. Contactez l'administrateur." }, { status: 503 });
  }

  try {
    const statementDescriptor = buildStatementDescriptor(shopName);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: pricing.totalTTCCents,
      currency: "eur",
      payment_method_types: ["card"],
      metadata: {
        userId,
        addressId,
        carrierId,
        carrierName,
        carrierPrice: String(carrierPrice),
        tvaRate: String(pricing.tvaRate),
        promoCode: appliedCodePromo?.code ?? "",
      },
      receipt_email: user?.email ?? undefined,
      description: `${shopName} — ${user?.company ?? "Client"} (${user?.email ?? "?"}) — ${pricing.totalTTC.toFixed(2)} € TTC`,
      ...(statementDescriptor ? { statement_descriptor_suffix: statementDescriptor } : {}),
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      totalTTC: pricing.totalTTC,
      promoDiscount: pricing.promoCodeSaved,
    });
  } catch (err) {
    logger.error("[create-intent] Erreur création PI", { error: err });
    return NextResponse.json({ error: "Impossible de créer le paiement." }, { status: 500 });
  }
}

function userToPricing(u: {
  discountType:  "PERCENT" | "AMOUNT" | null;
  discountValue: unknown;
  discountMode?: "PERMANENT" | "THRESHOLD" | "NEXT_ORDER" | null;
  discountMinAmount: unknown;
  discountMinQuantity: number | null;
  vatExempt: boolean;
  freeShipping: boolean;
  freeShippingMaxPrice: unknown;
  shippingDiscountType:  "PERCENT" | "AMOUNT" | null;
  shippingDiscountValue: unknown;
  shippingDiscountMode?: "PERMANENT" | "THRESHOLD" | "NEXT_ORDER" | null;
  shippingDiscountMinAmount: unknown;
  shippingDiscountMinQuantity: number | null;
} | null) {
  return {
    discountType:  u?.discountType ?? null,
    discountValue: u?.discountValue != null ? Number(u.discountValue) : null,
    discountMode:  u?.discountMode ?? "PERMANENT",
    discountMinAmount:  u?.discountMinAmount != null ? Number(u.discountMinAmount) : null,
    discountMinQuantity: u?.discountMinQuantity ?? null,
    vatExempt:     u?.vatExempt ?? false,
    freeShipping:  u?.freeShipping ?? false,
    freeShippingMaxPrice: u?.freeShippingMaxPrice != null ? Number(u.freeShippingMaxPrice) : null,
    shippingDiscountType:  u?.shippingDiscountType ?? null,
    shippingDiscountValue: u?.shippingDiscountValue != null ? Number(u.shippingDiscountValue) : null,
    shippingDiscountMode:  u?.shippingDiscountMode ?? "PERMANENT",
    shippingDiscountMinAmount: u?.shippingDiscountMinAmount != null ? Number(u.shippingDiscountMinAmount) : null,
    shippingDiscountMinQuantity: u?.shippingDiscountMinQuantity ?? null,
  };
}
