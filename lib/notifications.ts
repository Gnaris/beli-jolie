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
import { roundCent } from "@/lib/money";
import { decryptIfSensitive } from "@/lib/encryption";
import { derivePublicContactEmail } from "@/lib/public-contact-email";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { buildProductHandle } from "@/lib/product-url";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Retrouve le userId d'un compte client à partir de son email (best-effort).
 * Utilisé pour rattacher les mails transactionnels au journal du client.
 * Retourne null si aucun compte ne correspond (ex. inscription en cours) —
 * dans ce cas le log est écrit sans userId, mais reste consultable via
 * l'email destinataire.
 */
async function resolveUserIdByEmail(email: string): Promise<string | null> {
  try {
    const u = await prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
      select: { id: true },
    });
    return u?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Destinataire des notifications admin (nouvelle commande, inscription…).
 * Priorités :
 * 1. `smtp_from_email` (SiteConfig) — la boîte pro `contact@<domaine>` créée
 *    par le wizard onboarding. Les mails arrivent dans cette boîte puis sont
 *    forwardés par Sieve vers le mail perso de la cliente.
 * 2. `mailbox_forward_to` (SiteConfig) — le mail perso saisi dans le wizard,
 *    utilisé tant que la boîte pro n'est pas encore provisionnée.
 * 3. `CompanyInfo.email` (rétrocompat pour les anciennes boutiques).
 */
export async function resolveNotifyEmail(): Promise<string | null> {
  try {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["smtp_from_email", "mailbox_forward_to"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const smtpFrom = decryptIfSensitive("smtp_from_email", map.get("smtp_from_email") || "").trim();
    if (smtpFrom) return smtpFrom;
    const forwardTo = (map.get("mailbox_forward_to") || "").trim();
    if (forwardTo) return forwardTo;
  } catch {
    // fallback silencieux vers CompanyInfo
  }
  const companyInfo = await getCachedCompanyInfo();
  return companyInfo?.email?.trim() || null;
}

interface NewClientInfo {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  siret: string | null;
  kbisPath?: string; // chemin relatif stocké en base, ex: private/uploads/kbis/kbis_XXX.pdf
  documentPath?: string; // document complémentaire, ex: private/uploads/documents/doc_XXX.pdf
  registrationMessage?: string; // message libre saisi lors de l'inscription
}

export async function notifyNewClientRegistration(
  client: NewClientInfo
): Promise<void> {
  const [shopName, notifyEmail, baseUrl] = await Promise.all([
    getCachedShopName(),
    resolveNotifyEmail(),
    getCurrentTenantBaseUrl(),
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
            <td style="padding:10px 14px;">${client.siret ? escapeHtml(client.siret) : "<em style='color:#9CA3AF;'>Non renseigné (client hors France)</em>"}</td>
          </tr>
          ${messageBlock}
        </table>
        ${kbisNote}
        ${docNote}
        <div style="margin-top:20px;">
          <a href="${baseUrl}/admin/clients"
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
// Notification client — changement de statut commande
// ─────────────────────────────────────────────

interface OrderStatusEmailData {
  orderId: string;
  newStatus: string;
  /** true si des ajustements ont été faits (retraits, ajouts, remise ligne). */
  hasAdjustments?: boolean;
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
      `Nous avons bien reçu votre commande <strong>${escapeHtml(num)}</strong>. Elle sera prise en charge par notre équipe dans les plus brefs délais. Vous recevrez un email dès qu'elle sera expédiée.`,
    color: "#1A1A1A",
    icon: "🧾",
  },
  VALIDATED: {
    subject: (num, shop) => `${shop} — Votre commande ${num} est prête à être expédiée`,
    heading: "Votre commande a été validée",
    message: (num) =>
      `Votre commande <strong>${escapeHtml(num)}</strong> a été validée par notre équipe et est prête à être expédiée. Vous recevrez un nouvel email dès qu'elle sera envoyée.`,
    color: "#2563EB",
    icon: "✅",
  },
  SHIPPED: {
    subject: (num, shop) => `${shop} — Commande ${num} expédiée`,
    heading: "Votre commande a été expédiée",
    message: (num) =>
      `Votre commande <strong>${escapeHtml(num)}</strong> a été expédiée ! Elle est en route vers votre adresse de livraison.`,
    color: "#374151",
    icon: "🚚",
  },
  CANCELLED: {
    subject: (num, shop) => `${shop} — Commande ${num} annulée`,
    heading: "Votre commande a été annulée",
    message: (num) =>
      `Votre commande <strong>${escapeHtml(num)}</strong> a été annulée. Si vous avez des questions, n'hésitez pas à nous contacter.`,
    color: "#DC2626",
    icon: "❌",
  },
  BANK_TRANSFER_PENDING: {
    subject: (num, shop) => `${shop} — Commande ${num} en attente de votre virement`,
    heading: "Merci pour votre commande",
    message: (num) =>
      `Nous avons bien enregistré votre commande <strong>${escapeHtml(num)}</strong>. Pour finaliser, il vous reste à effectuer votre virement bancaire aux coordonnées ci-dessous. La commande sera préparée et expédiée dès réception du virement.`,
    color: "#D97706",
    icon: "🏦",
  },
  BANK_TRANSFER_CONFIRMED: {
    subject: (num, shop) => `${shop} — Virement reçu, commande ${num} en préparation`,
    heading: "Nous avons bien reçu votre virement",
    message: (num) =>
      `Votre virement pour la commande <strong>${escapeHtml(num)}</strong> a bien été reçu. Elle est désormais en cours de préparation et sera expédiée sous peu — vous recevrez un email dès qu'elle sera en route.`,
    color: "#059669",
    icon: "✅",
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

    const baseUrl = await getCurrentTenantBaseUrl();

    // Bloc coordonnées bancaires (uniquement email « virement en attente »).
    // Chargé ici pour rester tenant-scopé (ALS actif dans notifyOrderStatusChange).
    let bankTransferHtml = "";
    if (data.newStatus === "BANK_TRANSFER_PENDING") {
      try {
        const { getCachedBankTransferConfig, formatIbanForDisplay } = await import(
          "@/lib/bank-transfer-config"
        );
        const btConfig = await getCachedBankTransferConfig();
        if (btConfig.enabled && btConfig.holder && btConfig.iban) {
          const displayIban = formatIbanForDisplay(btConfig.iban);
          const totalTTC = Number(order.totalTTC).toFixed(2);
          bankTransferHtml = `
            <div style="background:#0F172A;color:#fff;border-radius:12px;padding:22px;margin:20px 0;">
              <div style="text-transform:uppercase;letter-spacing:2px;font-size:11px;opacity:0.7;margin-bottom:14px;">Coordonnées bancaires</div>
              <div style="margin-bottom:14px;">
                <div style="opacity:0.6;font-size:11px;margin-bottom:4px;">Titulaire du compte</div>
                <div style="font-size:15px;font-weight:bold;">${escapeHtml(btConfig.holder)}</div>
              </div>
              <div style="margin-bottom:14px;">
                <div style="opacity:0.6;font-size:11px;margin-bottom:4px;">IBAN</div>
                <div style="font-size:14px;letter-spacing:2px;font-family:monospace;">${escapeHtml(displayIban)}</div>
              </div>
              <div style="padding-top:14px;border-top:1px solid rgba(255,255,255,0.1);">
                <div style="opacity:0.6;font-size:11px;margin-bottom:4px;">Montant à virer</div>
                <div style="font-size:22px;font-weight:bold;">${totalTTC} €</div>
              </div>
            </div>
            <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:14px 18px;margin:16px 0;">
              <strong style="color:#78350F;">⚠️ Important — libellé du virement</strong><br/>
              <span style="color:#78350F;font-size:13px;">Indiquez impérativement <strong style="font-family:monospace;background:#fff;padding:2px 6px;border-radius:4px;">${escapeHtml(order.orderNumber)}</strong> dans le libellé de votre virement, sans quoi l'identification pourra prendre plusieurs jours.</span>
            </div>`;
        }
      } catch (err) {
        logger.error("[order-status-email] Chargement config virement", { error: err });
      }
    }

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

          ${
            data.newStatus === "VALIDATED" && data.hasAdjustments
              ? `<div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:14px 18px;margin:16px 0;">
                  <strong style="color:#9A3412;">Quelques ajustements ont été apportés</strong><br/>
                  <span style="color:#9A3412;font-size:13px;">Retrouvez le détail complet en vous connectant à votre espace commandes.</span>
                </div>`
              : ""
          }

          ${bankTransferHtml}

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

            <!-- Totaux (TVA détaillée : articles / port) -->
            ${(() => {
              const subHT = Number(order.subtotalHT);
              const carrierHT = Number(order.carrierPrice);
              const rate = order.tvaRate;
              const tvaProducts = roundCent(subHT * rate);
              const tvaShipping = roundCent(carrierHT * rate);
              const tvaTotal = roundCent((subHT + carrierHT) * rate);
              const total = roundCent(subHT + carrierHT + tvaTotal);
              const rateLabel = rate === 0 ? "exonéré" : `${(rate * 100).toFixed(0)}%`;
              return `<table style="width:240px;margin-left:auto;margin-top:12px;border-collapse:collapse;font-size:13px;">
              <tr>
                <td style="padding:4px 0;color:#6B6B6B;">Sous-total HT</td>
                <td style="padding:4px 0;text-align:right;">${subHT.toFixed(2)} €</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B6B6B;">Frais de port HT</td>
                <td style="padding:4px 0;text-align:right;">${carrierHT === 0 ? "Gratuit" : `${carrierHT.toFixed(2)} €`}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B6B6B;">TVA sur articles (${rateLabel})</td>
                <td style="padding:4px 0;text-align:right;">${tvaProducts.toFixed(2)} €</td>
              </tr>
              ${carrierHT > 0 && rate > 0 ? `<tr>
                <td style="padding:4px 0;color:#6B6B6B;">TVA sur port (${rateLabel})</td>
                <td style="padding:4px 0;text-align:right;">${tvaShipping.toFixed(2)} €</td>
              </tr>` : ""}
              <tr style="border-top:2px solid #1A1A1A;">
                <td style="padding:8px 0;font-weight:bold;">Total TTC</td>
                <td style="padding:8px 0;text-align:right;font-weight:bold;">${total.toFixed(2)} €</td>
              </tr>
            </table>`;
            })()}
          </div>

          <!-- Lien espace client -->
          <div style="text-align:center;margin-top:28px;">
            <a href="${baseUrl}/fr/commandes/${order.id}"
               style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
              Voir ma commande →
            </a>
          </div>

          ${await (async () => {
            const publicEmail = await derivePublicContactEmail(companyInfo?.email);
            return publicEmail
              ? `<p style="margin-top:24px;font-size:13px;color:#6B6B6B;text-align:center;">
            Une question ? Contactez-nous à <a href="mailto:${publicEmail}" style="color:${config.color};">${escapeHtml(publicEmail)}</a>
          </p>`
              : "";
          })()}
        </div>

        <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
          ${escapeHtml(shopName)} — Cet email a été envoyé automatiquement suite à la mise à jour de votre commande.
        </p>
      </div>
    `;

    const scenarioKey =
      data.newStatus === "PENDING" ? "ORDER_CREATED"
      : data.newStatus === "VALIDATED" ? "ORDER_VALIDATED"
      : data.newStatus === "SHIPPED" ? "ORDER_SHIPPED"
      : data.newStatus === "CANCELLED" ? "ORDER_CANCELLED"
      : data.newStatus === "BANK_TRANSFER_PENDING" ? "ORDER_CREATED"
      : data.newStatus === "BANK_TRANSFER_CONFIRMED" ? "ORDER_VALIDATED"
      : null;

    const userId = await resolveUserIdByEmail(order.clientEmail);

    await sendMail({
      fromName: shopName,
      to: order.clientEmail,
      subject: config.subject(order.orderNumber, shopName),
      html,
      tracking: scenarioKey ? {
        scenarioKey,
        userId,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          newStatus: data.newStatus,
          hasAdjustments: data.hasAdjustments ?? false,
        },
      } : undefined,
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
  const baseUrl = await getCurrentTenantBaseUrl();

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
 * Contexte du mail : distingue le chat flottant (widget SUPPORT) de la
 * conversation liée à une réclamation. Sert seulement à construire le
 * bon lien de retour.
 */
export type SupportReplyContext = "chat" | "claim";

/**
 * Envoie au client le mail « un admin vous a répondu ».
 *
 * Template volontairement générique (pas de preview du message) : la cliente
 * veut forcer le retour sur le site. Utilisé par le système de notification
 * différée `lib/support-notify.ts` (chronomètre 5 min avec présence + lecture).
 */
export async function sendGenericSupportReplyEmail(params: {
  clientEmail: string;
  clientName: string;
  conversationId: string;
  context: SupportReplyContext;
  claimId?: string;
}) {
  const { clientEmail, clientName, conversationId, context, claimId } = params;
  const shopName = await getCachedShopName();
  const baseUrl = await getCurrentTenantBaseUrl();

  const userId = await resolveUserIdByEmail(clientEmail);

  const conversationUrl =
    context === "claim" && claimId
      ? `${baseUrl}/fr/espace-pro/service-client/${claimId}`
      : `${baseUrl}/fr/espace-pro`;

  const displayName = clientName?.trim() || "";
  const greeting = displayName ? `Bonjour ${escapeHtml(displayName)},` : "Bonjour,";

  await sendMail({
    fromName: shopName || "Boutique",
    to: clientEmail,
    subject: `Un administrateur vous a répondu — ${shopName || "Service Client"}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">${greeting}</h2>
        <p>Un administrateur vous a répondu sur votre Service Client.</p>
        <p>Connectez-vous à votre espace pour lire sa réponse et lui répondre.</p>
        <a href="${conversationUrl}"
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:12px;">
          Voir la conversation
        </a>
        <p style="color:#71717A;font-size:12px;margin-top:24px;">
          Vous recevez ce message parce que vous avez ouvert une conversation
          avec le Service Client de ${escapeHtml(shopName || "notre boutique")}.
        </p>
      </div>
    `,
    tracking: {
      scenarioKey: "SUPPORT_REPLY",
      userId,
      metadata: { conversationId, context, claimId },
    },
  });

  logger.info(
    `[Notifications] Client ${clientEmail} notifié — nouvelle réponse (${context})`,
  );
}

/**
 * Notif admin — nouveau ticket Service Client.
 * Envoyé automatiquement à `smtp_from_email` (mail pro du tenant)
 * à chaque ouverture (ou réouverture) de conversation par un client.
 */
export async function notifyAdminNewClaim(params: {
  clientName: string;
  clientCompany: string;
  claimReference: string;
  subject: string;
  messagePreview: string;
  claimId: string;
  orderNumber?: string;
  reportedItems?: { productName: string; productRef: string; quantity: number }[];
}) {
  const {
    clientName,
    clientCompany,
    claimReference,
    subject,
    messagePreview,
    claimId,
    orderNumber,
    reportedItems,
  } = params;
  const [shopName, notifyEmail] = await Promise.all([
    getCachedShopName(),
    resolveNotifyEmail(),
  ]);
  if (!notifyEmail) return;

  const baseUrl = await getCurrentTenantBaseUrl();

  const orderRow = orderNumber
    ? `<tr><td style="padding:8px;font-weight:bold;">Commande</td><td style="padding:8px;font-family:monospace;">${escapeHtml(orderNumber)}</td></tr>`
    : "";

  const reportedItemsBlock =
    reportedItems && reportedItems.length > 0
      ? `
        <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0 0 8px 0;font-weight:bold;color:#78350f;text-transform:uppercase;font-size:11px;letter-spacing:1px;">
            Articles signalés
          </p>
          <ul style="margin:0;padding-left:20px;color:#78350f;">
            ${reportedItems
              .map(
                (it) => `
              <li style="margin:4px 0;">
                <strong>${escapeHtml(it.productName)}</strong>
                <span style="font-family:monospace;color:#92400e;"> (${escapeHtml(it.productRef)})</span>
                — <strong>${it.quantity}</strong> à signaler
              </li>
            `,
              )
              .join("")}
          </ul>
        </div>`
      : "";

  await sendMail({
    fromName: shopName || "Boutique",
    to: notifyEmail,
    subject: `Nouvelle demande (Service Client) ${claimReference} — ${clientCompany || clientName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Nouvelle demande — Service Client</h2>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px;font-weight:bold;">Référence</td><td style="padding:8px;">${escapeHtml(claimReference)}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Client</td><td style="padding:8px;">${escapeHtml(clientName)}${clientCompany ? ` (${escapeHtml(clientCompany)})` : ""}</td></tr>
          ${orderRow}
          <tr><td style="padding:8px;font-weight:bold;">Sujet</td><td style="padding:8px;">${escapeHtml(subject)}</td></tr>
        </table>
        ${reportedItemsBlock}
        <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#333;white-space:pre-wrap;">${escapeHtml(messagePreview).substring(0, 500)}</p>
        </div>
        <a href="${baseUrl}/admin/service-client/${claimId}"
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Ouvrir la conversation
        </a>
      </div>
    `,
  });

  logger.info(`[Notifications] Admin notifié — nouvelle demande ${claimReference}`);
}


// ─────────────────────────────────────────────
// Notification admin — nouvelle commande
// ─────────────────────────────────────────────

interface NewOrderAdminData {
  orderId: string;
}

/**
 * Envoi un email de notification à l'admin dès qu'une nouvelle commande est
 * passée. Volontairement minimal : n° de commande, client, montant, lien vers
 * l'admin. Pas de PDF joint ni de détail des articles (elle consulte la
 * commande complète en cliquant sur le bouton).
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
      select: {
        id: true,
        orderNumber: true,
        clientCompany: true,
        clientEmail: true,
        clientPhone: true,
        subtotalHT: true,
        carrierPrice: true,
        tvaRate: true,
      },
    });
    if (!order) {
      logger.warn("[new-order-admin] Commande introuvable", { orderId: data.orderId });
      return;
    }

    const baseUrl = await getCurrentTenantBaseUrl();
    const subHT = Number(order.subtotalHT);
    const carrierHT = Number(order.carrierPrice);
    const tva = roundCent((subHT + carrierHT) * order.tvaRate);
    const totalTTC = roundCent(subHT + carrierHT + tva);
    const clientLabel = order.clientCompany?.trim() || order.clientEmail;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
        <div style="background:#1A1A1A;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">🛒 Nouvelle commande reçue</h2>
          <p style="margin:6px 0 0;opacity:0.85;font-size:13px;">N° ${escapeHtml(order.orderNumber)}</p>
        </div>
        <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
          <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
            <strong>${escapeHtml(clientLabel)}</strong> vient de passer commande.
          </p>
          <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
            Montant total : <strong>${totalTTC.toFixed(2)} € TTC</strong>
          </p>
          <div style="text-align:center;">
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

    await sendMail({
      fromName: shopName,
      to: notifyEmail,
      subject: `🛒 Nouvelle commande ${order.orderNumber} — ${clientLabel}`,
      html,
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
    const baseUrl = await getCurrentTenantBaseUrl();

    const userId = await resolveUserIdByEmail(params.email);
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
              <a href="${baseUrl}/fr/connexion"
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
      tracking: {
        scenarioKey: "ACCOUNT_APPROVED",
        userId,
        metadata: { firstName: params.firstName },
      },
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
    const contactEmail = companyInfo?.email?.trim() || null;

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

    const userId = await resolveUserIdByEmail(params.email);
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
      tracking: {
        scenarioKey: "ACCOUNT_REJECTED",
        userId,
        metadata: {
          firstName: params.firstName,
          reason: params.reason ?? null,
        },
      },
    });
    logger.info("[account-rejected] Email envoyé", { to: params.email });
  } catch (err) {
    logger.error("[account-rejected] Erreur envoi email", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Envoyé au client quand l'admin révoque l'accès d'un compte déjà validé
 * (APPROVED → REJECTED). Distinct de `notifyClientAccountRejected` qui, lui,
 * s'adresse à une première demande d'inscription refusée : ici le client
 * connaissait déjà la boutique, donc le ton et le contenu diffèrent
 * (« compte désactivé » plutôt que « inscription refusée »).
 * Fire-and-forget.
 */
export async function notifyClientAccountRevoked(params: {
  email: string;
  firstName: string;
  reason?: string | null;
}): Promise<void> {
  try {
    const shopName = await getCachedShopName();
    const companyInfo = await getCachedCompanyInfo();
    const contactEmail = companyInfo?.email?.trim() || null;

    const reasonBlock = params.reason
      ? `<div style="background:#FEF3F2;border:1px solid #FECACA;border-radius:8px;padding:14px 18px;margin:16px 0;">
          <strong style="color:#991B1B;">Motif :</strong>
          <p style="margin:6px 0 0;color:#1A1A1A;white-space:pre-wrap;">${escapeHtml(params.reason)}</p>
        </div>`
      : "";

    const contactBlock = contactEmail
      ? `<p style="margin-top:16px;font-size:13px;color:#6B6B6B;text-align:center;">
          Pour toute question ou pour demander la réactivation de votre compte,
          contactez-nous à
          <a href="mailto:${contactEmail}" style="color:#1A1A1A;">${escapeHtml(contactEmail)}</a>.
        </p>`
      : "";

    const userId = await resolveUserIdByEmail(params.email);
    await sendMail({
      fromName: shopName,
      to: params.email,
      subject: `Votre compte a été désactivé — ${shopName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
          <div style="background:#1A1A1A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
            <h2 style="margin:0;font-size:20px;">Votre compte a été désactivé</h2>
          </div>
          <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
            <p style="font-size:15px;line-height:1.6;">
              Bonjour <strong>${escapeHtml(params.firstName)}</strong>,
            </p>
            <p style="font-size:15px;line-height:1.6;">
              Nous vous informons que votre compte professionnel sur
              ${escapeHtml(shopName)} a été désactivé.
              Vous ne pouvez plus vous connecter ni passer commande jusqu'à
              nouvel ordre.
            </p>
            ${reasonBlock}
            ${contactBlock}
          </div>
          <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
            ${escapeHtml(shopName)} — Email automatique, ne pas répondre.
          </p>
        </div>
      `,
      tracking: {
        scenarioKey: "ACCOUNT_REVOKED",
        userId,
        metadata: {
          firstName: params.firstName,
          reason: params.reason ?? null,
        },
      },
    });
    logger.info("[account-revoked] Email envoyé", { to: params.email });
  } catch (err) {
    logger.error("[account-revoked] Erreur envoi email", {
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
    reason: "OUT_OF_STOCK" | "CLIENT_REQUEST" | "COMMERCIAL_GESTURE";
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
    const baseUrl = await getCurrentTenantBaseUrl();

    const reasonLabels: Record<string, string> = {
      OUT_OF_STOCK: "Rupture de stock",
      CLIENT_REQUEST: "À votre demande",
      COMMERCIAL_GESTURE: "Geste commercial",
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

    const userId = await resolveUserIdByEmail(order.clientEmail);
    await sendMail({
      fromName: shopName,
      to: order.clientEmail,
      subject: `${shopName} — Modification de votre commande ${order.orderNumber}`,
      tracking: {
        scenarioKey: "ORDER_MODIFIED",
        userId,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          modificationsCount: data.modifications.length,
          totalCredit,
        },
      },
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
              <a href="${baseUrl}/fr/commandes/${order.id}"
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

/**
 * Envoyé au client quand il demande un lien de paiement Stripe direct depuis
 * le tunnel (fallback si son navigateur bloque l'iframe Stripe : antivirus,
 * extension anti-pub, VPN d'entreprise…). Le lien pointe vers
 * `checkout.stripe.com`, hors iframe, moins bloqué. Fire-and-forget : on log
 * les erreurs mais on ne casse jamais la génération du lien côté API.
 */
export async function notifyClientPaymentLink(params: {
  email: string;
  firstName?: string | null;
  amountTTC: number;
  url: string;
  expiresAt: Date;
  /** N° de commande à afficher dans l'en-tête + subject (facultatif). */
  orderNumber?: string | null;
}): Promise<void> {
  try {
    const shopName = await getCachedShopName();
    const amountStr = params.amountTTC.toFixed(2);
    const expiresStr = params.expiresAt.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    const greeting = params.firstName
      ? `Bonjour <strong>${escapeHtml(params.firstName)}</strong>,`
      : "Bonjour,";
    const orderTag = params.orderNumber
      ? `<p style="margin:8px 0 0;opacity:0.85;font-size:13px;">N° ${escapeHtml(params.orderNumber)}</p>`
      : "";
    const subjectSuffix = params.orderNumber ? ` — Commande ${params.orderNumber}` : "";

    const userId = await resolveUserIdByEmail(params.email);
    await sendMail({
      fromName: shopName,
      to: params.email,
      subject: `${shopName} — Votre lien de paiement sécurisé (${amountStr} €)${subjectSuffix}`,
      tracking: {
        scenarioKey: "CHECKOUT_PAYMENT_LINK",
        userId,
        metadata: {
          amountTTC: params.amountTTC,
          expiresAt: params.expiresAt.toISOString(),
          orderNumber: params.orderNumber ?? null,
        },
      },
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
          <div style="background:#0F172A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
            <div style="font-size:32px;margin-bottom:8px;">🔒</div>
            <h2 style="margin:0;font-size:20px;">Votre lien de paiement</h2>
            ${orderTag}
          </div>
          <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
            <p style="font-size:15px;line-height:1.6;">${greeting}</p>
            <p style="font-size:15px;line-height:1.6;">
              Votre commande chez <strong>${escapeHtml(shopName)}</strong> a été
              enregistrée. Pour la régler, cliquez sur le bouton ci-dessous — vous
              serez redirigé vers la page sécurisée de notre prestataire Stripe.
            </p>
            <div style="background:#F7F7F8;border:1px solid #E5E5E5;border-radius:8px;padding:16px;margin:20px 0;text-align:center;">
              <div style="font-size:12px;color:#6B6B6B;text-transform:uppercase;letter-spacing:1px;">Montant à régler</div>
              <div style="font-size:28px;font-weight:bold;margin-top:4px;">${amountStr} €</div>
            </div>
            <div style="text-align:center;margin:24px 0;">
              <a href="${escapeHtml(params.url)}"
                 style="background:#0F172A;color:#ffffff;padding:14px 32px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;font-size:15px;">
                Payer maintenant →
              </a>
            </div>
            <p style="font-size:12px;color:#6B6B6B;text-align:center;line-height:1.5;">
              Lien valable jusqu'au <strong>${escapeHtml(expiresStr)}</strong>.<br/>
              Si le bouton ne fonctionne pas, copiez-collez cette adresse dans votre navigateur :<br/>
              <span style="word-break:break-all;color:#334155;">${escapeHtml(params.url)}</span>
            </p>
            <p style="font-size:12px;color:#6B6B6B;text-align:center;margin-top:16px;">
              Ce lien est aussi accessible depuis votre espace commandes tant que
              la commande reste en attente de paiement.
            </p>
          </div>
          <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
            ${escapeHtml(shopName)} — Email automatique, ne pas répondre.
          </p>
        </div>
      `,
    });
    logger.info("[checkout-payment-link] Email envoyé", { to: params.email, amount: params.amountTTC });
  } catch (err) {
    logger.error("[checkout-payment-link] Erreur envoi email", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
