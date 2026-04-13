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
import { logger } from "@/lib/logger";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
    logger.warn("[notifications] Configuration Gmail manquante — email ignoré.");
    return;
  }

  const notifyEmail = gmailCfg.notifyEmail || companyInfo?.email || process.env.NOTIFY_EMAIL;
  if (!notifyEmail) {
    logger.warn("[notifications] Aucun email destinataire configuré — email ignoré.");
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
        <td style="padding:10px 14px;white-space:pre-wrap;">${escapeHtml(client.registrationMessage)}</td>
       </tr>`
    : "";

  const kbisNote = client.kbisPath
    ? `<p style="margin-top:16px;color:#4B5563;font-size:13px;">Le document Kbis est joint à cet email.</p>`
    : `<p style="margin-top:16px;color:#F59E0B;font-size:13px;">Aucun Kbis fourni lors de l'inscription.</p>`;

  const docNote = client.documentPath
    ? `<p style="margin-top:8px;color:#4B5563;font-size:13px;">Un document complémentaire est également joint.</p>`
    : "";

  await transporter.sendMail({
    from: `"${shopName}" <${GMAIL_USER}>`,
    to: notifyEmail,
    subject: `Nouvelle inscription client — ${client.company}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
        <h2 style="color:#1A1A1A;border-bottom:2px solid #E5E7EB;padding-bottom:10px;">
          Nouvelle demande d'inscription
        </h2>
        <p>Un nouveau client vient de s'inscrire sur la plateforme B2B ${escapeHtml(shopName)}.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <tr style="background:#F3F4F6;">
            <td style="padding:10px 14px;font-weight:bold;width:40%;">Prénom / Nom</td>
            <td style="padding:10px 14px;">${escapeHtml(client.firstName)} ${escapeHtml(client.lastName)}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Société</td>
            <td style="padding:10px 14px;">${escapeHtml(client.company)}</td>
          </tr>
          <tr style="background:#F3F4F6;">
            <td style="padding:10px 14px;font-weight:bold;">Email</td>
            <td style="padding:10px 14px;">${escapeHtml(client.email)}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Téléphone</td>
            <td style="padding:10px 14px;">${escapeHtml(client.phone)}</td>
          </tr>
          <tr style="background:#F3F4F6;">
            <td style="padding:10px 14px;font-weight:bold;">SIRET</td>
            <td style="padding:10px 14px;">${escapeHtml(client.siret)}</td>
          </tr>
          ${messageBlock}
        </table>
        ${kbisNote}
        ${docNote}
        <div style="margin-top:20px;">
          <a href="${process.env.NEXTAUTH_URL}/admin/utilisateurs"
             style="background:#1A1A1A;color:#ffffff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;">
            Examiner le dossier →
          </a>
        </div>
        <p style="margin-top:24px;color:#9CA3AF;font-size:12px;">
          ${escapeHtml(shopName)} — Administration
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
            <h2 style="color:#1A1A1A;">Bonne nouvelle, ${escapeHtml(alert.user.firstName)} !</h2>
            <p>Le produit que vous surveillez est de nouveau en stock :</p>
            <div style="background:#F7F7F8;border:1px solid #E5E5E5;border-radius:12px;padding:16px;margin:16px 0;">
              <p style="margin:0;font-weight:600;">${escapeHtml(alert.product.name)}</p>
              <p style="margin:4px 0 0;color:#6B7280;">Réf. ${escapeHtml(alert.product.reference)} — ${escapeHtml(colorName)}</p>
            </div>
            <a href="${productUrl}"
               style="background:#1A1A1A;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
              Voir le produit →
            </a>
            <p style="margin-top:24px;color:#9CA3AF;font-size:12px;">
              ${escapeHtml(shopName)} — Vous recevez cet email car vous avez activé une alerte de réassort.
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
    logger.error("[restock] Erreur envoi alertes", { detail: err instanceof Error ? err.message : String(err) });
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
      `Bonne nouvelle ! Votre commande <strong>${escapeHtml(num)}</strong> est en cours de préparation par notre équipe. Nous vous tiendrons informé(e) dès son expédition.`,
    color: "#4B5563",
    icon: "📦",
  },
  SHIPPED: {
    subject: (num, shop) => `${shop} — Commande ${num} expédiée`,
    heading: "Votre commande a été expédiée",
    message: (num) =>
      `Votre commande <strong>${escapeHtml(num)}</strong> a été expédiée ! Elle est en route vers votre adresse de livraison.`,
    color: "#374151",
    icon: "🚚",
  },
  DELIVERED: {
    subject: (num, shop) => `${shop} — Commande ${num} livrée`,
    heading: "Votre commande a été livrée",
    message: (num) =>
      `Votre commande <strong>${escapeHtml(num)}</strong> a été livrée avec succès. Nous espérons que vous en êtes satisfait(e).`,
    color: "#16A34A",
    icon: "✅",
  },
  CANCELLED: {
    subject: (num, shop) => `${shop} — Commande ${num} annulée`,
    heading: "Votre commande a été annulée",
    message: (num) =>
      `Votre commande <strong>${escapeHtml(num)}</strong> a été annulée. Si vous avez des questions, n'hésitez pas à nous contacter.`,
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
      logger.warn("[order-status-email] Configuration Gmail manquante — email ignoré.");
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
      logger.warn("[order-status-email] Commande introuvable", { orderId: data.orderId });
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
        ? `<div style="background:#F3F4F6;border:1px solid #D1D5DB;border-radius:8px;padding:14px 18px;margin:16px 0;">
            <strong style="color:#1F2937;">Suivi de votre colis</strong><br/>
            <span style="color:#1A1A1A;">Transporteur : ${escapeHtml(order.carrierName || '')}</span><br/>
            <span style="color:#1A1A1A;">N° de suivi : <strong>${escapeHtml(order.eeTrackingId || '')}</strong></span>
          </div>`
        : "";

    // Items summary table
    const itemsHtml = order.items
      .map(
        (item) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E5E5;">
          <strong>${escapeHtml(item.productName)}</strong><br/>
          <small style="color:#6B6B6B;">Réf. ${escapeHtml(item.productRef)} · ${escapeHtml(item.colorName)}${item.saleType === "PACK" ? ` · Paquet ×${item.packQty}` : ""}</small>
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
          <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">Commande N° ${escapeHtml(order.orderNumber)}</p>
        </div>

        <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
          <p style="font-size:15px;line-height:1.6;">
            Bonjour${order.clientCompany ? ` <strong>${escapeHtml(order.clientCompany)}</strong>` : ""},
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
            Une question ? Contactez-nous à <a href="mailto:${companyInfo.email}" style="color:${config.color};">${escapeHtml(companyInfo.email)}</a>
          </p>` : ""}
        </div>

        <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
          ${escapeHtml(shopName)} — Cet email a été envoyé automatiquement suite à la mise à jour de votre commande.
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
    logger.error("[order-status-email] Erreur envoi email", { detail: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Notify admin of a new message from a client.
 */
export async function notifyAdminNewMessage(params: {
  clientName: string;
  clientCompany: string;
  subject: string;
  messagePreview: string;
  conversationId: string;
}) {
  const { clientName, clientCompany, subject, messagePreview, conversationId } = params;
  const [shopName, gmailCfg, companyInfo] = await Promise.all([
    getCachedShopName(), getCachedGmailConfig(), getCachedCompanyInfo(),
  ]);

  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_PASSWORD) return;

  const notifyEmail = gmailCfg.notifyEmail || companyInfo?.email || process.env.NOTIFY_EMAIL;
  if (!notifyEmail) return;

  const ref = `CONV-${conversationId.slice(-8).toUpperCase()}`;
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  await transporter.sendMail({
    from: `"${shopName || 'Boutique'}" <${GMAIL_USER}>`,
    to: notifyEmail,
    subject: `[${ref}] Nouveau message de ${clientCompany} — ${subject}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Nouveau message</h2>
        <p><strong>${escapeHtml(clientName)}</strong> (${escapeHtml(clientCompany)}) vous a envoye un message :</p>
        <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#333;">${escapeHtml(messagePreview).substring(0, 500)}</p>
        </div>
        <a href="${baseUrl}/admin/messages/${conversationId}"
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Voir la conversation
        </a>
      </div>
    `,
  });

  logger.info(`[Notifications] Admin notified of new message [${ref}]`);
}

/**
 * Notify client of a new reply from admin.
 */
export async function notifyClientNewReply(params: {
  clientEmail: string;
  clientName: string;
  subject: string;
  messagePreview: string;
  conversationId: string;
}) {
  const { clientEmail, clientName, subject, messagePreview, conversationId } = params;
  const [shopName, gmailCfg] = await Promise.all([
    getCachedShopName(), getCachedGmailConfig(),
  ]);

  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_PASSWORD) return;

  const ref = `CONV-${conversationId.slice(-8).toUpperCase()}`;
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  await transporter.sendMail({
    from: `"${shopName || 'Boutique'}" <${GMAIL_USER}>`,
    to: clientEmail,
    subject: `[${ref}] Reponse a votre message — ${subject}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Bonjour ${escapeHtml(clientName)},</h2>
        <p>Vous avez recu une reponse a votre message :</p>
        <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#333;">${escapeHtml(messagePreview).substring(0, 500)}</p>
        </div>
        <a href="${baseUrl}/espace-pro/messages/${conversationId}"
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Voir la conversation
        </a>
      </div>
    `,
  });

  logger.info(`[Notifications] Client ${clientEmail} notified of reply [${ref}]`);
}

/**
 * Notify admin of a new claim.
 */
export async function notifyAdminNewClaim(params: {
  clientName: string;
  clientCompany: string;
  claimReference: string;
  claimType: string;
  description: string;
  claimId: string;
}) {
  const { clientName, clientCompany, claimReference, claimType, description, claimId } = params;
  const [shopName, gmailCfg, companyInfo] = await Promise.all([
    getCachedShopName(), getCachedGmailConfig(), getCachedCompanyInfo(),
  ]);

  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_PASSWORD) return;

  const notifyEmail = gmailCfg.notifyEmail || companyInfo?.email || process.env.NOTIFY_EMAIL;
  if (!notifyEmail) return;

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  await transporter.sendMail({
    from: `"${shopName || 'Boutique'}" <${GMAIL_USER}>`,
    to: notifyEmail,
    subject: `Nouvelle reclamation ${claimReference} — ${clientCompany}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Nouvelle reclamation</h2>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px;font-weight:bold;">Reference</td><td style="padding:8px;">${escapeHtml(claimReference)}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Client</td><td style="padding:8px;">${escapeHtml(clientName)} (${escapeHtml(clientCompany)})</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Type</td><td style="padding:8px;">${claimType === 'ORDER_CLAIM' ? 'Liee a une commande' : 'Generale'}</td></tr>
        </table>
        <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#333;">${escapeHtml(description).substring(0, 500)}</p>
        </div>
        <a href="${baseUrl}/admin/reclamations/${claimId}"
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Examiner la reclamation
        </a>
      </div>
    `,
  });

  logger.info(`[Notifications] Admin notified of new claim ${claimReference}`);
}

/**
 * Notify client of claim status update.
 */
export async function notifyClientClaimUpdate(params: {
  clientEmail: string;
  clientName: string;
  claimReference: string;
  newStatus: string;
  message?: string;
  claimId: string;
}) {
  const { clientEmail, clientName, claimReference, newStatus, message, claimId } = params;
  const [shopName, gmailCfg] = await Promise.all([
    getCachedShopName(), getCachedGmailConfig(),
  ]);

  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_PASSWORD) return;

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const statusLabels: Record<string, string> = {
    IN_REVIEW: "en cours d'examen",
    ACCEPTED: "acceptee",
    REJECTED: "refusee",
    RETURN_PENDING: "en attente de retour",
    RESOLVED: "resolue",
    CLOSED: "cloturee",
  };

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  await transporter.sendMail({
    from: `"${shopName || 'Boutique'}" <${GMAIL_USER}>`,
    to: clientEmail,
    subject: `Reclamation ${claimReference} — ${statusLabels[newStatus] || newStatus}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Bonjour ${escapeHtml(clientName)},</h2>
        <p>Votre reclamation <strong>${escapeHtml(claimReference)}</strong> est maintenant <strong>${statusLabels[newStatus] || newStatus}</strong>.</p>
        ${message ? `<div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;"><p style="margin:0;">${escapeHtml(message)}</p></div>` : ''}
        <a href="${baseUrl}/espace-pro/reclamations/${claimId}"
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Voir la reclamation
        </a>
      </div>
    `,
  });
}
