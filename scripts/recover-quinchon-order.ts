/**
 * ONE-SHOT recovery : recrée UNE commande pour Mme Quinchon à partir du panier
 * qu'elle avait au moment de sa 1ère tentative (2026-08-16 19:39:40 UTC),
 * rattachée au PaymentIntent Stripe `pi_3U59uC2ZYZ7st65K0Wwme0bV` (140.34 €).
 *
 * Autorise le stock à passer en négatif pour la variante en rupture (W123 Violet,
 * seule ligne coupable de l'échec initial) → tracé comme backorder.
 *
 * Usage sur le VPS :
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/recover-quinchon-order.ts --dry-run
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/recover-quinchon-order.ts --apply
 */

import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { decryptIfSensitive } from "@/lib/encryption";
import { computeOrderPricing } from "@/lib/order-pricing";
import { buildCartPromoContexts } from "@/lib/promotion-cart-context";
import { loadActivePromotions } from "@/lib/promotions";
import { tenantALS } from "@/lib/tenant-als";
import { config as loadEnv } from "dotenv";

loadEnv();

const prisma = new PrismaClient();

const USER_ID = "cmr0l3vqs00het6oeqaiysv7f";
const CART_ID = "cmr2flt71012fuxsbo3046ciu";
const PI_ID = "pi_3U59uC2ZYZ7st65K0Wwme0bV";
const CUTOFF = new Date("2026-08-16T19:39:40.000Z");
const ADDRESS_ID = "cmr2g9mfe013luxsbf9jibam3";
const CARRIER_ID =
  "ZzZZVHl5ZGdlR3BvbkJhdTMzWTZkc0NhVjlKZFFLYmdydEdBVytnUCtyQT0=";
const CARRIER_NAME = "Colis prive";
const CARRIER_PRICE = 5.33;

const APPLY = process.argv.includes("--apply");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function generateOrderNumber(): Promise<string> {
  let orderNumber = "";
  let exists = true;
  while (exists) {
    orderNumber = "";
    for (let i = 0; i < 8; i++)
      orderNumber += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    const found = await prisma.order.findFirst({
      where: { orderNumber },
      select: { id: true },
    });
    exists = !!found;
  }
  return orderNumber;
}

async function run() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: "beliandjolie" },
  });
  if (!tenant) throw new Error("Tenant beliandjolie introuvable");

  // 1. Vérifier PI côté Stripe
  const cfg = await prisma.siteConfig.findFirst({
    where: { tenantId: tenant.id, key: "stripe_secret_key" },
  });
  if (!cfg?.value) throw new Error("Clé Stripe absente en BDD");
  const sk = decryptIfSensitive("stripe_secret_key", cfg.value).trim();
  const stripe = new Stripe(sk);
  const pi = await stripe.paymentIntents.retrieve(PI_ID);
  if (pi.status !== "succeeded")
    throw new Error(`PI status=${pi.status}, attendu succeeded`);
  console.log(
    `\nPI ${PI_ID} : ${(pi.amount / 100).toFixed(2)} EUR — ${pi.status}\n`,
  );

  // 2. Charger user + adresse
  const user = await prisma.user.findUnique({
    where: { id: USER_ID },
    select: {
      firstName: true,
      lastName: true,
      company: true,
      email: true,
      phone: true,
      siret: true,
      vatNumber: true,
      vatExempt: true,
      addressCountry: true,
      discountType: true,
      discountValue: true,
      discountMode: true,
      discountMinAmount: true,
      discountMinQuantity: true,
      freeShipping: true,
      shippingDiscountType: true,
      shippingDiscountValue: true,
      shippingDiscountMode: true,
      shippingDiscountMinAmount: true,
      shippingDiscountMinQuantity: true,
      tenantId: true,
    },
  });
  if (!user || user.tenantId !== tenant.id)
    throw new Error("User introuvable ou mauvais tenant");

  const address = await prisma.shippingAddress.findFirst({
    where: { id: ADDRESS_ID, userId: USER_ID },
  });
  if (!address) throw new Error("Adresse introuvable");

  // 3. Charger les 38 items du panier (createdAt < cutoff)
  const items = await prisma.cartItem.findMany({
    where: { cartId: CART_ID, createdAt: { lt: CUTOFF } },
    include: {
      variant: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              reference: true,
              status: true,
              discountPercent: true,
              categoryId: true,
              category: { select: { name: true } },
            },
          },
          color: { select: { id: true, name: true, hex: true } },
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
  });

  if (items.length === 0) throw new Error("Panier vide au cutoff — anomalie");
  console.log(`Panier au cutoff : ${items.length} items\n`);

  // 4. Reconstituer le pricing exactement comme create-intent / placeOrder
  const [activePromos, promoContexts] = await Promise.all([
    loadActivePromotions(),
    buildCartPromoContexts(items),
  ]);
  const pricingItems = items
    .map((i) => {
      const ctx = promoContexts.get(i.id);
      if (!ctx) return null;
      return { id: i.id, quantity: i.quantity, promoContext: ctx.context };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const pricing = computeOrderPricing({
    items: pricingItems,
    carrierId: CARRIER_ID,
    carrierPrice: CARRIER_PRICE,
    addressCountry: address.country,
    user: {
      discountType: user.discountType ?? null,
      discountValue:
        user.discountValue != null ? Number(user.discountValue) : null,
      discountMode: user.discountMode ?? "PERMANENT",
      discountMinAmount:
        user.discountMinAmount != null ? Number(user.discountMinAmount) : null,
      discountMinQuantity: user.discountMinQuantity ?? null,
      vatExempt: user.vatExempt ?? false,
      freeShipping: user.freeShipping ?? false,
      shippingDiscountType: user.shippingDiscountType ?? null,
      shippingDiscountValue:
        user.shippingDiscountValue != null
          ? Number(user.shippingDiscountValue)
          : null,
      shippingDiscountMode: user.shippingDiscountMode ?? "PERMANENT",
      shippingDiscountMinAmount:
        user.shippingDiscountMinAmount != null
          ? Number(user.shippingDiscountMinAmount)
          : null,
      shippingDiscountMinQuantity: user.shippingDiscountMinQuantity ?? null,
    },
    activePromos,
    appliedCodePromo: null,
  });

  console.log(`Subtotal HT : ${pricing.subtotalHT.toFixed(2)} EUR`);
  console.log(`Port        : ${pricing.effectiveCarrierPrice.toFixed(2)} EUR`);
  console.log(`TVA ${(pricing.tvaRate * 100).toFixed(0)}%      : ${pricing.tvaAmount.toFixed(2)} EUR`);
  console.log(`Total TTC   : ${pricing.totalTTC.toFixed(2)} EUR`);
  console.log(`Stripe PI   : ${(pi.amount / 100).toFixed(2)} EUR`);
  const match = Math.abs(pi.amount - pricing.totalTTCCents) <= 1;
  console.log(`Match       : ${match ? "OUI ✓" : "NON ⚠ (écart " + (pi.amount - pricing.totalTTCCents) + " centimes)"}\n`);

  if (!match) {
    console.log(
      "⚠ Écart tolérable : la commande sera créée au montant EXACT du panier " +
        "actuel. La cliente devra gérer manuellement le trop/moins-perçu Stripe.",
    );
    console.log("Détail des lignes :");
    for (const it of items) {
      const r = pricing.itemFinalPrices.get(it.id);
      console.log(
        `  - ${it.variant.product.name} ${it.variant.color?.name ?? "-"} × ${it.quantity} @ ${r?.finalUnitPrice.toFixed(2) ?? "?"} EUR`,
      );
    }
    console.log("");
  }

  // 5. Récupérer les images (pour OrderItem.imagePath)
  const colorPairs = [
    ...new Map(
      items
        .filter((i) => i.variant.colorId != null)
        .map((i) => [
          `${i.variant.productId}__${i.variant.colorId}`,
          {
            productId: i.variant.productId,
            colorId: i.variant.colorId!,
          },
        ]),
    ).values(),
  ];
  const allImages =
    colorPairs.length > 0
      ? await prisma.productColorImage.findMany({
          where: {
            OR: colorPairs.map((p) => ({
              productId: p.productId,
              colorId: p.colorId,
            })),
          },
          orderBy: { order: "asc" },
        })
      : [];
  const imagesByKey = new Map<string, string>();
  for (const img of allImages) {
    const key = `${img.productId}__${img.colorId}`;
    if (!imagesByKey.has(key)) imagesByKey.set(key, img.path);
  }

  // 6. Construire les OrderItems
  const orderItemsData = items.map((it) => {
    const priceRes = pricing.itemFinalPrices.get(it.id)!;
    const isMultiPack =
      it.variant.saleType === "PACK" && it.variant.packLines.length > 0;
    const displayColorName = isMultiPack
      ? it.variant.packLines
          .map((l) => l.color?.name ?? "")
          .filter(Boolean)
          .join(" / ")
      : it.variant.color
        ? it.variant.color.name
        : "Pack";
    const aggregatedSizes = isMultiPack
      ? (() => {
          const m = new Map<string, { name: string; quantity: number }>();
          for (const line of it.variant.packLines) {
            for (const s of line.sizes) {
              const cur = m.get(s.sizeId);
              if (cur) cur.quantity += s.quantity;
              else m.set(s.sizeId, { name: s.size.name, quantity: s.quantity });
            }
          }
          return [...m.values()];
        })()
      : it.variant.variantSizes.map((vs) => ({
          name: vs.size.name,
          quantity: vs.quantity,
        }));
    const key = `${it.variant.productId}__${it.variant.colorId}`;
    return {
      productName: it.variant.product.name,
      productRef: it.variant.product.reference,
      colorName: displayColorName,
      saleType: it.variant.saleType,
      packQty: it.variant.packQuantity ?? null,
      size: null,
      sizesJson:
        aggregatedSizes.length > 0 ? JSON.stringify(aggregatedSizes) : null,
      packDetails: null,
      imagePath: imagesByKey.get(key) ?? null,
      unitPrice: priceRes.finalUnitPrice,
      quantity: it.quantity,
      lineTotal: priceRes.finalUnitPrice * it.quantity,
      variantSnapshot: JSON.stringify({
        productColorId: it.variant.id,
        productName: it.variant.product.name,
        productRef: it.variant.product.reference,
        categoryName: it.variant.product.category?.name ?? null,
        colorName: displayColorName,
        colorHex: it.variant.color?.hex ?? null,
        saleType: it.variant.saleType,
        packQuantity: it.variant.packQuantity,
        weight: it.variant.weight,
        unitPriceOriginal: Number(it.variant.unitPrice),
        discountPercent:
          it.variant.product.discountPercent != null
            ? Number(it.variant.product.discountPercent)
            : null,
        sizes: aggregatedSizes,
        packLines: isMultiPack
          ? it.variant.packLines.map((line) => ({
              colorName: line.color?.name ?? "",
              sizes: line.sizes.map((s) => ({
                name: s.size.name,
                quantity: s.quantity,
              })),
            }))
          : null,
      }),
    };
  });

  if (!APPLY) {
    console.log(`[DRY-RUN] Rien créé. Relance avec --apply pour créer.\n`);
    console.log("Aperçu des lignes :");
    for (const oi of orderItemsData) {
      console.log(
        `  - ${oi.productName} · ${oi.colorName} × ${oi.quantity} @ ${oi.unitPrice.toFixed(2)} = ${oi.lineTotal.toFixed(2)} EUR`,
      );
    }
    return;
  }

  // 7. APPLY : créer la commande dans une transaction
  const orderNumber = await generateOrderNumber();
  console.log(`Création commande ${orderNumber}…`);

  const order = await prisma.$transaction(async (tx) => {
    // Décrémente stock — SANS contrainte (le variant en rupture passera à -1)
    for (const it of items) {
      const qtyUnits =
        it.variant.saleType === "PACK"
          ? (it.variant.packQuantity ?? 1) * it.quantity
          : it.quantity;
      await tx.productColor.update({
        where: { id: it.variant.id },
        data: { stock: { decrement: qtyUnits } },
      });
    }

    const created = await tx.order.create({
      data: {
        tenantId: tenant.id,
        orderNumber,
        userId: USER_ID,
        status: "PENDING",
        stripePaymentIntentId: PI_ID,
        paymentStatus: "paid",
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
        carrierId: CARRIER_ID,
        carrierName: CARRIER_NAME,
        carrierPrice: pricing.effectiveCarrierPrice,
        clientDiscountType: user.discountType ?? null,
        clientDiscountValue:
          user.discountValue != null ? Number(user.discountValue) : null,
        clientDiscountAmt: pricing.clientDiscountAmt,
        clientFreeShipping: user.freeShipping,
        promoCode: null,
        promoDiscount: 0,
        tvaRate: pricing.tvaRate,
        subtotalHT: pricing.subtotalAfterDiscount,
        tvaAmount: pricing.tvaAmount,
        totalTTC: pricing.totalTTC,
        items: {
          create: orderItemsData,
        },
      },
    });

    await tx.stockMovement.createMany({
      data: items.map((it) => {
        const qtyUnits =
          it.variant.saleType === "PACK"
            ? (it.variant.packQuantity ?? 1) * it.quantity
            : it.quantity;
        return {
          tenantId: tenant.id,
          productColorId: it.variant.id,
          quantity: -qtyUnits,
          type: "ORDER" as const,
          orderId: created.id,
          reason: `Commande ${orderNumber} (recovery Quinchon)`,
        };
      }),
    });

    return created;
  });

  console.log(`✓ Commande ${orderNumber} créée (id=${order.id})\n`);

  // 8. Retirer les items utilisés du panier (garde ceux ajoutés post-cutoff)
  const deleted = await prisma.cartItem.deleteMany({
    where: { cartId: CART_ID, createdAt: { lt: CUTOFF } },
  });
  console.log(
    `✓ ${deleted.count} items retirés du panier (${39 - deleted.count} conservé)\n`,
  );

  // 9. Envoyer emails (dans le contexte tenant beliandjolie)
  const { notifyAdminNewOrder, notifyOrderStatusChange } = await import(
    "@/lib/notifications"
  );

  await tenantALS.run(tenant.id, async () => {
    try {
      await notifyAdminNewOrder({ orderId: order.id });
      console.log(`✓ Email admin envoyé`);
    } catch (e) {
      console.log(`✗ Email admin : ${(e as Error).message}`);
    }
    try {
      await notifyOrderStatusChange({
        orderId: order.id,
        newStatus: "PENDING",
      });
      console.log(`✓ Email confirmation client envoyé`);
    } catch (e) {
      console.log(`✗ Email client : ${(e as Error).message}`);
    }
  });

  console.log(`\n═══════════════════════════════════════`);
  console.log(`Recovery terminée`);
  console.log(`Numéro commande : ${orderNumber}`);
  console.log(`Total TTC       : ${pricing.totalTTC.toFixed(2)} EUR`);
  console.log(`PaymentIntent   : ${PI_ID}`);
  console.log(`═══════════════════════════════════════`);
  console.log(`\nÀ REMBOURSER MANUELLEMENT sur Stripe :`);
  console.log(`  - pi_3U5A0v2ZYZ7st65K0jpPWLYJ   (140.34 EUR — 2e tentative)`);
  console.log(`  - pi_3U5AAj2ZYZ7st65K0L92hRp6   (140.34 EUR — 3e tentative)`);
  const overpaid = pi.amount - pricing.totalTTCCents;
  if (overpaid > 0) {
    console.log(
      `  - ${PI_ID.padEnd(30)} REFUND PARTIEL ${(overpaid / 100).toFixed(2)} EUR (trop-perçu vs commande créée)`,
    );
  }
}

run()
  .catch((err) => {
    console.error("Erreur fatale :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
