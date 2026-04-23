"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Annuler une commande (CLIENT — statut PENDING uniquement)
// ─────────────────────────────────────────────

export async function cancelOrder(orderId: string): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Non authentifié.");

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: session.user.id },
  });
  if (!order) throw new Error("Commande introuvable.");
  if (order.status !== "PENDING") throw new Error("Cette commande ne peut plus être annulée.");

  await prisma.order.update({
    where: { id: orderId },
    data:  { status: "CANCELLED" },
  });

  revalidatePath("/commandes");
  revalidatePath(`/commandes/${orderId}`);
}
import { generateOrderPDF, type OrderItemPDF } from "@/lib/pdf-order";
import { createEasyExpressShipment, fetchEasyExpressLabel } from "@/lib/easy-express";
import { getStripeInstance, getConnectedAccountId } from "@/lib/stripe";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PlaceOrderInput {
  addressId:     string;
  carrierId:     string;   // base64 carrierId Easy-Express (ou "fallback_*")
  transactionId: string;   // transactionId retourné par /api/carriers
  carrierName:   string;
  carrierPrice:  number;
  tvaRate:       number;
  stripePaymentIntentId: string; // pi_xxx retourné par Stripe
  cgvAcceptedAt?: string; // ISO date when client accepted CGV
}

export interface PlaceOrderResult {
  success:     true;
  orderId:     string;
  orderNumber: string;
}

export interface PlaceOrderError {
  success: false;
  error:   string;
}

// ─────────────────────────────────────────────
// Génération numéro de commande
// ─────────────────────────────────────────────

async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.order.count({
    where: { orderNumber: { startsWith: `BJ-${year}-` } },
  });
  const seq = String(count + 1).padStart(6, "0");
  return `BJ-${year}-${seq}`;
}

// ─────────────────────────────────────────────
// Action principale
// ─────────────────────────────────────────────

export async function placeOrder(
  input: PlaceOrderInput
): Promise<PlaceOrderResult | PlaceOrderError> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non authentifié." };

  const userId = session.user.id;

  // ── 1. Récupérer toutes les données nécessaires ──────────────────────────

  const [user, cart, address] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true, lastName: true, company: true,
        email: true, phone: true, siret: true, vatNumber: true,
        discountType: true, discountValue: true, discountMode: true, discountMinAmount: true, discountMinQuantity: true,
        freeShipping: true, shippingDiscountType: true, shippingDiscountValue: true,
      },
    }),
    prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: { select: { id: true, name: true, reference: true, status: true, discountPercent: true, category: { select: { name: true } } } },
                color:   { select: { id: true, name: true, hex: true } },
                subColors: { orderBy: { position: "asc" }, select: { color: { select: { name: true } } } },
                variantSizes: { include: { size: true } },
              },
            },
          },
        },
      },
    }),
    prisma.shippingAddress.findFirst({ where: { id: input.addressId, userId } }),
  ]);

  if (!user)    return { success: false, error: "Utilisateur introuvable." };
  if (!cart || cart.items.length === 0) return { success: false, error: "Panier vide." };
  if (!address) return { success: false, error: "Adresse de livraison introuvable." };

  // ── Fetch images for each cart item via ProductColorImage ─────────────────
  const pairs = [
    ...new Map(
      cart.items
        .filter((item) => item.variant.colorId != null)
        .map((item) => [
          `${item.variant.productId}__${item.variant.colorId}`,
          { productId: item.variant.productId, colorId: item.variant.colorId! },
        ])
    ).values(),
  ];

  const allImages = pairs.length > 0 ? await prisma.productColorImage.findMany({
    where: {
      OR: pairs.map((p) => ({ productId: p.productId, colorId: p.colorId })),
    },
    orderBy: { order: "asc" },
  }) : [];

  const imagesByKey = new Map<string, string>();
  for (const img of allImages) {
    const key = `${img.productId}__${img.colorId}`;
    if (!imagesByKey.has(key)) imagesByKey.set(key, img.path);
  }

  // ── Vérifier le paiement Stripe côté serveur ───────────────────────────────
  let paymentIntent;
  try {
    const stripe = await getStripeInstance();
    const connectAccountId = await getConnectedAccountId();
    const connectOpts = connectAccountId ? { stripeAccount: connectAccountId } : undefined;
    paymentIntent = await stripe.paymentIntents.retrieve(input.stripePaymentIntentId, connectOpts);
  } catch (err) {
    logger.error("[placeOrder] Erreur retrieve PI", { error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "Payment Intent introuvable." };
  }
  // Carte uniquement — le paiement doit être confirmé
  if (paymentIntent.status !== "succeeded") {
    logger.error(`[placeOrder] Statut refusé: ${paymentIntent.status}`);
    return { success: false, error: `Le paiement n'a pas été confirmé (statut: ${paymentIntent.status}). Veuillez réessayer.` };
  }

  const cartItems = cart.items;

  // ── 2. Calculs ─────────────────────────────────────────────────────────

  function computeUnitPrice(variant: (typeof cartItems)[0]["variant"]): number {
    const price = Number(variant.unitPrice);
    const base = variant.saleType === "UNIT"
      ? price
      : price * (variant.packQuantity ?? 1);
    const discountPercent = variant.product.discountPercent != null ? Number(variant.product.discountPercent) : null;
    if (!discountPercent || discountPercent <= 0) return base;
    return Math.max(0, base * (1 - discountPercent / 100));
  }

  const subtotalHT = cart.items.reduce(
    (s, item) => s + computeUnitPrice(item.variant) * item.quantity, 0
  );

  // Remise commerciale client
  const clientDiscountType  = user.discountType  ?? null;
  const clientDiscountValue = user.discountValue != null ? Number(user.discountValue) : null;
  const clientDiscountMode  = user.discountMode ?? "PERMANENT";
  const clientFreeShipping  = user.freeShipping;

  const totalItemQuantity = cart.items.reduce((s, item) => s + item.quantity, 0);

  // Check if discount applies based on mode
  const discountApplies = (() => {
    if (!clientDiscountType || !clientDiscountValue) return false;
    if (clientDiscountMode === "THRESHOLD") {
      const minAmount = user.discountMinAmount != null ? Number(user.discountMinAmount) : 0;
      const minQty = user.discountMinQuantity ?? 0;
      const amountOk = minAmount <= 0 || subtotalHT >= minAmount;
      const qtyOk = minQty <= 0 || totalItemQuantity >= minQty;
      // Both conditions must be met (if set)
      return amountOk && qtyOk;
    }
    return true; // PERMANENT and NEXT_ORDER always apply
  })();

  const clientDiscountAmt = (() => {
    if (!discountApplies || !clientDiscountType || !clientDiscountValue) return 0;
    if (clientDiscountType === "PERCENT")
      return Math.min(subtotalHT, subtotalHT * (clientDiscountValue / 100));
    return Math.min(subtotalHT, clientDiscountValue);
  })();
  const subtotalAfterDiscount = subtotalHT - clientDiscountAmt;

  // Vérification minimum commande (sur le sous-total avant remise, remise = avantage commercial)
  const minConfig = await prisma.siteConfig.findUnique({ where: { key: "min_order_ht" } });
  const minHT = minConfig ? parseFloat(minConfig.value) : 0;
  if (minHT > 0 && subtotalHT < minHT) {
    return { success: false, error: `Montant minimum de commande non atteint. Minimum requis : ${minHT.toFixed(2)} € HT.` };
  }

  // Remise livraison : shipping discount (% ou montant), freeShipping = legacy fallback
  const effectiveCarrierPrice = (() => {
    if (clientFreeShipping) return 0;
    if (user.shippingDiscountType && user.shippingDiscountValue != null) {
      const sdv = Number(user.shippingDiscountValue);
      if (user.shippingDiscountType === "PERCENT") {
        return Math.max(0, input.carrierPrice * (1 - sdv / 100));
      }
      return Math.max(0, input.carrierPrice - sdv);
    }
    return input.carrierPrice;
  })();

  const tvaAmount = subtotalAfterDiscount * input.tvaRate;
  const totalTTC  = subtotalAfterDiscount + tvaAmount + effectiveCarrierPrice;

  const totalWeightKg = cart.items.reduce((s, item) => {
    const units = item.variant.saleType === "PACK"
      ? (item.variant.packQuantity ?? 1) * item.quantity
      : item.quantity;
    return s + item.variant.weight * units;
  }, 0);

  // ── 3. Créer la commande en base ─────────────────────────────────────────

  const orderNumber = await generateOrderNumber();

  const orderItems: OrderItemPDF[] = cart.items.map((item) => {
    const unitPrice = computeUnitPrice(item.variant);
    const imgKey = `${item.variant.productId}__${item.variant.colorId}`;

    // Build variant snapshot for legal traceability (survives variant deletion)
    const variantSnapshot = JSON.stringify({
      productColorId: item.variant.id,
      productName: item.variant.product.name,
      productRef: item.variant.product.reference,
      categoryName: item.variant.product.category?.name ?? null,
      colorName: item.variant.color?.name ?? null,
      colorHex: item.variant.color?.hex ?? null,
      subColors: item.variant.subColors?.map((sc: { color: { name: string } }) => sc.color.name) ?? [],
      saleType: item.variant.saleType,
      packQuantity: item.variant.packQuantity,
      weight: item.variant.weight,
      unitPriceOriginal: Number(item.variant.unitPrice),
      discountPercent: item.variant.product.discountPercent != null ? Number(item.variant.product.discountPercent) : null,
      sizes: item.variant.variantSizes.map((vs: { size: { name: string }; quantity: number }) => ({
        name: vs.size.name,
        quantity: vs.quantity,
      })),
    });

    return {
      productName:  item.variant.product.name,
      productRef:   item.variant.product.reference,
      categoryName: item.variant.product.category?.name ?? null,
      colorName:    item.variant.color
        ? (item.variant.subColors?.length
            ? [item.variant.color.name, ...item.variant.subColors.map((sc: { color: { name: string } }) => sc.color.name)].join("/")
            : item.variant.color.name)
        : "Pack",
      saleType:    item.variant.saleType,
      packQty:     item.variant.packQuantity,
      size:        null,
      sizesJson:   item.variant.variantSizes.length > 0
        ? JSON.stringify(item.variant.variantSizes.map((vs: { size: { name: string }; quantity: number }) => ({ name: vs.size.name, quantity: vs.quantity })))
        : null,
      packDetails: null,
      imagePath:   imagesByKey.get(imgKey) ?? null,
      unitPrice,
      quantity:    item.quantity,
      lineTotal:   unitPrice * item.quantity,
      variantSnapshot,
    };
  });

  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId,
      status:       "PENDING",
      // Stripe
      stripePaymentIntentId: input.stripePaymentIntentId,
      paymentStatus:         "paid",
      // Livraison
      shipLabel:    address.label,
      shipFirstName: address.firstName,
      shipLastName:  address.lastName,
      shipCompany:   address.company ?? null,
      shipAddress1:  address.address1,
      shipAddress2:  address.address2 ?? null,
      shipZipCode:   address.zipCode,
      shipCity:      address.city,
      shipCountry:   address.country,
      // Client
      clientCompany:   user.company,
      clientEmail:     user.email,
      clientPhone:     user.phone,
      clientSiret:     user.siret,
      clientVatNumber: user.vatNumber ?? null,
      // Transporteur
      carrierId:    input.carrierId,
      carrierName:  input.carrierName,
      carrierPrice: effectiveCarrierPrice,
      // Remise commerciale client
      clientDiscountType:  clientDiscountType,
      clientDiscountValue: clientDiscountValue,
      clientDiscountAmt,
      clientFreeShipping,
      // CGV
      cgvAcceptedAt: input.cgvAcceptedAt ? new Date(input.cgvAcceptedAt) : null,
      // TVA
      tvaRate:    input.tvaRate,
      subtotalHT: subtotalAfterDiscount,
      tvaAmount,
      totalTTC,
      // Items
      items: {
        create: orderItems.map((item) => ({
          productName: item.productName,
          productRef:  item.productRef,
          colorName:   item.colorName,
          saleType:    item.saleType,
          packQty:     item.packQty ?? null,
          size:        null,
          sizesJson:   item.sizesJson ?? null,
          packDetails: item.packDetails ?? null,
          imagePath:   item.imagePath ?? null,
          unitPrice:   item.unitPrice,
          quantity:    item.quantity,
          lineTotal:   item.lineTotal,
          variantSnapshot: item.variantSnapshot ?? null,
        })),
      },
    },
  });

  // ── 4-6. Easy-Express + PDF + Email ────────────────────────────────────

  let labelBuffer: Buffer | null = null;

  // Ne pas appeler Easy-Express si on est sur un carrier fallback ou retrait en boutique
  const isFallbackCarrier = input.carrierId.startsWith("fallback_") || input.carrierId === "pickup_store";

  const eeResult = isFallbackCarrier
    ? { success: false as const, error: "Carrier fallback — pas d'expédition Easy-Express." }
    : await createEasyExpressShipment({
        transactionId: input.transactionId,
        carrierId:     input.carrierId,
        orderNumber,
        weightKg:      totalWeightKg,
        toFirstName:   address.firstName,
        toLastName:    address.lastName,
        toCompany:     address.company ?? null,
        toEmail:       user.email,
        toAddress1:    address.address1,
        toAddress2:    address.address2 ?? null,
        toZipCode:     address.zipCode,
        toCity:        address.city,
        toCountry:     address.country,
        toPhone:       address.phone ?? null,
      });

  if (eeResult.success) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        eeTrackingId: eeResult.trackingId,
        eeLabelUrl:   eeResult.labelUrl,
      },
    });

    if (eeResult.labelUrl) {
      labelBuffer = await fetchEasyExpressLabel(eeResult.labelUrl);
    }
  } else {
    logger.warn("[placeOrder] Easy-Express", { error: eeResult.error });
  }

  // ── PDF ─────────────────────────────────────
  let pdfBuffer: Buffer | null = null;
  try {
    pdfBuffer = await generateOrderPDF({
      orderNumber,
      createdAt:       order.createdAt,
      clientCompany:   user.company,
      clientFirstName: user.firstName,
      clientLastName:  user.lastName,
      clientEmail:     user.email,
      clientPhone:     user.phone,
      clientSiret:     user.siret,
      clientVatNumber: user.vatNumber ?? null,
      shipLabel:       address.label,
      shipFirstName:   address.firstName,
      shipLastName:    address.lastName,
      shipCompany:     address.company ?? null,
      shipAddress1:    address.address1,
      shipAddress2:    address.address2 ?? null,
      shipZipCode:     address.zipCode,
      shipCity:        address.city,
      shipCountry:     address.country,
      carrierName:     input.carrierName,
      carrierPrice:    input.carrierPrice,
      clientDiscountAmt: Number(clientDiscountAmt),
      promoCode:       order.promoCode ?? null,
      promoDiscount:   Number(order.promoDiscount ?? 0),
      creditApplied:   Number(order.creditApplied ?? 0),
      tvaRate:         input.tvaRate,
      subtotalHT,
      tvaAmount,
      totalTTC,
      items:           orderItems,
    });
  } catch (err) {
    logger.error("[placeOrder] PDF error", { error: err instanceof Error ? err.message : String(err) });
  }

  // ── Email admin ─────────────────────────────
  // Notification admin désactivée — remplacée par le digest horaire
  // (GET /api/cron/order-digest, 8h–19h)

  // ── 7. Auto-suppression remise NEXT_ORDER ──────────────────────────────

  if (clientDiscountMode === "NEXT_ORDER" && discountApplies) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        discountType: null,
        discountValue: null,
        discountMode: null,
        discountMinAmount: null,
        discountNextOrderUsed: true,
        freeShipping: false,
      },
    });
  }

  // ── 8. Vider le panier ────────────────────────────────────────────────────

  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

  revalidatePath("/panier");
  revalidatePath("/admin/commandes");

  return { success: true, orderId: order.id, orderNumber };
}

// ─────────────────────────────────────────────
// Email notification admin
// ─────────────────────────────────────────────

