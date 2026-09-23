"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { stockUnitsForCartLine } from "@/lib/stock-units";
import { rateLimit } from "@/lib/rate-limit";
import {
  loadActivePromotions,
  validatePromoCode,
  recordPromoUsage,
  type AppliedCodePromo,
} from "@/lib/promotions";
import { buildCartPromoContexts } from "@/lib/promotion-cart-context";
import { computeOrderPricing } from "@/lib/order-pricing";
import { getAvailableCredit, applyCreditsToOrder } from "@/lib/credits";
import { clampCreditToApply } from "@/lib/credit-clamp";
import { getEffectiveMinOrderHT } from "@/lib/min-order";
import { cancelAbandonedCartJob } from "@/lib/abandoned-cart-trigger";
import { getCurrentTenantId, getCurrentTenantSlug } from "@/lib/tenant";
import { findMissingAddressFields } from "@/lib/shipping-address-validate";
import { copyOrderItemImageToOrderDir } from "@/lib/order-item-image-copy";
import { reinstateStockForOrder } from "@/lib/stock";
import { getCachedShopName } from "@/lib/cached-data";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import {
  buildStatementDescriptor,
  getStripeInstance,
  isStripeConfigured,
} from "@/lib/stripe";
import {
  notifyAdminNewOrder,
  notifyClientPaymentLink,
} from "@/lib/notifications";
import {
  buildFallbackAddressFromUser,
  isFallbackAddressAllowed,
  type OrderAddressLike,
} from "@/lib/order-address-fallback";
import type { OrderItemPDF } from "@/lib/pdf-order";
import { verifyCarrierSignature } from "@/lib/carrier-signature";

/** Durée de vie d'un lien Stripe Checkout Session (24h max côté Stripe). */
const CHECKOUT_SESSION_TTL_SECONDS = 24 * 60 * 60;

class StockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockError";
  }
}

export interface PaymentLinkOrderInput {
  addressId?: string;
  deliveryMode?: "delivery" | "pickup" | "private" | "merge";
  carrierId: string;
  transactionId: string;
  carrierSig: string;
  carrierName: string;
  carrierPrice: number;
  cgvAcceptedAt?: string;
  acceptReplacementContact?: boolean;
  privateCarrierEmail?: string;
  privateCarrierPhone?: string;
  privateCarrierBordereau?: string;
  mergeIntoOrderId?: string;
  promoCode?: string;
  /** Locale du client au checkout — sert au success_url + à `locale` Stripe. */
  locale?: "fr" | "en";
  /** Avoir à consommer (clampé serveur). */
  creditToApply?: number;
}

export interface PaymentLinkOrderResult {
  success: true;
  orderId: string;
  orderNumber: string;
  checkoutUrl: string;
}

export interface PaymentLinkOrderError {
  success: false;
  error: string;
}

async function generateOrderNumber(): Promise<string> {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const generate = () => {
    let id = "";
    for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  };
  let orderNumber: string;
  let exists = true;
  do {
    orderNumber = generate();
    const found = await prisma.order.findFirst({
      where: { orderNumber },
      select: { id: true },
    });
    exists = !!found;
  } while (exists);
  return orderNumber;
}

/**
 * Crée une commande + un lien Stripe Checkout Session — c'est le fallback
 * utilisé quand l'iframe Stripe embarquée est bloquée côté navigateur (antivirus,
 * extension anti-pub, VPN d'entreprise). Le flow est calqué sur `placeBankTransferOrder` :
 *
 *  - Commande créée immédiatement en `PENDING` / `paymentStatus="pending"`.
 *  - Stock déduit à la création, panier vidé.
 *  - Stripe Checkout Session hébergée sur `checkout.stripe.com` (hors iframe,
 *    beaucoup moins souvent bloquée). URL + expiration stockées sur la commande.
 *  - Email au client avec le lien cliquable (comparable à l'email IBAN du virement).
 *  - Au retour paid, le webhook `payment_intent.succeeded` marque la commande
 *    `paymentStatus="paid"` via `stripePaymentIntentId` (mécanique existante).
 *
 * Si la création Stripe échoue APRÈS la commande, on remet le stock et on
 * supprime la commande (rollback) pour éviter les commandes fantômes sans lien.
 */
export async function placePaymentLinkOrder(
  input: PaymentLinkOrderInput,
): Promise<PaymentLinkOrderResult | PaymentLinkOrderError> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non authentifié." };

  const userId = session.user.id;
  const locale = input.locale === "en" ? "en" : "fr";

  const rl = rateLimit(`place-payment-link:${userId}`, 5, 60_000);
  if (!rl.success) {
    return {
      success: false,
      error: "Trop de tentatives de commande. Merci de patienter une minute et de réessayer.",
    };
  }

  if (!(await isStripeConfigured())) {
    return {
      success: false,
      error: "Paiement indisponible. Contactez la boutique.",
    };
  }

  // Vérif signature transporteur (mêmes règles que create-intent) — la
  // signature valide (carrierId, carrierPrice, transactionId) prouve que le
  // prix affiché a bien été calculé par notre serveur.
  const sigOk = verifyCarrierSignature({
    carrierId: input.carrierId,
    carrierPrice: input.carrierPrice,
    transactionId: input.transactionId ?? "",
    carrierSig: input.carrierSig ?? "",
  });
  if (!sigOk) {
    logger.warn("[placePaymentLinkOrder] Signature transporteur invalide", {
      carrierId: input.carrierId,
      hasSig: !!input.carrierSig,
    });
    return {
      success: false,
      error: "Le transporteur ou son tarif ne peuvent pas être vérifiés. Rechargez la page.",
    };
  }

  const [user, cart, shippingAddress] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        firstName: true, lastName: true, company: true,
        email: true, phone: true, siret: true, vatNumber: true,
        vatExempt: true,
        addressStreet: true, addressComplement: true, addressZip: true,
        addressCity: true, addressCountry: true,
        discountType: true, discountValue: true, discountMode: true, discountMinAmount: true, discountMinQuantity: true,
        freeShipping: true, freeShippingMaxPrice: true,
        shippingDiscountType: true, shippingDiscountValue: true, shippingDiscountMode: true,
        shippingDiscountMinAmount: true, shippingDiscountMinQuantity: true,
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
                variantSizes: { include: { size: true } },
                packLines: {
                  orderBy: { position: "asc" },
                  include: {
                    color: { select: { name: true, hex: true } },
                    sizes: { include: { size: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    input.addressId
      ? prisma.shippingAddress.findFirst({ where: { id: input.addressId, userId } })
      : Promise.resolve(null),
  ]);

  if (!user) return { success: false, error: "Votre compte est introuvable." };
  if (user.status !== "APPROVED") {
    return { success: false, error: "Votre compte n'est plus approuvé pour passer commande." };
  }
  if (!cart || cart.items.length === 0) return { success: false, error: "Votre panier est vide." };

  let address: OrderAddressLike | null = shippingAddress;
  if (!address && isFallbackAddressAllowed(input.deliveryMode)) {
    address = buildFallbackAddressFromUser(user);
  }
  if (!address) return { success: false, error: "Adresse de livraison introuvable." };

  const missingAddressFields = findMissingAddressFields(address);
  if (missingAddressFields.length > 0) {
    return {
      success: false,
      error: `Adresse de livraison incomplète (${missingAddressFields.join(", ")}). Modifiez votre adresse dans le panier avant de repasser commande.`,
    };
  }

  const offlineItem = cart.items.find((item) => item.variant.product.status !== "ONLINE");
  if (offlineItem) {
    return {
      success: false,
      error: `Le produit « ${offlineItem.variant.product.name} » n'est plus disponible à la vente.`,
    };
  }

  const shortStock = cart.items.find((i) => i.variant.stock < stockUnitsForCartLine(i));
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
    return {
      success: false,
      error: `Stock insuffisant pour « ${shortStock.variant.product.name} » : il en reste ${remaining}${unit ? ` ${unit}` : ""}, vous en demandez ${shortStock.quantity}.`,
    };
  }

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
    where: { OR: pairs.map((p) => ({ productId: p.productId, colorId: p.colorId })) },
    orderBy: { order: "asc" },
  }) : [];
  const imagesByKey = new Map<string, string>();
  for (const img of allImages) {
    const key = `${img.productId}__${img.colorId}`;
    if (!imagesByKey.has(key)) imagesByKey.set(key, img.path);
  }

  const [activePromos, promoContexts] = await Promise.all([
    loadActivePromotions(),
    buildCartPromoContexts(cart.items),
  ]);

  const pricingItems = cart.items
    .map((i) => {
      const c = promoContexts.get(i.id);
      if (!c) return null;
      return { id: i.id, quantity: i.quantity, promoContext: c.context };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const userPricingInput = {
    discountType:  user.discountType  ?? null,
    discountValue: user.discountValue != null ? Number(user.discountValue) : null,
    discountMode:  user.discountMode ?? "PERMANENT",
    discountMinAmount: user.discountMinAmount != null ? Number(user.discountMinAmount) : null,
    discountMinQuantity: user.discountMinQuantity ?? null,
    vatExempt: user.vatExempt,
    freeShipping: user.freeShipping,
    freeShippingMaxPrice: user.freeShippingMaxPrice != null ? Number(user.freeShippingMaxPrice) : null,
    shippingDiscountType: user.shippingDiscountType ?? null,
    shippingDiscountValue: user.shippingDiscountValue != null ? Number(user.shippingDiscountValue) : null,
    shippingDiscountMode: user.shippingDiscountMode ?? "PERMANENT",
    shippingDiscountMinAmount: user.shippingDiscountMinAmount != null ? Number(user.shippingDiscountMinAmount) : null,
    shippingDiscountMinQuantity: user.shippingDiscountMinQuantity ?? null,
  };

  let appliedCode: AppliedCodePromo | null = null;
  if (input.promoCode && input.promoCode.trim()) {
    const preCodePricing = computeOrderPricing({
      items: pricingItems,
      carrierId: input.carrierId,
      carrierPrice: input.carrierPrice,
      addressCountry: address.country,
      user: userPricingInput,
      activePromos,
      appliedCodePromo: null,
    });
    const contextItems = pricingItems.map((i) => ({ ...i.promoContext, quantity: i.quantity }));
    const check = await validatePromoCode(
      input.promoCode.trim(),
      {
        items: contextItems,
        subtotalHT: preCodePricing.subtotalHT,
        carrierPrice: input.carrierPrice,
        userId,
        userShipping: { isFree: user.freeShipping, discountType: null, discountValue: null },
      },
      activePromos,
    );
    if (!check.valid) return { success: false, error: check.error ?? "Code promo invalide." };
    appliedCode = check.result;
  }

  const appliedCodePromo = appliedCode
    ? activePromos.find((p) => p.id === appliedCode!.promotionId) ?? null
    : null;

  const pricing = computeOrderPricing({
    items: pricingItems,
    carrierId: input.carrierId,
    carrierPrice: input.carrierPrice,
    addressCountry: address.country,
    user: userPricingInput,
    activePromos,
    appliedCodePromo,
  });

  const {
    itemFinalPrices: itemPriceResolutions,
    subtotalBrutHT,
    subtotalHT,
    clientDiscountAmt,
    subtotalAfterDiscount,
    effectiveCarrierPrice,
    shippingSaved,
    shippingPromotionId,
    shippingTrace: pricingShippingTrace,
    tvaRate,
    tvaAmount,
    totalTTC,
    totalTTCCents,
    promoAutoDiscount,
  } = pricing;

  const shipPromoDiscount = pricingShippingTrace.filter((l) => l.kind !== "client").reduce((s, l) => s + l.amount, 0);
  const shipClientDiscount = pricingShippingTrace.filter((l) => l.kind === "client").reduce((s, l) => s + l.amount, 0);

  function resolveItemFinalPrice(itemId: string): number {
    return itemPriceResolutions.get(itemId)?.finalUnitPrice ?? 0;
  }

  const appliedPromotionsSnapshot = (() => {
    const map = new Map<string, {
      id: string;
      name: string;
      kind: "AUTO" | "CODE";
      scope: string;
      discountKind: string;
      discountValue: number;
      amountSaved: number;
    }>();
    for (const [itemId, res] of itemPriceResolutions) {
      if (!res.promotionId || res.source === "product") continue;
      const item = pricingItems.find((i) => i.id === itemId);
      const qty = item?.quantity ?? 0;
      const savedTotal = res.savedPerUnit * qty;
      const promo = activePromos.find((p) => p.id === res.promotionId);
      if (!promo) continue;
      const existing = map.get(promo.id);
      if (existing) {
        existing.amountSaved += savedTotal;
      } else {
        map.set(promo.id, {
          id: promo.id,
          name: promo.name,
          kind: appliedCode?.promotionId === promo.id ? "CODE" : "AUTO",
          scope: promo.scope,
          discountKind: promo.discountKind,
          discountValue: promo.discountValue,
          amountSaved: savedTotal,
        });
      }
    }
    if (appliedCode && !map.has(appliedCode.promotionId)) {
      const promo = activePromos.find((p) => p.id === appliedCode!.promotionId);
      if (promo) {
        map.set(promo.id, {
          id: promo.id,
          name: promo.name,
          kind: "CODE",
          scope: promo.scope,
          discountKind: promo.discountKind,
          discountValue: promo.discountValue,
          amountSaved: appliedCode.totalSaved,
        });
      }
    }
    return Array.from(map.values()).map((p) => ({
      ...p,
      amountSaved: Math.floor(p.amountSaved * 100) / 100,
    }));
  })();

  const clientDiscountType  = userPricingInput.discountType;
  const clientDiscountValue = userPricingInput.discountValue;
  const clientDiscountMode  = userPricingInput.discountMode;
  const clientFreeShipping  = userPricingInput.freeShipping;
  const discountApplies = clientDiscountAmt > 0;

  const shippingDiscountMode = userPricingInput.shippingDiscountMode;
  const shippingDiscountApplies = (() => {
    if (!userPricingInput.shippingDiscountType || userPricingInput.shippingDiscountValue == null) return false;
    if (shippingDiscountMode === "THRESHOLD") {
      const minAmount = userPricingInput.shippingDiscountMinAmount ?? 0;
      const minQty = userPricingInput.shippingDiscountMinQuantity ?? 0;
      const totalQty = cart.items.reduce((s, i) => s + i.quantity, 0);
      const amountOk = minAmount <= 0 || subtotalHT >= minAmount;
      const qtyOk = minQty <= 0 || totalQty >= minQty;
      return amountOk && qtyOk;
    }
    return true;
  })();

  const isMergeIntoExistingOrder = !!input.mergeIntoOrderId?.trim();
  const minHT = await getEffectiveMinOrderHT(userId);
  if (!isMergeIntoExistingOrder && minHT > 0 && subtotalHT < minHT) {
    return {
      success: false,
      error: `Montant minimum de commande non atteint. Minimum requis : ${minHT.toFixed(2)} € HT.`,
    };
  }

  // Crédit / avoir : clamp serveur (min(solde, TTC, montant demandé)).
  // Si le crédit couvre 100%, on refuse ici — la cliente doit passer par
  // placeCreditOnlyOrder qui skip la génération du lien Stripe.
  const availableCredit = await getAvailableCredit(userId);
  const { creditApplied, amountDue: amountDueTTC, amountDueCents } = clampCreditToApply({
    availableCredit,
    totalTTC,
    requested: Number(input.creditToApply ?? 0),
  });

  if (amountDueCents === 0 && creditApplied > 0) {
    return {
      success: false,
      error: "Votre avoir couvre la totalité — utilisez le bouton « Confirmer par avoir ».",
    };
  }

  if (amountDueCents < 50) {
    return { success: false, error: "Le montant minimum est de 0,50 €." };
  }

  const isPrivateCarrier = input.carrierId === "private_carrier";

  const orderItems: OrderItemPDF[] = cart.items.map((item) => {
    const unitPrice = resolveItemFinalPrice(item.id);
    const imgKey = `${item.variant.productId}__${item.variant.colorId}`;
    const isMultiPack = item.variant.saleType === "PACK" && item.variant.packLines.length > 0;

    const packDetailsJson = isMultiPack
      ? JSON.stringify(
          item.variant.packLines.map((line) => ({
            colorName: line.color?.name ?? "",
            colorHex: line.color?.hex ?? null,
            sizes: line.sizes.map((s) => ({ name: s.size.name, quantity: s.quantity })),
          })),
        )
      : null;

    const displayColorName = isMultiPack
      ? item.variant.packLines.map((l) => l.color?.name ?? "").filter(Boolean).join(" / ")
      : item.variant.color ? item.variant.color.name : "Pack";

    const aggregatedSizes = isMultiPack
      ? (() => {
          const map = new Map<string, { name: string; quantity: number }>();
          for (const line of item.variant.packLines) {
            for (const s of line.sizes) {
              const cur = map.get(s.sizeId);
              if (cur) cur.quantity += s.quantity;
              else map.set(s.sizeId, { name: s.size.name, quantity: s.quantity });
            }
          }
          return [...map.values()];
        })()
      : item.variant.variantSizes.map((vs) => ({ name: vs.size.name, quantity: vs.quantity }));

    const variantSnapshot = JSON.stringify({
      productColorId: item.variant.id,
      productName: item.variant.product.name,
      productRef: item.variant.product.reference,
      categoryName: item.variant.product.category?.name ?? null,
      colorName: displayColorName,
      colorHex: item.variant.color?.hex ?? null,
      saleType: item.variant.saleType,
      packQuantity: item.variant.packQuantity,
      weight: item.variant.weight,
      unitPriceOriginal: Number(item.variant.unitPrice),
      discountPercent: item.variant.product.discountPercent != null ? Number(item.variant.product.discountPercent) : null,
      sizes: aggregatedSizes,
      packLines: isMultiPack
        ? item.variant.packLines.map((line) => ({
            colorName: line.color?.name ?? "",
            sizes: line.sizes.map((s) => ({ name: s.size.name, quantity: s.quantity })),
          }))
        : null,
    });

    return {
      productName: item.variant.product.name,
      productRef: item.variant.product.reference,
      categoryName: item.variant.product.category?.name ?? null,
      colorName: displayColorName,
      saleType: item.variant.saleType,
      packQty: item.variant.packQuantity,
      size: null,
      sizesJson: aggregatedSizes.length > 0 ? JSON.stringify(aggregatedSizes) : null,
      packDetails: packDetailsJson,
      imagePath: imagesByKey.get(imgKey) ?? null,
      unitPrice,
      quantity: item.quantity,
      lineTotal: unitPrice * item.quantity,
      variantSnapshot,
    };
  });

  const orderNumber = await generateOrderNumber();

  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      for (const item of cart.items) {
        const stockUnits = stockUnitsForCartLine(item);
        const updated = await tx.productColor.updateMany({
          where: { id: item.variant.id, stock: { gte: stockUnits } },
          data: { stock: { decrement: stockUnits } },
        });
        if (updated.count === 0) {
          const current = await tx.productColor.findUnique({
            where: { id: item.variant.id },
            select: { stock: true },
          });
          const packQty = item.variant.packQuantity ?? 1;
          const remainingDisplay =
            item.variant.saleType === "PACK" && packQty > 1
              ? Math.floor((current?.stock ?? 0) / packQty)
              : (current?.stock ?? 0);
          const unitLabel =
            item.variant.saleType === "PACK" && packQty > 1
              ? `paquet${remainingDisplay > 1 ? "s" : ""}`
              : "";
          throw new StockError(
            `Stock insuffisant pour « ${item.variant.product.name} » : il en reste ${remainingDisplay}${unitLabel ? ` ${unitLabel}` : ""}, vous en demandez ${item.quantity}.`,
          );
        }
      }

      const created = await tx.order.create({
        data: {
          orderNumber,
          userId,
          status: "PENDING",
          paymentMode: "STRIPE_LINK",
          paymentStatus: "pending",
          shipLabel: address.label,
          shipFirstName: address.firstName,
          shipLastName: address.lastName,
          shipCompany: address.company ?? null,
          shipAddress1: address.address1,
          shipAddress2: address.address2 ?? null,
          shipZipCode: address.zipCode,
          shipCity: address.city,
          shipCountry: address.country,
          clientCompany: user.company,
          clientEmail: user.email,
          clientPhone: user.phone,
          clientSiret: user.siret ?? null,
          clientVatNumber: user.vatNumber ?? null,
          carrierId: input.carrierId,
          carrierName: input.carrierName,
          carrierPrice: effectiveCarrierPrice,
          carrierBasePrice: input.carrierPrice,
          carrierPromoDiscount: Math.floor(shipPromoDiscount * 100) / 100,
          carrierClientDiscount: Math.floor(shipClientDiscount * 100) / 100,
          privateCarrierEmail: isPrivateCarrier ? (input.privateCarrierEmail?.trim() || null) : null,
          privateCarrierPhone: isPrivateCarrier ? (input.privateCarrierPhone?.trim() || null) : null,
          privateCarrierBordereau: isPrivateCarrier ? (input.privateCarrierBordereau?.trim() || null) : null,
          mergeIntoOrderId: input.mergeIntoOrderId?.trim() || null,
          clientDiscountType,
          clientDiscountValue,
          clientDiscountAmt,
          clientFreeShipping,
          promoCode: appliedCode?.code ?? null,
          promoDiscount: appliedCode?.totalSaved ?? 0,
          creditApplied,
          cgvAcceptedAt: input.cgvAcceptedAt ? new Date(input.cgvAcceptedAt) : null,
          acceptReplacementContact: input.acceptReplacementContact ?? false,
          tvaRate,
          subtotalHT: subtotalAfterDiscount,
          subtotalBrutHT,
          promoAutoDiscount,
          appliedPromotions: appliedPromotionsSnapshot,
          paidSubtotalHT: subtotalAfterDiscount,
          tvaAmount,
          totalTTC,
          items: {
            create: orderItems.map((item) => ({
              productName: item.productName,
              productRef: item.productRef,
              colorName: item.colorName,
              saleType: item.saleType,
              packQty: item.packQty ?? null,
              size: null,
              sizesJson: item.sizesJson ?? null,
              packDetails: item.packDetails ?? null,
              imagePath: item.imagePath ?? null,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              lineTotal: item.lineTotal,
              variantSnapshot: item.variantSnapshot ?? null,
            })),
          },
        },
      });

      await tx.stockMovement.createMany({
        data: cart.items.map((item) => ({
          productColorId: item.variant.id,
          quantity: -stockUnitsForCartLine(item),
          type: "ORDER" as const,
          orderId: created.id,
          reason: `Commande ${orderNumber}`,
        })),
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return created;
    });
  } catch (err) {
    if (err instanceof StockError) {
      logger.warn("[placePaymentLinkOrder] Stock insuffisant", { message: err.message });
      return { success: false, error: err.message };
    }
    logger.error("[placePaymentLinkOrder] Transaction error", { error: err });
    return { success: false, error: "Impossible de finaliser la commande. Merci de réessayer." };
  }

  // Décrémenter les crédits consommés (best-effort).
  if (creditApplied > 0.005) {
    try {
      await applyCreditsToOrder(userId, order.id, creditApplied);
    } catch (err) {
      logger.error("[placePaymentLinkOrder] Décrémentation crédit échouée", {
        orderId: order.id,
        creditApplied,
        error: err as Error,
      });
    }
  }

  // ── Copie miniatures dans le dossier de la commande ─────────────────────
  try {
    const tenantSlug = await getCurrentTenantSlug();
    if (tenantSlug) {
      const createdItems = await prisma.orderItem.findMany({
        where: { orderId: order.id },
        select: { id: true, imagePath: true },
      });
      await Promise.all(
        createdItems.map(async (it) => {
          const newPath = await copyOrderItemImageToOrderDir({
            sourceDbPath: it.imagePath,
            orderNumber,
            orderItemId: it.id,
            tenantSlug,
          });
          if (newPath) {
            await prisma.orderItem.update({
              where: { id: it.id },
              data:  { imagePath: newPath },
            });
          }
        }),
      );
    }
  } catch (err) {
    logger.error("[placePaymentLinkOrder] copie miniatures échouée", {
      orderId: order.id,
      error: err as Error,
    });
  }

  // ── Création de la Stripe Checkout Session ───────────────────────────────
  const shopName = await getCachedShopName();
  const baseUrl = await getCurrentTenantBaseUrl();
  const statementDescriptor = buildStatementDescriptor(shopName);
  const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS;

  let checkoutSessionId: string;
  let checkoutUrl: string;
  let paymentIntentId: string | null = null;
  try {
    const stripe = await getStripeInstance();
    const successUrl = `${baseUrl}/${locale}/commandes/${order.id}?checkout_success=1`;
    const cancelUrl = `${baseUrl}/${locale}/commandes/${order.id}?checkout_canceled=1`;
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email,
      locale: locale === "en" ? "en" : "fr",
      expires_at: expiresAtUnix,
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: amountDueCents,
            product_data: {
              name: `${shopName} — Commande ${orderNumber}`,
              description: creditApplied > 0
                ? `Total TTC : ${totalTTC.toFixed(2)} € − avoir ${creditApplied.toFixed(2)} € = ${amountDueTTC.toFixed(2)} €`
                : `Total TTC : ${totalTTC.toFixed(2)} € (livraison incluse)`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        // orderId dans la metadata → le webhook peut retrouver la commande
        // même si l'ID de session Stripe change (regenerate).
        metadata: { orderId: order.id, orderNumber, userId },
        receipt_email: user.email,
        description: `${shopName} — Commande ${orderNumber}`,
        ...(statementDescriptor
          ? { statement_descriptor_suffix: statementDescriptor }
          : {}),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    if (!checkoutSession.url) {
      throw new Error("Session Stripe créée sans URL");
    }
    checkoutSessionId = checkoutSession.id;
    checkoutUrl = checkoutSession.url;
    paymentIntentId =
      typeof checkoutSession.payment_intent === "string"
        ? checkoutSession.payment_intent
        : checkoutSession.payment_intent?.id ?? null;
  } catch (stripeErr) {
    // Rollback : on efface la commande + on remet le stock — mieux vaut pas de
    // commande qu'une commande sans lien de paiement.
    logger.error("[placePaymentLinkOrder] Création Session Stripe échouée — rollback", {
      orderId: order.id,
      error: stripeErr,
    });
    try {
      await reinstateStockForOrder(order.id);
      await prisma.order.delete({ where: { id: order.id } });
    } catch (rollbackErr) {
      logger.error("[placePaymentLinkOrder] Rollback échoué — commande orpheline", {
        orderId: order.id,
        error: rollbackErr,
      });
    }
    return {
      success: false,
      error: "Impossible de générer le lien de paiement. Merci de réessayer dans quelques instants.",
    };
  }

  // ── Persister les infos Stripe sur la commande ──────────────────────────
  await prisma.order.update({
    where: { id: order.id },
    data: {
      stripeCheckoutSessionId: checkoutSessionId,
      stripeCheckoutSessionUrl: checkoutUrl,
      stripeCheckoutSessionExpiresAt: new Date(expiresAtUnix * 1000),
      stripePaymentIntentId: paymentIntentId,
    },
  });

  // ── Cancel abandoned cart + emails ──────────────────────────────────────
  try {
    const tenantId = await getCurrentTenantId();
    if (tenantId) await cancelAbandonedCartJob(userId, tenantId, "ORDER_CREATED");
  } catch (err) {
    logger.error("[placePaymentLinkOrder] cancel abandoned cart failed", {
      userId,
      error: err as Error,
    });
  }

  notifyAdminNewOrder({ orderId: order.id }).catch((err) =>
    logger.error("[placePaymentLinkOrder] Notif admin error", { error: err }),
  );
  notifyClientPaymentLink({
    email: user.email,
    firstName: user.firstName,
    amountTTC: totalTTC,
    url: checkoutUrl,
    expiresAt: new Date(expiresAtUnix * 1000),
    orderNumber,
  }).catch((err) =>
    logger.error("[placePaymentLinkOrder] Email lien de paiement error", { error: err }),
  );

  // Usages promotions
  const promoSavingsById = new Map<string, number>();
  for (const item of cart.items) {
    const res = itemPriceResolutions.get(item.id);
    if (!res || !res.promotionId) continue;
    const acc = promoSavingsById.get(res.promotionId) ?? 0;
    promoSavingsById.set(res.promotionId, acc + res.savedPerUnit * item.quantity);
  }
  if (shippingPromotionId) {
    const acc = promoSavingsById.get(shippingPromotionId) ?? 0;
    promoSavingsById.set(shippingPromotionId, acc + shippingSaved);
  }
  for (const [promoId, savedTotal] of promoSavingsById) {
    if (savedTotal <= 0) continue;
    await recordPromoUsage(promoId, userId, order.id, savedTotal).catch((err) =>
      logger.error("[placePaymentLinkOrder] recordPromoUsage error", { error: err, promoId }),
    );
  }
  if (promoSavingsById.size > 0) revalidateTag("promotions", "default");

  if (clientDiscountMode === "NEXT_ORDER" && discountApplies) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        discountType: null,
        discountValue: null,
        discountMode: null,
        discountMinAmount: null,
        discountMinQuantity: null,
        discountNextOrderUsed: true,
      },
    });
  }
  if (shippingDiscountMode === "NEXT_ORDER" && shippingDiscountApplies) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        shippingDiscountType: null,
        shippingDiscountValue: null,
        shippingDiscountMode: null,
        shippingDiscountMinAmount: null,
        shippingDiscountMinQuantity: null,
        shippingDiscountNextOrderUsed: true,
        freeShipping: false,
      },
    });
  }

  revalidatePath("/panier");
  revalidatePath("/admin/commandes");
  revalidatePath(`/commandes/${order.id}`);

  return {
    success: true,
    orderId: order.id,
    orderNumber,
    checkoutUrl,
  };
}

/**
 * Vérifie l'état de paiement d'une commande STRIPE_LINK auprès de Stripe et
 * met à jour `paymentStatus` en base si le paiement est encaissé. Utile en
 * filet de sécurité quand le webhook `payment_intent.succeeded` n'a pas
 * atteint le serveur (dev local sans Stripe CLI, panne réseau, retry Stripe
 * en cours…). Idempotent — appelable à chaque rendu de la fiche commande.
 * Renvoie true si la commande vient de passer en "paid".
 */
export async function syncStripeCheckoutSessionStatus(
  orderId: string,
): Promise<boolean> {
  try {
    const order = await prisma.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        paymentMode: true,
        paymentStatus: true,
        stripeCheckoutSessionId: true,
      },
    });
    if (!order) return false;
    if (order.paymentMode !== "STRIPE_LINK") return false;
    if (order.paymentStatus === "paid") return false;
    if (!order.stripeCheckoutSessionId) return false;

    const stripe = await getStripeInstance();
    const cs = await stripe.checkout.sessions.retrieve(
      order.stripeCheckoutSessionId,
    );
    if (cs.payment_status === "paid") {
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: "paid" },
      });
      logger.info("[syncStripeCheckoutSessionStatus] Commande marquée payée", {
        orderId: order.id,
        sessionId: cs.id,
      });
      return true;
    }
    return false;
  } catch (err) {
    logger.warn("[syncStripeCheckoutSessionStatus] échec — retentera au prochain refresh", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Régénère une Stripe Checkout Session pour une commande en attente de
 * paiement. Utile quand le client n'a pas payé dans les 24h et que le lien
 * initial a expiré côté Stripe. Retourne la nouvelle URL et met à jour les
 * champs sur la commande. Refuse si la commande est déjà payée ou si le
 * caller n'est pas le propriétaire.
 */
export async function regeneratePaymentLink(
  orderId: string,
): Promise<
  | { success: true; url: string; expiresAt: string }
  | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non authentifié." };

  const rl = rateLimit(`regenerate-link:${session.user.id}`, 5, 60_000);
  if (!rl.success) {
    return {
      success: false,
      error: "Trop de tentatives. Réessayez dans une minute.",
    };
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: session.user.id },
    select: {
      id: true,
      orderNumber: true,
      totalTTC: true,
      paymentMode: true,
      paymentStatus: true,
      clientEmail: true,
    },
  });
  if (!order) return { success: false, error: "Commande introuvable." };
  if (order.paymentMode !== "STRIPE_LINK") {
    return {
      success: false,
      error: "Cette commande ne se règle pas par lien de paiement.",
    };
  }
  if (order.paymentStatus === "paid") {
    return { success: false, error: "Cette commande est déjà réglée." };
  }

  if (!(await isStripeConfigured())) {
    return {
      success: false,
      error: "Paiement indisponible. Contactez la boutique.",
    };
  }

  const shopName = await getCachedShopName();
  const baseUrl = await getCurrentTenantBaseUrl();
  const statementDescriptor = buildStatementDescriptor(shopName);
  const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS;
  const amountCents = Math.round(Number(order.totalTTC) * 100);

  try {
    const stripe = await getStripeInstance();
    const successUrl = `${baseUrl}/fr/commandes/${order.id}?checkout_success=1`;
    const cancelUrl = `${baseUrl}/fr/commandes/${order.id}?checkout_canceled=1`;
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: order.clientEmail,
      locale: "fr",
      expires_at: expiresAtUnix,
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: amountCents,
            product_data: {
              name: `${shopName} — Commande ${order.orderNumber}`,
              description: `Total TTC : ${Number(order.totalTTC).toFixed(2)} € (livraison incluse)`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: session.user.id,
        },
        receipt_email: order.clientEmail,
        description: `${shopName} — Commande ${order.orderNumber}`,
        ...(statementDescriptor
          ? { statement_descriptor_suffix: statementDescriptor }
          : {}),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    if (!checkoutSession.url) throw new Error("Session sans URL");

    const paymentIntentId =
      typeof checkoutSession.payment_intent === "string"
        ? checkoutSession.payment_intent
        : checkoutSession.payment_intent?.id ?? null;

    await prisma.order.update({
      where: { id: order.id },
      data: {
        stripeCheckoutSessionId: checkoutSession.id,
        stripeCheckoutSessionUrl: checkoutSession.url,
        stripeCheckoutSessionExpiresAt: new Date(expiresAtUnix * 1000),
        // Nouveau PaymentIntent = webhook payment_intent.succeeded match par
        // stripePaymentIntentId. On écrase l'ancien (inutilisé).
        stripePaymentIntentId: paymentIntentId,
      },
    });

    revalidatePath(`/commandes/${order.id}`);

    return {
      success: true,
      url: checkoutSession.url,
      expiresAt: new Date(expiresAtUnix * 1000).toISOString(),
    };
  } catch (err) {
    logger.error("[regeneratePaymentLink] Stripe error", {
      orderId: order.id,
      error: err,
    });
    return { success: false, error: "Impossible de régénérer le lien." };
  }
}
