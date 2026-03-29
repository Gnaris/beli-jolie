/**
 * lib/notifications.ts
 *
 * Envoi d'un email à l'admin lors d'une nouvelle inscription client.
 * Le Kbis est joint en pièce jointe.
 *
 * Configuration email lue depuis les paramètres admin (SiteConfig),
 * avec fallback sur les variables d'environnement.
 */

import nodemailer from "nodemailer";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getCachedShopName, getCachedCompanyInfo, getCachedGmailConfig } from "@/lib/cached-data";

interface NewClientInfo {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  siret: string;
  kbisPath?: string; // chemin relatif stocké en base, ex: private/uploads/kbis/kbis_XXX.pdf
  documentPath?: string; // document complémentaire, ex: private/uploads/documents/doc_XXX.pdf
  registrationMessage?: string; // message libre saisi lors de l'inscription
}

export async function notifyNewClientRegistration(
  client: NewClientInfo
): Promise<void> {
  const [shopName, companyInfo, gmailCfg] = await Promise.all([
    getCachedShopName(), getCachedCompanyInfo(), getCachedGmailConfig(),
  ]);
  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;

  if (!GMAIL_USER || !GMAIL_PASSWORD) {
    console.warn("[notifications] Configuration Gmail manquante — email ignoré.");
    return;
  }

  const notifyEmail = gmailCfg.notifyEmail || companyInfo?.email || process.env.NOTIFY_EMAIL;
  if (!notifyEmail) {
    console.warn("[notifications] Aucun email destinataire configuré — email ignoré.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  // Pièce jointe Kbis (optionnelle)
  const attachments: { filename: string; path: string }[] = [];
  if (client.kbisPath) {
    attachments.push({
      filename: path.basename(client.kbisPath),
      path: path.join(process.cwd(), client.kbisPath),
    });
  }
  if (client.documentPath) {
    attachments.push({
      filename: path.basename(client.documentPath),
      path: path.join(process.cwd(), client.documentPath),
    });
  }

  const messageBlock = client.registrationMessage
    ? `<tr>
        <td style="padding:10px 14px;font-weight:bold;vertical-align:top;">Message</td>
        <td style="padding:10px 14px;white-space:pre-wrap;">${client.registrationMessage}</td>
       </tr>`
    : "";

  const kbisNote = client.kbisPath
    ? `<p style="margin-top:16px;color:#475569;font-size:13px;">Le document Kbis est joint à cet email.</p>`
    : `<p style="margin-top:16px;color:#F59E0B;font-size:13px;">Aucun Kbis fourni lors de l'inscription.</p>`;

  const docNote = client.documentPath
    ? `<p style="margin-top:8px;color:#475569;font-size:13px;">Un document complémentaire est également joint.</p>`
    : "";

  await transporter.sendMail({
    from: `"${shopName}" <${GMAIL_USER}>`,
    to: notifyEmail,
    subject: `Nouvelle inscription client — ${client.company}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#0F172A;">
        <h2 style="color:#0F3460;border-bottom:2px solid #E2E8F0;padding-bottom:10px;">
          Nouvelle demande d'inscription
        </h2>
        <p>Un nouveau client vient de s'inscrire sur la plateforme B2B ${shopName}.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <tr style="background:#F1F5F9;">
            <td style="padding:10px 14px;font-weight:bold;width:40%;">Prénom / Nom</td>
            <td style="padding:10px 14px;">${client.firstName} ${client.lastName}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Société</td>
            <td style="padding:10px 14px;">${client.company}</td>
          </tr>
          <tr style="background:#F1F5F9;">
            <td style="padding:10px 14px;font-weight:bold;">Email</td>
            <td style="padding:10px 14px;">${client.email}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Téléphone</td>
            <td style="padding:10px 14px;">${client.phone}</td>
          </tr>
          <tr style="background:#F1F5F9;">
            <td style="padding:10px 14px;font-weight:bold;">SIRET</td>
            <td style="padding:10px 14px;">${client.siret}</td>
          </tr>
          ${messageBlock}
        </table>
        ${kbisNote}
        ${docNote}
        <div style="margin-top:20px;">
          <a href="${process.env.NEXTAUTH_URL}/admin/utilisateurs"
             style="background:#0F3460;color:#ffffff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;">
            Examiner le dossier →
          </a>
        </div>
        <p style="margin-top:24px;color:#94A3B8;font-size:12px;">
          ${shopName} — Administration
        </p>
      </div>
    `,
    attachments,
  });
}

// ─────────────────────────────────────────────
// Alerte de réassort — envoi email aux clients inscrits
// ─────────────────────────────────────────────

/**
 * Check and notify clients subscribed to restock alerts for a given variant.
 * Called after stock is updated from 0 to > 0.
 * Fire-and-forget — errors are logged but do not propagate.
 */
export async function notifyRestockAlerts(productColorId: string): Promise<void> {
  try {
    const gmailCfg = await getCachedGmailConfig();
    const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
    const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
    if (!GMAIL_USER || !GMAIL_PASSWORD) return;

    // Find all pending alerts for this variant
    const alerts = await prisma.restockAlert.findMany({
      where: { productColorId, notified: false },
      include: {
        user: { select: { email: true, firstName: true } },
        product: { select: { id: true, name: true, reference: true } },
        productColor: {
          select: { color: { select: { name: true } } },
        },
      },
    });

    if (alerts.length === 0) return;

    const shopName = await getCachedShopName();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    for (const alert of alerts) {
      const productUrl = `${baseUrl}/produits/${alert.product.id}`;
      const colorName = alert.productColor.color?.name ?? "";

      await transporter.sendMail({
        from: `"${shopName}" <${GMAIL_USER}>`,
        to: alert.user.email,
        subject: `🔔 Réassort — ${alert.product.name} (${colorName})`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px;">
            <h2 style="color:#1A1A1A;">Bonne nouvelle, ${alert.user.firstName} !</h2>
            <p>Le produit que vous surveillez est de nouveau en stock :</p>
            <div style="background:#F7F7F8;border:1px solid #E5E5E5;border-radius:12px;padding:16px;margin:16px 0;">
              <p style="margin:0;font-weight:600;">${alert.product.name}</p>
              <p style="margin:4px 0 0;color:#6B7280;">Réf. ${alert.product.reference} — ${colorName}</p>
            </div>
            <a href="${productUrl}"
               style="background:#1A1A1A;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
              Voir le produit →
            </a>
            <p style="margin-top:24px;color:#94A3B8;font-size:12px;">
              ${shopName} — Vous recevez cet email car vous avez activé une alerte de réassort.
            </p>
          </div>
        `,
      });

      // Mark as notified
      await prisma.restockAlert.update({
        where: { id: alert.id },
        data: { notified: true },
      });
    }

  } catch (err) {
    console.error("[restock] Erreur envoi alertes:", err);
  }
}

// ─────────────────────────────────────────────
// Notification client — changement de statut commande
// ─────────────────────────────────────────────

interface OrderStatusEmailData {
  orderId: string;
  newStatus: string;
}

const STATUS_CONFIG: Record<string, {
  subject: (orderNumber: string, shopName: string) => string;
  heading: string;
  message: (orderNumber: string) => string;
  color: string;
  icon: string;
}> = {
  PROCESSING: {
    subject: (num, shop) => `${shop} — Commande ${num} en cours de préparation`,
    heading: "Votre commande est en cours de préparation",
    message: (num) =>
      `Bonne nouvelle ! Votre commande <strong>${num}</strong> est en cours de préparation par notre équipe. Nous vous tiendrons informé(e) dès son expédition.`,
    color: "#2563EB",
    icon: "📦",
  },
  SHIPPED: {
    subject: (num, shop) => `${shop} — Commande ${num} expédiée`,
    heading: "Votre commande a été expédiée",
    message: (num) =>
      `Votre commande <strong>${num}</strong> a été expédiée ! Elle est en route vers votre adresse de livraison.`,
    color: "#7C3AED",
    icon: "🚚",
  },
  DELIVERED: {
    subject: (num, shop) => `${shop} — Commande ${num} livrée`,
    heading: "Votre commande a été livrée",
    message: (num) =>
      `Votre commande <strong>${num}</strong> a été livrée avec succès. Nous espérons que vous en êtes satisfait(e).`,
    color: "#16A34A",
    icon: "✅",
  },
  CANCELLED: {
    subject: (num, shop) => `${shop} — Commande ${num} annulée`,
    heading: "Votre commande a été annulée",
    message: (num) =>
      `Votre commande <strong>${num}</strong> a été annulée. Si vous avez des questions, n'hésitez pas à nous contacter.`,
    color: "#DC2626",
    icon: "❌",
  },
};

/**
 * Send an email to the client when order status changes.
 * Fire-and-forget — errors are logged but never propagated.
 */
export async function notifyOrderStatusChange(
  data: OrderStatusEmailData
): Promise<void> {
  try {
    const config = STATUS_CONFIG[data.newStatus];
    if (!config) return; // PENDING = no email (handled at order creation)

    const [shopName, companyInfo, gmailCfg] = await Promise.all([
      getCachedShopName(),
      getCachedCompanyInfo(),
      getCachedGmailConfig(),
    ]);

    const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
    const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
    if (!GMAIL_USER || !GMAIL_PASSWORD) {
      console.warn("[order-status-email] Configuration Gmail manquante — email ignoré.");
      return;
    }

    // Fetch order with items
    const order = await prisma.order.findUnique({
      where: { id: data.orderId },
      include: {
        items: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!order) {
      console.warn("[order-status-email] Commande introuvable:", data.orderId);
      return;
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    // Tracking info (for SHIPPED status)
    const trackingHtml =
      data.newStatus === "SHIPPED" && order.eeTrackingId
        ? `<div style="background:#F0F4FF;border:1px solid #BFDBFE;border-radius:8px;padding:14px 18px;margin:16px 0;">
            <strong style="color:#1E40AF;">Suivi de votre colis</strong><br/>
            <span style="color:#1A1A1A;">Transporteur : ${order.carrierName}</span><br/>
            <span style="color:#1A1A1A;">N° de suivi : <strong>${order.eeTrackingId}</strong></span>
          </div>`
        : "";

    // Items summary table
    const itemsHtml = order.items
      .map(
        (item) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E5E5;">
          <strong>${item.productName}</strong><br/>
          <small style="color:#6B6B6B;">Réf. ${item.productRef} · ${item.colorName}${item.saleType === "PACK" ? ` · Paquet ×${item.packQty}` : ""}</small>
        </td>
        <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #E5E5E5;">${item.quantity}</td>
        <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #E5E5E5;">${Number(item.lineTotal).toFixed(2)} €</td>
      </tr>`
      )
      .join("");

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
        <!-- En-tête -->
        <div style="background:${config.color};color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <div style="font-size:36px;margin-bottom:8px;">${config.icon}</div>
          <h2 style="margin:0;font-size:20px;">${config.heading}</h2>
          <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">Commande N° ${order.orderNumber}</p>
        </div>

        <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
          <p style="font-size:15px;line-height:1.6;">
            Bonjour${order.clientCompany ? ` <strong>${order.clientCompany}</strong>` : ""},
          </p>
          <p style="font-size:15px;line-height:1.6;">
            ${config.message(order.orderNumber)}
          </p>

          ${trackingHtml}

          <!-- Récapitulatif commande -->
          <div style="margin-top:24px;">
            <h3 style="font-size:14px;color:#6B6B6B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">
              Récapitulatif de votre commande
            </h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="background:#F7F7F8;">
                  <th style="padding:8px 12px;text-align:left;">Produit</th>
                  <th style="padding:8px 12px;text-align:center;">Qté</th>
                  <th style="padding:8px 12px;text-align:right;">Total HT</th>
                </tr>
              </thead>
              <tbody>${itemsHtml}</tbody>
            </table>

            <!-- Totaux -->
            <table style="width:220px;margin-left:auto;margin-top:12px;border-collapse:collapse;font-size:13px;">
              <tr>
                <td style="padding:4px 0;color:#6B6B6B;">Sous-total HT</td>
                <td style="padding:4px 0;text-align:right;">${Number(order.subtotalHT).toFixed(2)} €</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B6B6B;">TVA (${order.tvaRate === 0 ? "exonéré" : `${(order.tvaRate * 100).toFixed(0)}%`})</td>
                <td style="padding:4px 0;text-align:right;">${Number(order.tvaAmount).toFixed(2)} €</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B6B6B;">Livraison</td>
                <td style="padding:4px 0;text-align:right;">${Number(order.carrierPrice) === 0 ? "Gratuit" : `${Number(order.carrierPrice).toFixed(2)} €`}</td>
              </tr>
              <tr style="border-top:2px solid #1A1A1A;">
                <td style="padding:8px 0;font-weight:bold;">Total TTC</td>
                <td style="padding:8px 0;text-align:right;font-weight:bold;">${Number(order.totalTTC).toFixed(2)} €</td>
              </tr>
            </table>
          </div>

          <!-- Lien espace client -->
          <div style="text-align:center;margin-top:28px;">
            <a href="${baseUrl}/commandes/${order.id}"
               style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
              Voir ma commande →
            </a>
          </div>

          ${companyInfo?.email ? `
          <p style="margin-top:24px;font-size:13px;color:#6B6B6B;text-align:center;">
            Une question ? Contactez-nous à <a href="mailto:${companyInfo.email}" style="color:${config.color};">${companyInfo.email}</a>
          </p>` : ""}
        </div>

        <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
          ${shopName} — Cet email a été envoyé automatiquement suite à la mise à jour de votre commande.
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: `"${shopName}" <${GMAIL_USER}>`,
      to: order.clientEmail,
      subject: config.subject(order.orderNumber, shopName),
      html,
    });

  } catch (err) {
    console.error("[order-status-email] Erreur envoi email:", err);
  }
}
