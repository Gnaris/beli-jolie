import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { generateOrderPDF, type OrderItemPDF } from "@/lib/pdf-order";
import { createEasyExpressShipment, fetchEasyExpressLabel } from "@/lib/easy-express";
import nodemailer from "nodemailer";
import type Stripe from "stripe";

/**
 * POST /api/payments/webhook
 * Webhook Stripe — confirme le paiement et met à jour la commande.
 * Pour les virements bancaires : déclenche aussi l'email admin + PDF + Easy-Express.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Signature manquante." }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("[Stripe Webhook] Signature invalide:", err);
    return NextResponse.json({ error: "Signature invalide." }, { status: 400 });
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;

      // Récupérer la commande liée
      const order = await prisma.order.findFirst({
        where: { stripePaymentIntentId: pi.id },
        include: { items: true },
      });

      if (!order) {
        console.warn(`[Stripe Webhook] Aucune commande pour PI: ${pi.id}`);
        break;
      }

      // Si c'était un virement en attente → le virement vient d'arriver
      const wasAwaitingTransfer = order.paymentStatus === "awaiting_transfer";

      // Mettre à jour le statut de paiement
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: "paid" },
      });

      console.log(`[Stripe Webhook] Paiement confirmé: ${pi.id} (commande ${order.orderNumber})`);

      // Si c'était un virement en attente → déclencher la notification admin
      if (wasAwaitingTransfer) {
        await processTransferConfirmed(order);
      }

      break;
    }

    case "payment_intent.processing": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await prisma.order.updateMany({
        where: { stripePaymentIntentId: pi.id },
        data: { paymentStatus: "awaiting_transfer" },
      });
      console.log(`[Stripe Webhook] Virement en attente: ${pi.id}`);
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await prisma.order.updateMany({
        where: { stripePaymentIntentId: pi.id },
        data: { paymentStatus: "failed" },
      });
      console.warn(`[Stripe Webhook] Paiement échoué: ${pi.id}`);
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}

// ─────────────────────────────────────────────
// Quand un virement est confirmé : PDF + Easy-Express + Email admin
// ─────────────────────────────────────────────

type OrderWithItems = Awaited<ReturnType<typeof prisma.order.findFirst>> & {
  items: Awaited<ReturnType<typeof prisma.orderItem.findMany>>;
};

async function processTransferConfirmed(order: NonNullable<OrderWithItems>) {
  try {
    // Récupérer le user
    const user = await prisma.user.findUnique({
      where: { id: order.userId },
      select: {
        firstName: true, lastName: true, company: true,
        email: true, phone: true, siret: true, vatNumber: true,
      },
    });

    if (!user) {
      console.error(`[Webhook] User introuvable pour commande ${order.orderNumber}`);
      return;
    }

    // Préparer les items pour le PDF
    const orderItems: OrderItemPDF[] = order.items.map((item) => ({
      productName: item.productName,
      productRef:  item.productRef,
      colorName:   item.colorName,
      saleType:    item.saleType,
      packQty:     item.packQty,
      size:        item.size,
      imagePath:   item.imagePath,
      unitPrice:   item.unitPrice,
      quantity:    item.quantity,
      lineTotal:   item.lineTotal,
    }));

    // ── Easy-Express ──────────────────────────────
    let labelBuffer: Buffer | null = null;
    const isFallbackCarrier = order.carrierId.startsWith("fallback_") || order.carrierId === "pickup_store";

    if (!isFallbackCarrier) {
      // On ne peut plus utiliser le transactionId original (expiré).
      // Demander de nouveaux tarifs pour obtenir un nouveau transactionId.
      try {
        const ratesRes = await fetch(`${process.env.NEXTAUTH_URL}/api/carriers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            zipCode:    order.shipZipCode,
            country:    order.shipCountry,
            weightKg:   1, // Poids minimum
            subtotalHT: order.subtotalHT,
          }),
        });
        const ratesData = await ratesRes.json();

        if (ratesData.transactionId) {
          const eeResult = await createEasyExpressShipment({
            transactionId: ratesData.transactionId,
            carrierId:     order.carrierId,
            orderNumber:   order.orderNumber,
            weightKg:      1,
            toFirstName:   order.shipFirstName,
            toLastName:    order.shipLastName,
            toCompany:     order.shipCompany ?? null,
            toEmail:       user.email,
            toAddress1:    order.shipAddress1,
            toAddress2:    order.shipAddress2 ?? null,
            toZipCode:     order.shipZipCode,
            toCity:        order.shipCity,
            toCountry:     order.shipCountry,
            toPhone:       null,
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
            console.warn(`[Webhook] Easy-Express: ${eeResult.error}`);
          }
        }
      } catch (err) {
        console.warn("[Webhook] Easy-Express error:", err);
      }
    }

    // ── PDF ───────────────────────────────────────
    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = await generateOrderPDF({
        orderNumber:     order.orderNumber,
        createdAt:       order.createdAt,
        clientCompany:   user.company,
        clientFirstName: user.firstName,
        clientLastName:  user.lastName,
        clientEmail:     user.email,
        clientPhone:     user.phone,
        clientSiret:     user.siret,
        clientVatNumber: user.vatNumber ?? null,
        shipLabel:       order.shipLabel,
        shipFirstName:   order.shipFirstName,
        shipLastName:    order.shipLastName,
        shipCompany:     order.shipCompany ?? null,
        shipAddress1:    order.shipAddress1,
        shipAddress2:    order.shipAddress2 ?? null,
        shipZipCode:     order.shipZipCode,
        shipCity:        order.shipCity,
        shipCountry:     order.shipCountry,
        carrierName:     order.carrierName,
        carrierPrice:    order.carrierPrice,
        tvaRate:         order.tvaRate,
        subtotalHT:      order.subtotalHT,
        tvaAmount:       order.tvaAmount,
        totalTTC:        order.totalTTC,
        items:           orderItems,
      });
    } catch (err) {
      console.error("[Webhook] PDF error:", err);
    }

    // ── Email admin ───────────────────────────────
    await notifyTransferConfirmed({
      orderNumber:  order.orderNumber,
      orderId:      order.id,
      user,
      address: {
        firstName: order.shipFirstName,
        lastName:  order.shipLastName,
        company:   order.shipCompany,
        address1:  order.shipAddress1,
        address2:  order.shipAddress2,
        zipCode:   order.shipZipCode,
        city:      order.shipCity,
        country:   order.shipCountry,
      },
      carrierName:  order.carrierName,
      carrierPrice: order.carrierPrice,
      items:        orderItems,
      subtotalHT:   order.subtotalHT,
      tvaRate:      order.tvaRate,
      tvaAmount:    order.tvaAmount,
      totalTTC:     order.totalTTC,
      pdfBuffer:    pdfBuffer ?? undefined,
      labelBuffer:  labelBuffer ?? undefined,
    });

    console.log(`[Webhook] Notification envoyée pour commande ${order.orderNumber} (virement confirmé)`);
  } catch (err) {
    console.error(`[Webhook] Erreur traitement virement confirmé:`, err);
  }
}

// ─────────────────────────────────────────────
// Email notification admin (virement confirmé)
// ─────────────────────────────────────────────

interface NotifyData {
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

async function notifyTransferConfirmed(data: NotifyData): Promise<void> {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, NOTIFY_EMAIL, NEXTAUTH_URL } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !NOTIFY_EMAIL) {
    console.warn("[Webhook] Variables Gmail manquantes — email non envoyé.");
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
        <h2 style="margin:0;font-size:20px;">Virement reçu — Commande confirmée</h2>
        <p style="margin:6px 0 0;opacity:0.7;font-size:13px;">N° ${data.orderNumber} — ${new Date().toLocaleDateString("fr-FR")}</p>
      </div>

      <div style="background:#FFFFFF;padding:20px 24px;border:1px solid #E5E5E5;border-top:none;">

        <!-- Badge virement confirmé -->
        <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
          <strong style="color:#065F46;">Le virement bancaire a été reçu et confirmé par Stripe.</strong>
        </div>

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
    subject: `Virement confirmé — Commande ${data.orderNumber} — ${data.user.company}`,
    html,
    attachments,
  });
}
