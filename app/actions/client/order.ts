"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
import { stripe } from "@/lib/stripe";
import nodemailer from "nodemailer";

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
        discountType: true, discountValue: true, freeShipping: true,
      },
    }),
    prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: { select: { id: true, name: true, reference: true, status: true, category: { select: { name: true } } } },
                color:   { select: { id: true, name: true, hex: true } },
                subColors: { orderBy: { position: "asc" }, select: { color: { select: { name: true } } } },
                packEntries: { orderBy: { position: "asc" }, include: { color: { select: { name: true } } } },
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
      cart.items.map((item) => [
        `${item.variant.productId}__${item.variant.colorId}`,
        { productId: item.variant.productId, colorId: item.variant.colorId },
      ])
    ).values(),
  ];

  const allImages = await prisma.productColorImage.findMany({
    where: {
      OR: pairs.map((p) => ({ productId: p.productId, colorId: p.colorId })),
    },
    orderBy: { order: "asc" },
  });

  const imagesByKey = new Map<string, string>();
  for (const img of allImages) {
    const key = `${img.productId}__${img.colorId}`;
    if (!imagesByKey.has(key)) imagesByKey.set(key, img.path);
  }

  // ── Vérifier le paiement Stripe côté serveur ───────────────────────────────
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(input.stripePaymentIntentId);
  } catch (err) {
    console.error("[placeOrder] Erreur retrieve PI:", err);
    return { success: false, error: "Payment Intent introuvable." };
  }
  console.log(`[placeOrder] PI status: ${paymentIntent.status}, PI id: ${paymentIntent.id}`);
  // "succeeded" = carte confirmée
  // "processing" = virement en cours de traitement
  // "requires_action" = virement bancaire — coordonnées affichées, en attente du virement
  const validStatuses = ["succeeded", "processing", "requires_action"];
  if (!validStatuses.includes(paymentIntent.status)) {
    console.error(`[placeOrder] Statut refusé: ${paymentIntent.status}`);
    return { success: false, error: `Le paiement n'a pas été confirmé (statut: ${paymentIntent.status}). Veuillez réessayer.` };
  }

  const isAwaitingTransfer = paymentIntent.status === "processing" || paymentIntent.status === "requires_action";

  const cartItems = cart.items;

  // ── 2. Calculs ─────────────────────────────────────────────────────────

  function computeUnitPrice(variant: (typeof cartItems)[0]["variant"]): number {
    const base = variant.saleType === "UNIT"
      ? variant.unitPrice
      : variant.unitPrice * (variant.packQuantity ?? 1);
    if (!variant.discountType || !variant.discountValue) return base;
    if (variant.discountType === "PERCENT") return Math.max(0, base * (1 - variant.discountValue / 100));
    return Math.max(0, base - variant.discountValue);
  }

  const subtotalHT = cart.items.reduce(
    (s, item) => s + computeUnitPrice(item.variant) * item.quantity, 0
  );

  // Remise commerciale client
  const clientDiscountType  = user.discountType  ?? null;
  const clientDiscountValue = user.discountValue ?? null;
  const clientFreeShipping  = user.freeShipping;

  const clientDiscountAmt = (() => {
    if (!clientDiscountType || !clientDiscountValue) return 0;
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

  // Livraison offerte : on ignore le prix carrier passé par le client
  const effectiveCarrierPrice = clientFreeShipping ? 0 : input.carrierPrice;

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
    return {
      productName: item.variant.product.name,
      productRef:  item.variant.product.reference,
      colorName:   item.variant.subColors?.length
        ? [item.variant.color.name, ...item.variant.subColors.map((sc: { color: { name: string } }) => sc.color.name)].join("/")
        : item.variant.color.name,
      saleType:    item.variant.saleType,
      packQty:     item.variant.packQuantity,
      size:        item.variant.size,
      packDetails: item.variant.packEntries && item.variant.packEntries.length > 0
        ? JSON.stringify(item.variant.packEntries.map((e: { color: { name: string }; size: string; quantity: number }) => ({
            colorName: e.color.name,
            size: e.size,
            qty: e.quantity,
          })))
        : null,
      imagePath:   imagesByKey.get(imgKey) ?? null,
      unitPrice,
      quantity:    item.quantity,
      lineTotal:   unitPrice * item.quantity,
    };
  });

  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId,
      status:       "PENDING",
      // Stripe
      stripePaymentIntentId: input.stripePaymentIntentId,
      paymentStatus:         isAwaitingTransfer ? "awaiting_transfer" : "paid",
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
          size:        item.size ?? null,
          packDetails: item.packDetails ?? null,
          imagePath:   item.imagePath ?? null,
          unitPrice:   item.unitPrice,
          quantity:    item.quantity,
          lineTotal:   item.lineTotal,
        })),
      },
    },
  });

  // ── 4-6. Easy-Express + PDF + Email — uniquement si paiement carte (pas virement en attente)
  // Pour les virements, le webhook Stripe s'en chargera quand le virement sera confirmé.

  if (!isAwaitingTransfer) {
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
      console.warn("[placeOrder] Easy-Express:", eeResult.error);
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
        tvaRate:         input.tvaRate,
        subtotalHT,
        tvaAmount,
        totalTTC,
        items:           orderItems,
      });
    } catch (err) {
      console.error("[placeOrder] PDF error:", err);
    }

    // ── Email admin ─────────────────────────────
    notifyNewOrder({
      orderNumber,
      orderId:    order.id,
      user:       { ...user, firstName: user.firstName, lastName: user.lastName },
      address,
      carrierName: input.carrierName,
      carrierPrice: input.carrierPrice,
      items:        orderItems,
      subtotalHT,
      tvaRate:      input.tvaRate,
      tvaAmount,
      totalTTC,
      pdfBuffer:    pdfBuffer ?? undefined,
      labelBuffer:  labelBuffer ?? undefined,
    }).catch((err) => console.error("[placeOrder] Email error:", err));
  }

  // ── 7. Vider le panier ────────────────────────────────────────────────────

  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

  revalidatePath("/panier");
  revalidatePath("/admin/commandes");

  return { success: true, orderId: order.id, orderNumber };
}

// ─────────────────────────────────────────────
// Email notification admin
// ─────────────────────────────────────────────

interface NotifyOrderData {
  orderNumber:  string;
  orderId:      string;
  user:         { firstName: string; lastName: string; company: string; email: string; phone: string; siret: string; vatNumber?: string | null };
  address:      { firstName: string; lastName: string; company: string | null; address1: string; address2: string | null; zipCode: string; city: string; country: string };
  carrierName:  string;
  carrierPrice: number;
  items:        OrderItemPDF[];
  subtotalHT:   number;
  tvaRate:      number;
  tvaAmount:    number;
  totalTTC:     number;
  pdfBuffer?:   Buffer;
  labelBuffer?: Buffer;
}

async function notifyNewOrder(data: NotifyOrderData): Promise<void> {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, NOTIFY_EMAIL, NEXTAUTH_URL } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !NOTIFY_EMAIL) {
    console.warn("[notifyNewOrder] Variables Gmail manquantes.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const itemsHtml = data.items.map((item) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #E5E5E5;">
        <strong>${item.productName}</strong><br/>
        <small style="color:#6B6B6B;">Réf. ${item.productRef} · ${item.colorName}
        ${item.saleType === "PACK" ? ` · Paquet ×${item.packQty}` : ""}
        ${item.size ? ` · T.${item.size}` : ""}</small>
      </td>
      <td style="padding:10px 14px;text-align:center;border-bottom:1px solid #E5E5E5;">${item.quantity}</td>
      <td style="padding:10px 14px;text-align:right;border-bottom:1px solid #E5E5E5;">${item.unitPrice.toFixed(2)} €</td>
      <td style="padding:10px 14px;text-align:right;border-bottom:1px solid #E5E5E5;font-weight:bold;">${item.lineTotal.toFixed(2)} €</td>
    </tr>
  `).join("");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#1A1A1A;">
      <!-- En-tête -->
      <div style="background:#1A1A1A;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:20px;">Nouvelle commande reçue</h2>
        <p style="margin:6px 0 0;opacity:0.7;font-size:13px;">N° ${data.orderNumber} — ${new Date().toLocaleDateString("fr-FR")}</p>
      </div>

      <div style="background:#FFFFFF;padding:20px 24px;border:1px solid #E5E5E5;border-top:none;">

        <!-- Client -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <tr style="background:#F7F7F8;">
            <td style="padding:10px 14px;font-weight:bold;">Société</td>
            <td style="padding:10px 14px;">${data.user.company}</td>
            <td style="padding:10px 14px;font-weight:bold;">Contact</td>
            <td style="padding:10px 14px;">${data.user.firstName} ${data.user.lastName}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Email</td>
            <td style="padding:10px 14px;">${data.user.email}</td>
            <td style="padding:10px 14px;font-weight:bold;">Téléphone</td>
            <td style="padding:10px 14px;">${data.user.phone}</td>
          </tr>
          <tr style="background:#F7F7F8;">
            <td style="padding:10px 14px;font-weight:bold;">SIRET</td>
            <td style="padding:10px 14px;font-family:monospace;">${data.user.siret}</td>
            ${data.user.vatNumber ? `
            <td style="padding:10px 14px;font-weight:bold;">N° TVA</td>
            <td style="padding:10px 14px;font-family:monospace;">${data.user.vatNumber}</td>
            ` : "<td colspan='2'></td>"}
          </tr>
        </table>

        <!-- Livraison -->
        <div style="background:#F7F7F8;border:1px solid #E5E5E5;border-radius:6px;padding:12px 16px;margin-bottom:20px;">
          <strong style="color:#1A1A1A;">Livraison via ${data.carrierName}</strong><br/>
          <span style="color:#1A1A1A;">${data.address.firstName} ${data.address.lastName}${data.address.company ? ` — ${data.address.company}` : ""}</span><br/>
          <span style="color:#6B6B6B;">${data.address.address1}${data.address.address2 ? `, ${data.address.address2}` : ""}<br/>
          ${data.address.zipCode} ${data.address.city}, ${data.address.country}</span>
        </div>

        <!-- Articles -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
          <thead>
            <tr style="background:#1A1A1A;color:#fff;">
              <th style="padding:10px 14px;text-align:left;">Produit</th>
              <th style="padding:10px 14px;text-align:center;">Qté</th>
              <th style="padding:10px 14px;text-align:right;">P.U. HT</th>
              <th style="padding:10px 14px;text-align:right;">Total HT</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>

        <!-- Totaux -->
        <table style="width:250px;margin-left:auto;border-collapse:collapse;font-size:13px;">
          <tr>
            <td style="padding:6px 0;color:#6B6B6B;">Sous-total HT</td>
            <td style="padding:6px 0;text-align:right;font-weight:bold;">${data.subtotalHT.toFixed(2)} €</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B6B6B;">TVA (${data.tvaRate === 0 ? "0% — exonéré" : `${(data.tvaRate * 100).toFixed(0)}%`})</td>
            <td style="padding:6px 0;text-align:right;font-weight:bold;">${data.tvaAmount.toFixed(2)} €</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B6B6B;">Livraison</td>
            <td style="padding:6px 0;text-align:right;font-weight:bold;">${data.carrierPrice === 0 ? "Gratuit" : `${data.carrierPrice.toFixed(2)} €`}</td>
          </tr>
          <tr style="border-top:2px solid #1A1A1A;">
            <td style="padding:10px 0;font-weight:bold;font-size:15px;">TOTAL TTC</td>
            <td style="padding:10px 0;text-align:right;font-weight:bold;font-size:15px;color:#1A1A1A;">${data.totalTTC.toFixed(2)} €</td>
          </tr>
        </table>

        <!-- Lien admin -->
        <div style="margin-top:24px;">
          <a href="${NEXTAUTH_URL}/admin/commandes/${data.orderId}"
             style="background:#1A1A1A;color:#ffffff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
            Voir la commande dans l'admin →
          </a>
        </div>
      </div>

      <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;">Beli &amp; Jolie — Administration</p>
    </div>
  `;

  const attachments: nodemailer.SendMailOptions["attachments"] = [];

  if (data.pdfBuffer) {
    attachments.push({
      filename: `commande-${data.orderNumber}.pdf`,
      content:  data.pdfBuffer,
      contentType: "application/pdf",
    });
  }

  if (data.labelBuffer) {
    attachments.push({
      filename: `bordereau-${data.orderNumber}.pdf`,
      content:  data.labelBuffer,
      contentType: "application/pdf",
    });
  }

  await transporter.sendMail({
    from:    `"Beli & Jolie" <${GMAIL_USER}>`,
    to:      NOTIFY_EMAIL,
    subject: `Nouvelle commande ${data.orderNumber} — ${data.user.company}`,
    html,
    attachments,
  });
}
