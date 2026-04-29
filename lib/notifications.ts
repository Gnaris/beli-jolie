/**
 * lib/notifications.ts
 *
 * Envoi d'emails transactionnels (inscriptions, alertes stock, statuts commande,
 * messages support, réclamations) via SMTP (lib/email.ts → nodemailer).
 *
 * Configuration lue depuis les variables d'environnement.
 */

import { prisma } from "@/lib/prisma";
import {
  getCachedShopName,
  getCachedCompanyInfo,
} from "@/lib/cached-data";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function resolveNotifyEmail(): Promise<string | null> {
  const companyInfo = await getCachedCompanyInfo();
  return (
    process.env.NOTIFY_EMAIL || companyInfo?.email || null
  );
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
  const [shopName, notifyEmail] = await Promise.all([
    getCachedShopName(),
    resolveNotifyEmail(),
  ]);
  if (!notifyEmail) {
    logger.warn("[notifications] Aucun email destinataire configuré — email ignoré.");
    return;
  }

  const attachments: { filename: string; path: string }[] = [];
  if (client.kbisPath) {
    const name = client.kbisPath.split(/[\\/]/).pop() || "kbis.pdf";
    attachments.push({ filename: name, path: client.kbisPath });
  }
  if (client.documentPath) {
    const name = client.documentPath.split(/[\\/]/).pop() || "document.pdf";
    attachments.push({ filename: name, path: client.documentPath });
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

  await sendMail({
    fromName: shopName,
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
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    for (const alert of alerts) {
      const productUrl = `${baseUrl}/produits/${alert.product.id}`;
      const colorName = alert.productColor.color?.name ?? "";

      const result = await sendMail({
        fromName: shopName,
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

      // Si config absente, on arrête tout (inutile de continuer la boucle)
      if (!result.sent && result.reason === "no_config") return;

      // Mark as notified seulement si l'envoi a réussi
      if (result.sent) {
        await prisma.restockAlert.update({
          where: { id: alert.id },
          data: { notified: true },
        });
      }
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
  PENDING: {
    subject: (num, shop) => `${shop} — Confirmation de votre commande ${num}`,
    heading: "Merci pour votre commande",
    message: (num) =>
      `Nous avons bien reçu votre commande <strong>${escapeHtml(num)}</strong>. Elle sera prise en charge par notre équipe dans les plus brefs délais. Vous recevrez un email dès qu'elle passe en préparation.`,
    color: "#1A1A1A",
    icon: "🧾",
  },
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
    if (!config) return;

    const [shopName, companyInfo] = await Promise.all([
      getCachedShopName(),
      getCachedCompanyInfo(),
    ]);

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

    await sendMail({
      fromName: shopName,
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
  const [shopName, notifyEmail] = await Promise.all([
    getCachedShopName(),
    resolveNotifyEmail(),
  ]);
  if (!notifyEmail) return;

  const ref = `CONV-${conversationId.slice(-8).toUpperCase()}`;
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  await sendMail({
    fromName: shopName || "Boutique",
    to: notifyEmail,
    subject: `[${ref}] Nouveau message de ${clientCompany} — ${subject}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Nouveau message</h2>
        <p><strong>${escapeHtml(clientName)}</strong> (${escapeHtml(clientCompany)}) vous a envoyé un message :</p>
        <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#333;">${escapeHtml(messagePreview).substring(0, 500)}</p>
        </div>
        <a href="${baseUrl}/admin"
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
  const shopName = await getCachedShopName();

  const ref = `CONV-${conversationId.slice(-8).toUpperCase()}`;
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  await sendMail({
    fromName: shopName || "Boutique",
    to: clientEmail,
    subject: `[${ref}] Réponse à votre message — ${subject}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Bonjour ${escapeHtml(clientName)},</h2>
        <p>Vous avez reçu une réponse à votre message :</p>
        <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#333;">${escapeHtml(messagePreview).substring(0, 500)}</p>
        </div>
        <a href="${baseUrl}/espace-pro"
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
  const [shopName, notifyEmail] = await Promise.all([
    getCachedShopName(),
    resolveNotifyEmail(),
  ]);
  if (!notifyEmail) return;

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  await sendMail({
    fromName: shopName || "Boutique",
    to: notifyEmail,
    subject: `Nouvelle réclamation ${claimReference} — ${clientCompany}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Nouvelle réclamation</h2>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px;font-weight:bold;">Référence</td><td style="padding:8px;">${escapeHtml(claimReference)}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Client</td><td style="padding:8px;">${escapeHtml(clientName)} (${escapeHtml(clientCompany)})</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Type</td><td style="padding:8px;">${claimType === 'ORDER_CLAIM' ? 'Liée à une commande' : 'Générale'}</td></tr>
        </table>
        <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#333;">${escapeHtml(description).substring(0, 500)}</p>
        </div>
        <a href="${baseUrl}/admin/reclamations/${claimId}"
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Examiner la réclamation
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
  const shopName = await getCachedShopName();

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const statusLabels: Record<string, string> = {
    IN_REVIEW: "en cours d'examen",
    ACCEPTED: "acceptee",
    REJECTED: "refusee",
    RETURN_PENDING: "en attente de retour",
    RESOLVED: "resolue",
    CLOSED: "cloturee",
  };

  await sendMail({
    fromName: shopName || "Boutique",
    to: clientEmail,
    subject: `Réclamation ${claimReference} — ${statusLabels[newStatus] || newStatus}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Bonjour ${escapeHtml(clientName)},</h2>
        <p>Votre réclamation <strong>${escapeHtml(claimReference)}</strong> est maintenant <strong>${statusLabels[newStatus] || newStatus}</strong>.</p>
        ${message ? `<div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;"><p style="margin:0;">${escapeHtml(message)}</p></div>` : ''}
        <a href="${baseUrl}/espace-pro/reclamations/${claimId}"
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Voir la réclamation
        </a>
      </div>
    `,
  });
}

// ─────────────────────────────────────────────
// Notification admin — nouvelle commande
// ─────────────────────────────────────────────

interface NewOrderAdminData {
  orderId: string;
  pdfBuffer?: Buffer | null;
}

/**
 * Envoi un email à l'admin dès qu'une nouvelle commande est passée.
 * Fire-and-forget — les erreurs sont loggées, jamais propagées.
 */
export async function notifyAdminNewOrder(
  data: NewOrderAdminData
): Promise<void> {
  try {
    const [shopName, notifyEmail] = await Promise.all([
      getCachedShopName(),
      resolveNotifyEmail(),
    ]);
    if (!notifyEmail) {
      logger.warn("[new-order-admin] Aucun email destinataire configuré — email ignoré.");
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: data.orderId },
      include: {
        items: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!order) {
      logger.warn("[new-order-admin] Commande introuvable", { orderId: data.orderId });
      return;
    }

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

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
        <div style="background:#1A1A1A;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">🛒 Nouvelle commande reçue</h2>
          <p style="margin:6px 0 0;opacity:0.85;font-size:13px;">N° ${escapeHtml(order.orderNumber)}</p>
        </div>
        <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px;">
            <tr style="background:#F3F4F6;">
              <td style="padding:10px 14px;font-weight:bold;width:40%;">Client</td>
              <td style="padding:10px 14px;">${escapeHtml(order.clientCompany || "")}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-weight:bold;">Email</td>
              <td style="padding:10px 14px;">${escapeHtml(order.clientEmail)}</td>
            </tr>
            <tr style="background:#F3F4F6;">
              <td style="padding:10px 14px;font-weight:bold;">Téléphone</td>
              <td style="padding:10px 14px;">${escapeHtml(order.clientPhone || "")}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-weight:bold;">Livraison</td>
              <td style="padding:10px 14px;">${escapeHtml(order.shipAddress1)}, ${escapeHtml(order.shipZipCode)} ${escapeHtml(order.shipCity)} (${escapeHtml(order.shipCountry)})</td>
            </tr>
            <tr style="background:#F3F4F6;">
              <td style="padding:10px 14px;font-weight:bold;">Transporteur</td>
              <td style="padding:10px 14px;">${escapeHtml(order.carrierName || "—")}</td>
            </tr>
          </table>

          <h3 style="font-size:13px;color:#6B6B6B;text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 10px;">
            Articles commandés
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

          <table style="width:240px;margin-left:auto;margin-top:12px;border-collapse:collapse;font-size:13px;">
            <tr>
              <td style="padding:4px 0;color:#6B6B6B;">Sous-total HT</td>
              <td style="padding:4px 0;text-align:right;">${Number(order.subtotalHT).toFixed(2)} €</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B6B6B;">TVA</td>
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

          <div style="text-align:center;margin-top:28px;">
            <a href="${baseUrl}/admin/commandes/${order.id}"
               style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
              Voir la commande →
            </a>
          </div>
        </div>

        <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
          ${escapeHtml(shopName)} — Notification automatique
        </p>
      </div>
    `;

    const attachments: { filename: string; content: Buffer }[] = [];
    if (data.pdfBuffer) {
      attachments.push({
        filename: `Commande-${order.orderNumber}.pdf`,
        content: data.pdfBuffer,
      });
    }

    await sendMail({
      fromName: shopName,
      to: notifyEmail,
      subject: `🛒 Nouvelle commande ${order.orderNumber} — ${order.clientCompany || order.clientEmail}`,
      html,
      attachments,
    });
  } catch (err) {
    logger.error("[new-order-admin] Erreur envoi email", { detail: err instanceof Error ? err.message : String(err) });
  }
}

// ─────────────────────────────────────────────
// Notifications client — validation / refus du compte
// ─────────────────────────────────────────────

/**
 * Envoyé au client quand l'admin approuve son inscription.
 * Fire-and-forget — toute erreur est loguée mais jamais propagée.
 */
export async function notifyClientAccountApproved(params: {
  email: string;
  firstName: string;
}): Promise<void> {
  try {
    const shopName = await getCachedShopName();
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    await sendMail({
      fromName: shopName,
      to: params.email,
      subject: `Votre compte a été validé — ${shopName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
          <div style="background:#16A34A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">✅</div>
            <h2 style="margin:0;font-size:20px;">Bienvenue sur ${escapeHtml(shopName)}</h2>
          </div>
          <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
            <p style="font-size:15px;line-height:1.6;">
              Bonjour <strong>${escapeHtml(params.firstName)}</strong>,
            </p>
            <p style="font-size:15px;line-height:1.6;">
              Bonne nouvelle : votre compte professionnel a été validé par notre équipe.
              Vous pouvez maintenant vous connecter, consulter notre catalogue et passer commande.
            </p>
            <div style="text-align:center;margin-top:24px;">
              <a href="${baseUrl}/connexion"
                 style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
                Accéder à la boutique →
              </a>
            </div>
            <p style="margin-top:24px;font-size:13px;color:#6B6B6B;text-align:center;">
              À très vite sur ${escapeHtml(shopName)}.
            </p>
          </div>
          <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
            ${escapeHtml(shopName)} — Email automatique, ne pas répondre.
          </p>
        </div>
      `,
    });
    logger.info("[account-approved] Email envoyé", { to: params.email });
  } catch (err) {
    logger.error("[account-approved] Erreur envoi email", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Envoyé au client quand l'admin refuse son inscription.
 * Fire-and-forget.
 */
export async function notifyClientAccountRejected(params: {
  email: string;
  firstName: string;
  reason?: string | null;
}): Promise<void> {
  try {
    const shopName = await getCachedShopName();
    const companyInfo = await getCachedCompanyInfo();
    const contactEmail = companyInfo?.email || process.env.NOTIFY_EMAIL || null;

    const reasonBlock = params.reason
      ? `<div style="background:#FEF3F2;border:1px solid #FECACA;border-radius:8px;padding:14px 18px;margin:16px 0;">
          <strong style="color:#991B1B;">Motif :</strong>
          <p style="margin:6px 0 0;color:#1A1A1A;white-space:pre-wrap;">${escapeHtml(params.reason)}</p>
        </div>`
      : "";

    const contactBlock = contactEmail
      ? `<p style="margin-top:16px;font-size:13px;color:#6B6B6B;text-align:center;">
          Si vous pensez qu'il s'agit d'une erreur, contactez-nous à
          <a href="mailto:${contactEmail}" style="color:#1A1A1A;">${escapeHtml(contactEmail)}</a>.
        </p>`
      : "";

    await sendMail({
      fromName: shopName,
      to: params.email,
      subject: `Votre demande de compte — ${shopName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
          <div style="background:#1A1A1A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
            <h2 style="margin:0;font-size:20px;">Votre demande d'inscription</h2>
          </div>
          <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
            <p style="font-size:15px;line-height:1.6;">
              Bonjour <strong>${escapeHtml(params.firstName)}</strong>,
            </p>
            <p style="font-size:15px;line-height:1.6;">
              Après examen, nous ne sommes pas en mesure de valider votre compte
              professionnel sur ${escapeHtml(shopName)}.
            </p>
            ${reasonBlock}
            ${contactBlock}
          </div>
          <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
            ${escapeHtml(shopName)} — Email automatique, ne pas répondre.
          </p>
        </div>
      `,
    });
    logger.info("[account-rejected] Email envoyé", { to: params.email });
  } catch (err) {
    logger.error("[account-rejected] Erreur envoi email", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─────────────────────────────────────────────
// Notification client — modification d'articles de commande (P2-08)
// ─────────────────────────────────────────────

interface OrderItemModifiedNotice {
  orderId: string;
  modifications: Array<{
    productName: string;
    originalQuantity: number;
    newQuantity: number;
    reason: "OUT_OF_STOCK" | "CLIENT_REQUEST";
    creditAmount: number; // € HT
  }>;
}

/**
 * Envoyé au client quand l'admin réduit la quantité d'un article (rupture
 * de stock partielle ou demande client). Liste les changements et le crédit
 * éventuel. Fire-and-forget.
 */
export async function notifyClientOrderModified(
  data: OrderItemModifiedNotice,
): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: data.orderId },
      select: { orderNumber: true, clientEmail: true, clientCompany: true, id: true },
    });
    if (!order) {
      logger.warn("[order-modified] Commande introuvable", { orderId: data.orderId });
      return;
    }

    const shopName = await getCachedShopName();
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    const reasonLabels: Record<string, string> = {
      OUT_OF_STOCK: "Rupture de stock",
      CLIENT_REQUEST: "À votre demande",
    };

    const totalCredit = data.modifications.reduce(
      (sum, m) => sum + m.creditAmount,
      0,
    );

    const rows = data.modifications
      .map(
        (m) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E5E5;">
          <strong>${escapeHtml(m.productName)}</strong><br/>
          <small style="color:#6B6B6B;">${escapeHtml(reasonLabels[m.reason] || m.reason)}</small>
        </td>
        <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #E5E5E5;">
          ${m.originalQuantity} → <strong>${m.newQuantity}</strong>
        </td>
        <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #E5E5E5;">
          ${m.creditAmount.toFixed(2)} €
        </td>
      </tr>`,
      )
      .join("");

    await sendMail({
      fromName: shopName,
      to: order.clientEmail,
      subject: `${shopName} — Modification de votre commande ${order.orderNumber}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
          <div style="background:#F59E0B;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
            <div style="font-size:32px;margin-bottom:8px;">📝</div>
            <h2 style="margin:0;font-size:20px;">Modification de commande</h2>
            <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">N° ${escapeHtml(order.orderNumber)}</p>
          </div>
          <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
            <p style="font-size:15px;line-height:1.6;">
              Bonjour${order.clientCompany ? ` <strong>${escapeHtml(order.clientCompany)}</strong>` : ""},
            </p>
            <p style="font-size:15px;line-height:1.6;">
              Nous avons dû ajuster certains articles de votre commande
              <strong>${escapeHtml(order.orderNumber)}</strong> :
            </p>
            <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px;">
              <thead>
                <tr style="background:#F7F7F8;">
                  <th style="padding:8px 12px;text-align:left;">Article</th>
                  <th style="padding:8px 12px;text-align:center;">Quantité</th>
                  <th style="padding:8px 12px;text-align:right;">Avoir HT</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
              <tfoot>
                <tr style="border-top:2px solid #1A1A1A;">
                  <td colspan="2" style="padding:8px 12px;font-weight:bold;">Total avoir</td>
                  <td style="padding:8px 12px;text-align:right;font-weight:bold;">${totalCredit.toFixed(2)} €</td>
                </tr>
              </tfoot>
            </table>
            <p style="margin-top:20px;font-size:14px;color:#4B5563;">
              Le montant correspondant vous sera remboursé ou crédité prochainement.
            </p>
            <div style="text-align:center;margin-top:24px;">
              <a href="${baseUrl}/commandes/${order.id}"
                 style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
                Voir ma commande →
              </a>
            </div>
          </div>
          <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
            ${escapeHtml(shopName)} — Email automatique, ne pas répondre.
          </p>
        </div>
      `,
    });
    logger.info("[order-modified] Email envoyé", {
      orderId: data.orderId,
      modifications: data.modifications.length,
    });
  } catch (err) {
    logger.error("[order-modified] Erreur envoi email", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
