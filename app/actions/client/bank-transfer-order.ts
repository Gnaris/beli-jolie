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
import { getEffectiveMinOrderHT } from "@/lib/min-order";
import { cancelAbandonedCartJob } from "@/lib/abandoned-cart-trigger";
import { getCurrentTenantId } from "@/lib/tenant";
import { findMissingAddressFields } from "@/lib/shipping-address-validate";
import { getCachedBankTransferConfig } from "@/lib/bank-transfer-config";
import { notifyAdminNewOrder, notifyOrderStatusChange } from "@/lib/notifications";
import type { OrderItemPDF } from "@/lib/pdf-order";

// Erreur typée pour différencier les ruptures de stock des autres erreurs.
class StockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockError";
  }
}

export interface BankTransferOrderInput {
  addressId: string;
  carrierId: string;
  transactionId: string; // reste requis pour vérifier la signature carrier
  carrierSig: string;
  carrierName: string;
  carrierPrice: number;
  cgvAcceptedAt?: string;
  privateCarrierEmail?: string;
  privateCarrierPhone?: string;
  privateCarrierBordereau?: string;
  mergeIntoOrderId?: string;
  promoCode?: string;
}

export interface BankTransferOrderResult {
  success: true;
  orderId: string;
  orderNumber: string;
}

export interface BankTransferOrderError {
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
 * Crée une commande payée par virement bancaire.
 *
 * Diffère de `placeOrder` :
 *  - Aucun PaymentIntent Stripe (pas de vérif Stripe, pas de refund automatique).
 *  - `paymentMode = "BANK_TRANSFER"`, `paymentStatus = "pending"`.
 *  - Envoie l'email « virement en attente » avec l'IBAN (au lieu de la
 *    confirmation classique).
 *  - Le stock est déduit dès la création, comme pour la carte — le client
 *    a la garantie d'avoir sa réservation.
 *
 * Refuse la création si le virement n'est pas activé côté paramètres tenant.
 */
export async function placeBankTransferOrder(
  input: BankTransferOrderInput,
): Promise<BankTransferOrderResult | BankTransferOrderError> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non authentifié." };

  const userId = session.user.id;

  // Rate-limit : même seuil que placeOrder carte.
  const rl = rateLimit(`place-bank-order:${userId}`, 5, 60_000);
  if (!rl.success) {
    return {
      success: false,
      error: "Trop de tentatives de commande. Merci de patienter une minute et de réessayer.",
    };
  }

  // Refuser si la boutique n'a pas activé le virement.
  const btConfig = await getCachedBankTransferConfig();
  if (!btConfig.enabled) {
    return { success: false, error: "Le paiement par virement n'est pas disponible pour cette boutique." };
  }

  // ── Charger les données ────────────────────────────────────────────────
  const [user, cart, address] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        firstName: true, lastName: true, company: true,
        email: true, phone: true, siret: true, vatNumber: true,
        vatExempt: true, addressCountry: true,
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
    prisma.shippingAddress.findFirst({ where: { id: input.addressId, userId } }),
  ]);

  if (!user) return { success: false, error: "Votre compte est introuvable." };
  if (user.status !== "APPROVED") {
    return { success: false, error: "Votre compte n'est plus approuvé pour passer commande." };
  }
  if (!cart || cart.items.length === 0) return { success: false, error: "Votre panier est vide." };
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

  // ── Images ────────────────────────────────────────────────────────────
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

  // ── Pricing (même moteur que carte) ───────────────────────────────────
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
    shippingIsFree,
    shippingPromotionId,
    shippingTrace: pricingShippingTrace,
    tvaRate,
    tvaAmount,
    totalTTC,
    promoAutoDiscount,
  } = pricing;
  void shippingIsFree;

  const shipPromoDiscount = pricingShippingTrace.filter((l) => l.kind !== "client").reduce((s, l) => s + l.amount, 0);
  const shipClientDiscount = pricingShippingTrace.filter((l) => l.kind === "client").reduce((s, l) => s + l.amount, 0);

  function resolveItemFinalPrice(itemId: string): number {
    return itemPriceResolutions.get(itemId)?.finalUnitPrice ?? 0;
  }

  // Snapshot des promotions appliquées (même logique que placeOrder).
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

  // Min de commande (bypass en fusion — même règle que carte).
  const isMergeIntoExistingOrder = !!input.mergeIntoOrderId?.trim();
  const minHT = await getEffectiveMinOrderHT(userId);
  if (!isMergeIntoExistingOrder && minHT > 0 && subtotalHT < minHT) {
    return {
      success: false,
      error: `Montant minimum de commande non atteint. Minimum requis : ${minHT.toFixed(2)} € HT.`,
    };
  }

  const isPrivateCarrier = input.carrierId === "private_carrier";

  // ── Construction des OrderItems (identique à placeOrder) ──────────────
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

  // ── Transaction : stock + order + cleanup panier ──────────────────────
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
          // Marqueurs virement — pas de Stripe PI, paymentStatus reste "pending"
          // jusqu'à ce que l'admin clique « Marquer virement reçu ».
          paymentMode: "BANK_TRANSFER",
          paymentStatus: "pending",
          // Livraison
          shipLabel: address.label,
          shipFirstName: address.firstName,
          shipLastName: address.lastName,
          shipCompany: address.company ?? null,
          shipAddress1: address.address1,
          shipAddress2: address.address2 ?? null,
          shipZipCode: address.zipCode,
          shipCity: address.city,
          shipCountry: address.country,
          // Client
          clientCompany: user.company,
          clientEmail: user.email,
          clientPhone: user.phone,
          clientSiret: user.siret ?? null,
          clientVatNumber: user.vatNumber ?? null,
          // Transporteur
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
          cgvAcceptedAt: input.cgvAcceptedAt ? new Date(input.cgvAcceptedAt) : null,
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

    try {
      const tenantId = await getCurrentTenantId();
      if (tenantId) await cancelAbandonedCartJob(userId, tenantId, "ORDER_CREATED");
    } catch (err) {
      logger.error("[placeBankTransferOrder] cancel abandoned cart failed", { userId, error: err as Error });
    }
  } catch (err) {
    if (err instanceof StockError) {
      logger.warn("[placeBankTransferOrder] Stock insuffisant", { message: err.message });
      return { success: false, error: err.message };
    }
    logger.error("[placeBankTransferOrder] Transaction error", { error: err });
    return { success: false, error: "Impossible de finaliser la commande. Merci de réessayer." };
  }

  // ── Emails : virement en attente (client) + notification admin ────────
  notifyAdminNewOrder({ orderId: order.id }).catch((err) =>
    logger.error("[placeBankTransferOrder] Notif admin error", { error: err }),
  );
  notifyOrderStatusChange({ orderId: order.id, newStatus: "BANK_TRANSFER_PENDING" }).catch((err) =>
    logger.error("[placeBankTransferOrder] Confirmation client error", { error: err }),
  );

  // Enregistrer usages de promotions
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
      logger.error("[placeBankTransferOrder] recordPromoUsage error", { error: err, promoId }),
    );
  }
  if (promoSavingsById.size > 0) revalidateTag("promotions", "default");

  // Auto-suppression remises NEXT_ORDER
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

  return { success: true, orderId: order.id, orderNumber };
}
