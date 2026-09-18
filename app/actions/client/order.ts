"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { reinstateStockForOrder } from "@/lib/stock";
import { stockUnitsForCartLine } from "@/lib/stock-units";
import { EU_COUNTRIES } from "@/lib/vat";
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
import { getCurrentTenantId, getCurrentTenantSlug } from "@/lib/tenant";
import { findMissingAddressFields } from "@/lib/shipping-address-validate";
import { copyOrderItemImageToOrderDir } from "@/lib/order-item-image-copy";

// Erreur typée pour différencier les ruptures de stock des autres erreurs.
class StockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockError";
  }
}

// Filet de sécurité : quand une branche `placeOrder` refuse la commande APRÈS
// que Stripe a confirmé le paiement, on rembourse immédiatement pour éviter
// que le client se retrouve débité sans commande. Idempotent : si le refund
// échoue (déjà fait, PI annulé), on log et on informe le client autrement.
async function refundAndAbort(
  paymentIntentId: string,
  userId: string,
  logCode: string,
  publicMessage: string,
): Promise<PlaceOrderError> {
  let refunded = false;
  try {
    const stripe = await getStripeInstance();
    await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
      metadata: { reason: logCode, userId },
    });
    refunded = true;
    logger.warn(`[placeOrder] Refund auto (${logCode})`, {
      paymentIntentId,
    });
  } catch (refundErr) {
    logger.error(`[placeOrder] Refund auto échoué (${logCode})`, {
      paymentIntentId,
      error: refundErr,
    });
  }
  const suffix = refunded
    ? " Votre paiement va être remboursé automatiquement — les fonds arriveront sous 3 à 5 jours ouvrés."
    : " Nous n'avons pas pu déclencher le remboursement automatiquement ; l'équipe est prévenue et vous serez remboursé dans les meilleurs délais.";
  return { success: false, error: publicMessage + suffix };
}

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

  // P2-02 — prévenir le client par email (fire-and-forget). L'import est plus
  // bas dans le fichier mais reste hoisté au niveau module par TypeScript.
  notifyOrderStatusChange({ orderId, newStatus: "CANCELLED" }).catch((err) =>
    logger.error("[cancelOrder] Email client annulation error", {
      error: err,
    }),
  );

  // Le stock a été déduit à la commande — on le remet en stock.
  await reinstateStockForOrder(orderId).catch((err) =>
    logger.error("[cancelOrder] Stock reinstate error", {
      error: err,
    }),
  );

  revalidatePath("/commandes");
  revalidatePath(`/commandes/${orderId}`);
}
import type { OrderItemPDF } from "@/lib/pdf-order";
import { createEasyExpressShipment, fetchEasyExpressLabel } from "@/lib/easy-express";
import { getStripeInstance } from "@/lib/stripe";
import { notifyAdminNewOrder, notifyOrderStatusChange } from "@/lib/notifications";
import {
  buildFallbackAddressFromUser,
  isFallbackAddressAllowed,
  type OrderAddressLike,
} from "@/lib/order-address-fallback";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PlaceOrderInput {
  // addressId optionnel : en retrait boutique / transporteur privé, on retombe
  // sur l'adresse société du User (voir lib/order-address-fallback).
  addressId?:    string;
  deliveryMode?: "delivery" | "pickup" | "private" | "merge";
  carrierId:     string;   // base64 carrierId Easy-Express (ou "fallback_*", "pickup_store", "private_carrier", "merge_into_order")
  transactionId: string;   // transactionId retourné par /api/carriers
  carrierName:   string;
  carrierPrice:  number;
  stripePaymentIntentId: string; // pi_xxx retourné par Stripe
  cgvAcceptedAt?: string; // ISO date when client accepted CGV
  // Transporteur privé : email/téléphone OU bordereau
  privateCarrierEmail?:     string;
  privateCarrierPhone?:     string;
  privateCarrierBordereau?: string; // path retourné par uploadBordereau
  // Fusion vers commande parente : id de la commande à laquelle on rattache
  // le nouveau panier (mode "merge"). L'admin regroupera manuellement les
  // articles + ajustera le port dans un second temps.
  mergeIntoOrderId?: string;
  // Code promo saisi par le client (facultatif). Re-validé côté serveur.
  promoCode?: string;
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
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const generate = () => {
    let id = "";
    for (let i = 0; i < 8; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  };

  // Garantir l'unicité (findFirst car orderNumber est unique par tenant seulement)
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

// ─────────────────────────────────────────────
// Action principale
// ─────────────────────────────────────────────

export async function placeOrder(
  input: PlaceOrderInput
): Promise<PlaceOrderResult | PlaceOrderError> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non authentifié." };

  const userId = session.user.id;

  // Rate-limit anti-flood : 5 tentatives / 60s / userId (audit §16). Le check
  // d'idempotence ci-dessous couvre les doublons "légitimes" (retry navigateur),
  // celui-ci couvre les scripts qui martèlent placeOrder pour tenter d'exploiter
  // une race. Clé = userId : plus précis qu'IP (bureaux multi-utilisateurs).
  const rlKey = `place-order:${userId}`;
  const rl = rateLimit(rlKey, 5, 60_000);
  if (!rl.success) {
    return {
      success: false,
      error: "Trop de tentatives de commande. Merci de patienter une minute et de réessayer.",
    };
  }

  // Idempotence : si une commande existe déjà pour ce PaymentIntent (double-clic,
  // navigation retour, worker qui rejoue), on renvoie l'ID existant au lieu de
  // tenter une nouvelle création (qui pourrait déclencher un doublon si le
  // panier n'a pas encore été vidé).
  const existing = await prisma.order.findFirst({
    where: { stripePaymentIntentId: input.stripePaymentIntentId },
    select: { id: true, orderNumber: true },
  });
  if (existing) {
    return {
      success: true,
      orderId: existing.id,
      orderNumber: existing.orderNumber,
    };
  }

  // ── 1. Récupérer toutes les données nécessaires ──────────────────────────

  const [user, cart, shippingAddress] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        firstName: true, lastName: true, company: true,
        email: true, phone: true, siret: true, vatNumber: true,
        vatExempt: true,
        // Adresse société : fallback quand la cliente commande en retrait ou
        // transporteur privé sans adresse de livraison enregistrée.
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

  // À partir d'ici, placeOrder est appelé après que le client a confirmé sa CB
  // côté Stripe (handlePaymentSuccess dans CheckoutClient) — le PaymentIntent
  // est très probablement `succeeded`. Toute branche early-return doit passer
  // par `refundAndAbort` sinon on laisse un débit orphelin (cf. incident
  // Quinchon, 16/08/2026).
  if (!user) {
    return refundAndAbort(
      input.stripePaymentIntentId,
      userId,
      "user_missing",
      "Votre compte est introuvable.",
    );
  }
  if (!cart || cart.items.length === 0) {
    return refundAndAbort(
      input.stripePaymentIntentId,
      userId,
      "cart_empty",
      "Votre panier est vide.",
    );
  }
  // Résolution adresse. En retrait/privé sans adresse enregistrée : on retombe
  // sur l'adresse société stockée sur User (buildFallbackAddressFromUser).
  let address: OrderAddressLike | null = shippingAddress;
  if (!address && isFallbackAddressAllowed(input.deliveryMode)) {
    address = buildFallbackAddressFromUser(user);
  }
  if (!address) {
    return refundAndAbort(
      input.stripePaymentIntentId,
      userId,
      "address_missing",
      "Adresse de livraison introuvable.",
    );
  }
  // Garde-fou ultime : refuser toute commande dont l'adresse a un champ obligatoire
  // vide (Ville, Code postal, Adresse, Nom, Prénom, Pays). Sans ça, Easy-Express /
  // Smarty365 rejettent le bordereau côté admin (cas Slovaquie 27BVT7AF, 2026-09).
  // Le retrait en boutique / transporteur privé / fusion ne passent PAS par une
  // API transporteur, mais on garde le check pour cohérence des données facture.
  const missingAddressFields = findMissingAddressFields(address);
  if (missingAddressFields.length > 0) {
    return refundAndAbort(
      input.stripePaymentIntentId,
      userId,
      "address_incomplete",
      `Adresse de livraison incomplète (${missingAddressFields.join(", ")}). Modifiez votre adresse dans le panier avant de repasser commande.`,
    );
  }
  // Re-vérif du statut d'approbation (audit §11) : si l'admin a retiré
  // l'approbation entre create-intent et placeOrder (ou pendant que le client
  // saisissait sa carte), on refuse ET on rembourse — pas d'exception.
  if (user.status !== "APPROVED") {
    return refundAndAbort(
      input.stripePaymentIntentId,
      userId,
      "user_not_approved",
      "Votre compte n'est plus approuvé pour passer commande.",
    );
  }

  // Refuser tout produit qui n'est plus en ligne (archivé / mis hors-ligne par
  // l'admin entre l'ajout au panier et le paiement). Le panier peut rester
  // ouvert dans un onglet pendant des jours.
  const offlineItem = cart.items.find(
    (item) => item.variant.product.status !== "ONLINE",
  );
  if (offlineItem) {
    return refundAndAbort(
      input.stripePaymentIntentId,
      userId,
      "product_offline",
      `Le produit « ${offlineItem.variant.product.name} » n'est plus disponible à la vente.`,
    );
  }

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
    paymentIntent = await stripe.paymentIntents.retrieve(input.stripePaymentIntentId);
  } catch (err) {
    logger.error("[placeOrder] Erreur retrieve PI", { error: err });
    return { success: false, error: "Payment Intent introuvable." };
  }
  // Carte uniquement — le paiement doit être confirmé
  if (paymentIntent.status !== "succeeded") {
    logger.error(`[placeOrder] Statut refusé: ${paymentIntent.status}`);
    return { success: false, error: `Le paiement n'a pas été confirmé (statut: ${paymentIntent.status}). Veuillez réessayer.` };
  }

  // ── 2. Calculs ─────────────────────────────────────────────────────────
  // Toute la logique pricing (items, remise client, livraison, TVA, total)
  // vit dans `lib/order-pricing.ts` — même source de vérité que
  // /api/payments/create-intent. Ici on prépare uniquement les inputs.

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

  // Validation code promo (si fourni). Le sous-total pre-code sert de base
  // à validatePromoCode ; on le calcule via computeOrderPricing sans code.
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
    if (!check.valid) {
      return refundAndAbort(
        input.stripePaymentIntentId,
        userId,
        "promo_invalid",
        check.error ?? "Le code promo est invalide.",
      );
    }
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
    totalTTCCents,
    promoAutoDiscount,
  } = pricing;

  // Split remise livraison en promo vs client à partir de la trace serveur.
  const shipPromoDiscount = pricingShippingTrace
    .filter((l) => l.kind !== "client")
    .reduce((s, l) => s + l.amount, 0);
  const shipClientDiscount = pricingShippingTrace
    .filter((l) => l.kind === "client")
    .reduce((s, l) => s + l.amount, 0);

  function resolveItemFinalPrice(itemId: string): number {
    return itemPriceResolutions.get(itemId)?.finalUnitPrice ?? 0;
  }

  // ─ Snapshot des promotions appliquées à cette commande (persistance ─
  //   même si la promo est supprimée en BDD plus tard).
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
    // Promotions AUTO par item
    for (const [itemId, res] of itemPriceResolutions) {
      if (!res.promotionId || res.source === "product") continue;
      const item = pricingItems.find((i) => i.id === itemId);
      const qty = item?.quantity ?? 0;
      const savedTotal = res.savedPerUnit * qty;
      const promo = activePromos.find((p) => p.id === res.promotionId);
      if (!promo) continue;
      const key = promo.id;
      const existing = map.get(key);
      if (existing) {
        existing.amountSaved += savedTotal;
      } else {
        map.set(key, {
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
    // Code promo (peut être scope SHIPPING → pas visible ci-dessus)
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

  // Copies exposées plus bas (Order.create + NEXT_ORDER autos)
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

  // Vérification minimum commande (avant remise perso client). Le seuil
  // dépend du mode configuré + du nombre de commandes existantes du client
  // (cf. lib/min-order.ts). Bypass en mode « fusion » : la commande parente
  // a déjà passé le seuil, l'ajout ne doit pas être bloqué (cohérent avec
  // CartWizardClient.tsx qui laisse déjà passer côté UI).
  const isMergeIntoExistingOrder = !!input.mergeIntoOrderId?.trim();
  const minHT = await getEffectiveMinOrderHT(userId);
  if (!isMergeIntoExistingOrder && minHT > 0 && subtotalHT < minHT) {
    return refundAndAbort(
      input.stripePaymentIntentId,
      userId,
      "min_order_ht",
      `Montant minimum de commande non atteint. Minimum requis : ${minHT.toFixed(2)} € HT.`,
    );
  }

  // ── Vérifier que le montant payé par Stripe correspond au total recalculé.
  //    Tolérance de 1 centime pour absorber les arrondis.
  const paidAmountCents = paymentIntent.amount;
  if (Math.abs(paidAmountCents - totalTTCCents) > 1) {
    logger.error("[placeOrder] Montant Stripe incohérent", {
      paid: paidAmountCents,
      expected: totalTTCCents,
      orderUserId: userId,
    });
    return refundAndAbort(
      input.stripePaymentIntentId,
      userId,
      "amount_mismatch",
      "Le montant payé ne correspond pas au total de votre panier. Le prix d'un article a peut-être changé.",
    );
  }
  // `shippingIsFree` non utilisé ici (recordé indirectement via clientFreeShipping + promo).
  void shippingIsFree;

  const isPrivateCarrier = input.carrierId === "private_carrier";

  const totalWeightKg = cart.items.reduce((s, item) => {
    const units = item.variant.saleType === "PACK"
      ? (item.variant.packQuantity ?? 1) * item.quantity
      : item.quantity;
    return s + item.variant.weight * units;
  }, 0);

  // ── 3. Créer la commande en base ─────────────────────────────────────────

  const orderNumber = await generateOrderNumber();

  const orderItems: OrderItemPDF[] = cart.items.map((item) => {
    const unitPrice = resolveItemFinalPrice(item.id);
    const imgKey = `${item.variant.productId}__${item.variant.colorId}`;

    const isMultiPack = item.variant.saleType === "PACK" && item.variant.packLines.length > 0;

    // Pack multi-couleurs : composition détaillée
    const packDetailsJson = isMultiPack
      ? JSON.stringify(
          item.variant.packLines.map((line) => ({
            colorName: line.color?.name ?? "",
            colorHex: line.color?.hex ?? null,
            sizes: line.sizes.map((s) => ({ name: s.size.name, quantity: s.quantity })),
          })),
        )
      : null;

    // colorName : pour multi-couleurs, on liste toutes les couleurs jointes
    const displayColorName = isMultiPack
      ? item.variant.packLines.map((l) => l.color?.name ?? "").filter(Boolean).join(" / ")
      : item.variant.color
        ? item.variant.color.name
        : "Pack";

    // sizesJson : pour multi-couleurs, on cumule par taille
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
      : item.variant.variantSizes.map((vs: { size: { name: string }; quantity: number }) => ({ name: vs.size.name, quantity: vs.quantity }));

    // Build variant snapshot for legal traceability (survives variant deletion)
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
      productName:  item.variant.product.name,
      productRef:   item.variant.product.reference,
      categoryName: item.variant.product.category?.name ?? null,
      colorName:    displayColorName,
      saleType:    item.variant.saleType,
      packQty:     item.variant.packQuantity,
      size:        null,
      sizesJson:   aggregatedSizes.length > 0 ? JSON.stringify(aggregatedSizes) : null,
      packDetails: packDetailsJson,
      imagePath:   imagesByKey.get(imgKey) ?? null,
      unitPrice,
      quantity:    item.quantity,
      lineTotal:   unitPrice * item.quantity,
      variantSnapshot,
    };
  });

  // ── Transaction : vérifier + déduire le stock + créer la commande ────────
  // updateMany conditionnel (where stock >= qty) = atomique au niveau MySQL :
  // deux commandes simultanées sur le dernier article ne peuvent pas réussir
  // toutes les deux.
  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      // 1. Vérifier + décrémenter le stock pour chaque ligne.
      //    PACK : la quantité commandée est en paquets, le stock en pièces
      //    → on multiplie par packQuantity (helper stockUnitsForCartLine).
      for (const item of cart.items) {
        const stockUnits = stockUnitsForCartLine(item);
        const updated = await tx.productColor.updateMany({
          where: { id: item.variant.id, stock: { gte: stockUnits } },
          data:  { stock: { decrement: stockUnits } },
        });
        if (updated.count === 0) {
          const current = await tx.productColor.findUnique({
            where:  { id: item.variant.id },
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

      // 2. Créer la commande (et ses OrderItems)
      const created = await tx.order.create({
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
      clientSiret:     user.siret ?? null,
      clientVatNumber: user.vatNumber ?? null,
      // Transporteur
      carrierId:    input.carrierId,
      carrierName:  input.carrierName,
      carrierPrice: effectiveCarrierPrice,
      // Snapshot livraison pour affichage récap admin (2 blocs séparés)
      carrierBasePrice: input.carrierPrice,
      carrierPromoDiscount: Math.floor(shipPromoDiscount * 100) / 100,
      carrierClientDiscount: Math.floor(shipClientDiscount * 100) / 100,
      // Transporteur privé : email/tél du fournisseur du client OU bordereau joint
      privateCarrierEmail:     isPrivateCarrier ? (input.privateCarrierEmail?.trim() || null) : null,
      privateCarrierPhone:     isPrivateCarrier ? (input.privateCarrierPhone?.trim() || null) : null,
      privateCarrierBordereau: isPrivateCarrier ? (input.privateCarrierBordereau?.trim() || null) : null,
      // Fusion vers une commande parente : la nouvelle commande sera
      // regroupée manuellement par l'admin avec la commande #parent.
      mergeIntoOrderId: input.mergeIntoOrderId?.trim() || null,
      // Remise commerciale client
      clientDiscountType:  clientDiscountType,
      clientDiscountValue: clientDiscountValue,
      clientDiscountAmt,
      clientFreeShipping,
      // Promotion (code saisi manuellement)
      promoCode:     appliedCode?.code ?? null,
      promoDiscount: appliedCode?.totalSaved ?? 0,
      // CGV
      cgvAcceptedAt: input.cgvAcceptedAt ? new Date(input.cgvAcceptedAt) : null,
      // TVA
      tvaRate,
      subtotalHT: subtotalAfterDiscount,
      // Snapshot HT BRUT (avant toute réduction) — pour afficher séparément promo et remise.
      subtotalBrutHT,
      promoAutoDiscount,
      // Snapshot des promotions appliquées (persiste si promo supprimée après).
      appliedPromotions: appliedPromotionsSnapshot,
      // Snapshot immuable du HT réellement payé par le client — sert de plafond
      // aux modifications post-commande côté admin. Ne bouge PAS après la vente.
      paidSubtotalHT: subtotalAfterDiscount,
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

      // 3. Tracer les mouvements de stock liés à la commande.
      //    Cohérent avec la décrémentation : PACK = qty × packQuantity.
      await tx.stockMovement.createMany({
        data: cart.items.map((item) => ({
          productColorId: item.variant.id,
          quantity: -stockUnitsForCartLine(item),
          type: "ORDER" as const,
          orderId: created.id,
          reason: `Commande ${orderNumber}`,
        })),
      });

      // 4. Vider le panier dans la MÊME transaction. Si MySQL hoquette entre
      //    order.create et cartItem.deleteMany, la commande ET le panier
      //    doivent bouger ensemble — sinon le client peut re-cliquer « Payer »
      //    et re-payer les mêmes articles.
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return created;
    });

    // Copie des miniatures dans un dossier propre à la commande. La commande
    // devient ainsi autonome des fiches produit : si une variante est
    // supprimée plus tard, la vignette dans « Mes commandes » et sur le PDF
    // de facture reste affichable. Best-effort : un échec de copie n'annule
    // pas la commande (la ligne conserve son ancien chemin, seule la vignette
    // pourrait afficher un placeholder). À faire AVANT les mails de
    // confirmation pour que le PDF pointe déjà vers le nouveau chemin.
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
      logger.error("[placeOrder] copie miniatures commande échouée", {
        orderId: order.id,
        error: err as Error,
      });
    }

    // Annule le job de relance panier abandonné (s'il existait) : commande
    // passée = plus aucun rappel à envoyer. Fire-and-forget, hors transaction.
    try {
      const tenantId = await getCurrentTenantId();
      if (tenantId) {
        await cancelAbandonedCartJob(userId, tenantId, "ORDER_CREATED");
      }
    } catch (err) {
      logger.error("[placeOrder] cancel abandoned cart failed", { userId, error: err as Error });
    }
  } catch (err) {
    if (err instanceof StockError) {
      logger.warn("[placeOrder] Stock insuffisant", { message: err.message });
      // Filet de sécurité race condition : le paiement Stripe a réussi (vérifié
      // plus haut) mais un autre client a vidé le stock pendant que Mme X
      // saisissait sa CB. On rembourse immédiatement.
      return refundAndAbort(
        input.stripePaymentIntentId,
        userId,
        "stock_race_condition",
        err.message,
      );
    }
    logger.error("[placeOrder] Transaction error", {
      error: err,
    });
    // La transaction contient stock + order + stockMovements + cart cleanup.
    // Si elle plante, MySQL rollback tout : pas de commande, pas de stock
    // décrémenté, panier intact. On rembourse quand même par prudence — le
    // helper est idempotent si le client re-tente et ça passe la 2e fois.
    return refundAndAbort(
      input.stripePaymentIntentId,
      userId,
      "transaction_error",
      "Impossible de finaliser la commande. Merci de réessayer.",
    );
  }

  // ── 4-6. Easy-Express + PDF + Email ────────────────────────────────────

  let labelBuffer: Buffer | null = null;

  // Ne pas appeler Easy-Express si on est sur un carrier fallback, retrait en boutique, ou transporteur privé
  const isFallbackCarrier =
    input.carrierId.startsWith("fallback_") ||
    input.carrierId === "pickup_store" ||
    input.carrierId === "private_carrier";

  // Toute livraison hors UE (y compris DOM-TOM) : la génération du bordereau
  // est différée côté admin. Easy-Express exige une facture proforma /
  // déclaration douanière dans le payload qu'on ne sait pas encore renseigner
  // automatiquement — l'admin génère le bordereau via le portail Easy-Express
  // puis saisit le suivi à la main.
  const country = address.country.toUpperCase();
  const isOutsideEu = !EU_COUNTRIES.has(country);

  const eeResult = isFallbackCarrier
    ? { success: false as const, error: "Carrier fallback — pas d'expédition Easy-Express." }
    : isOutsideEu
    ? { success: false as const, error: "Livraison hors UE — bordereau différé côté admin." }
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

  // ── Emails (fire-and-forget) ─────────────────
  // Notif admin (mail léger sans PDF — voir lib/notifications.ts) + confirmation client.
  notifyAdminNewOrder({ orderId: order.id }).catch((err) =>
    logger.error("[placeOrder] Notif admin error", { error: err })
  );
  notifyOrderStatusChange({ orderId: order.id, newStatus: "PENDING" }).catch((err) =>
    logger.error("[placeOrder] Confirmation client error", { error: err })
  );

  // ── Push stock Microstore (fire-and-forget, silencieux) ─────────────────
  // La cliente veut que le stock côté Microstore reflète en temps réel les
  // ventes BJ, sans avoir à cliquer. Contrat : uniquement les produits déjà
  // poussés au moins une fois (microstoreLastPushedAt != null) — sinon on
  // laisserait Microstore créer un produit "à moitié" (sans photo).
  // Le tenantId doit être capturé ici (contexte requête) et passé
  // explicitement dans l'IIFE via tenantALS.run — cf. CLAUDE.md multi-tenant.
  {
    const { getCurrentTenantIdSync } = await import("@/lib/tenant-als");
    const tenantId = getCurrentTenantIdSync();
    if (tenantId) {
      const impactedProductIds = Array.from(
        new Set(cart.items.map((i) => i.variant.productId)),
      );
      import("@/lib/microstore-products").then(({ pushMicrostoreStockSilent }) =>
        pushMicrostoreStockSilent(impactedProductIds, tenantId).catch((err) =>
          logger.error("[placeOrder] Microstore stock push error", { error: err }),
        ),
      );

      // Rotation auto couleur principale : après décrémentation de stock, si
      // la couleur principale d'un produit vient de tomber entièrement à 0,
      // on bascule vers une autre couleur dispo. Fire-and-forget, tenantId
      // capturé pour l'ALS (contexte HTTP peut être clos avant que ça tourne).
      import("@/lib/rotate-primary-service").then(({ rotatePrimaryIfNeeded }) => {
        for (const pid of impactedProductIds) {
          rotatePrimaryIfNeeded(pid, { tenantId }).catch((err) =>
            logger.error("[placeOrder] rotatePrimary error", { error: err, productId: pid }),
          );
        }
      });
    }
  }

  // ── 6.5 Enregistrer les usages de promotions (AUTO + code) ─────────────
  // Une promo est enregistrée UNE fois par commande, même si elle a gagné
  // sur plusieurs items. Le montant écrit = somme des économies réalisées
  // grâce à elle.
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
      logger.error("[placeOrder] recordPromoUsage error", { error: err, promoId }),
    );
  }
  if (promoSavingsById.size > 0) revalidateTag("promotions", "default");

  // ── 7. Auto-suppression remises NEXT_ORDER ──────────────────────────────

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

  // ── 8. Revalider les caches ──────────────────────────────────────────────
  // (Le panier a déjà été vidé dans la transaction ci-dessus.)

  revalidatePath("/panier");
  revalidatePath("/admin/commandes");

  return { success: true, orderId: order.id, orderNumber };
}

// ─────────────────────────────────────────────
// Email notification admin
// ─────────────────────────────────────────────

