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
import { renderTransactionalEmail } from "@/lib/transactional-email-render";
import { isAdminEmailEnabled } from "@/lib/push-preferences-server";
import {
  clientRegistrationStatusLabel,
  type ClientRegistrationStatus,
} from "@/lib/registration-status-label";

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
  /** Statut final décidé par les règles d'inscription — permet de dire dans
   *  le mail si le dossier attend une validation manuelle ou s'il a été
   *  tranché automatiquement. Défaut PENDING pour rétrocompat. */
  status?: ClientRegistrationStatus;
}

export async function notifyNewClientRegistration(
  client: NewClientInfo
): Promise<void> {
  if (!(await isAdminEmailEnabled("client_new"))) return;
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

  const status: ClientRegistrationStatus = client.status ?? "PENDING";
  const statusLabel = clientRegistrationStatusLabel(status);
  // Bandeau coloré en haut du mail : vert = validé auto, ambre = attente,
  // rouge = refusé auto. Permet de repérer en 1 coup d'œil quoi faire.
  const STATUS_COLORS: Record<ClientRegistrationStatus, { bg: string; border: string; text: string }> = {
    APPROVED: { bg: "#ECFDF5", border: "#A7F3D0", text: "#065F46" },
    PENDING:  { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E" },
    REJECTED: { bg: "#FEF2F2", border: "#FECACA", text: "#991B1B" },
  };
  const sc = STATUS_COLORS[status];
  const statusBlock = `<div style="margin:16px 0;padding:12px 16px;background:${sc.bg};border:1px solid ${sc.border};border-radius:8px;color:${sc.text};font-size:13px;font-weight:bold;">Statut du dossier : ${escapeHtml(statusLabel)}</div>`;

  const rendered = await renderTransactionalEmail({
    scenarioKey: "ADMIN_NEW_REGISTRATION",
    vars: {
      firstName: escapeHtml(client.firstName),
      lastName: escapeHtml(client.lastName),
      company: escapeHtml(client.company),
      email: escapeHtml(client.email),
      phone: escapeHtml(client.phone),
      siret: client.siret
        ? escapeHtml(client.siret)
        : "<em style='color:#9CA3AF;'>Non renseigné (client hors France)</em>",
      messageBlock,
      kbisNote,
      docNote,
      statusLabel: escapeHtml(statusLabel),
      statusBlock,
      adminUrl: `${baseUrl}/admin/clients`,
      shopName: escapeHtml(shopName),
    },
  });

  await sendMail({
    fromName: shopName,
    to: notifyEmail,
    subject: rendered.subject,
    html: rendered.html,
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

// Mapping statut → clé de scénario éditable.
const STATUS_TO_SCENARIO = {
  PENDING: "ORDER_CREATED",
  BANK_TRANSFER_PENDING: "ORDER_BANK_TRANSFER_PENDING",
  VALIDATED: "ORDER_VALIDATED",
  BANK_TRANSFER_CONFIRMED: "ORDER_BANK_TRANSFER_CONFIRMED",
  SHIPPED: "ORDER_SHIPPED",
  CANCELLED: "ORDER_CANCELLED",
} as const;

type OrderStatusKey = keyof typeof STATUS_TO_SCENARIO;

/**
 * Send an email to the client when order status changes.
 * Fire-and-forget — errors are logged but never propagated.
 */
export async function notifyOrderStatusChange(
  data: OrderStatusEmailData
): Promise<void> {
  try {
    const scenarioKey = STATUS_TO_SCENARIO[data.newStatus as OrderStatusKey];
    if (!scenarioKey) return;

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

    // Pré-rendu du bloc totaux (TVA détaillée).
    const totalsHtml = ((): string => {
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
    })();

    const adjustmentsHtml =
      data.newStatus === "VALIDATED" && data.hasAdjustments
        ? `<div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:14px 18px;margin:16px 0;">
            <strong style="color:#9A3412;">Quelques ajustements ont été apportés</strong><br/>
            <span style="color:#9A3412;font-size:13px;">Retrouvez le détail complet en vous connectant à votre espace commandes.</span>
          </div>`
        : "";

    const userId = await resolveUserIdByEmail(order.clientEmail);

    const rendered = await renderTransactionalEmail({
      scenarioKey,
      vars: {
        orderNumber: escapeHtml(order.orderNumber),
        clientCompany: order.clientCompany ? ` <strong>${escapeHtml(order.clientCompany)}</strong>` : "",
        itemsHtml,
        totalsHtml,
        bankTransferHtml,
        trackingHtml,
        adjustmentsHtml,
        orderUrl: `${baseUrl}/fr/commandes/${order.id}`,
        shopName: escapeHtml(shopName),
      },
    });

    // Note : le bloc "contact" dépendant du publicEmail reste géré ici car il
    // n'était pas éditable par la cliente auparavant. Si pas de public email,
    // le mail part sans — comportement inchangé.
    void (await derivePublicContactEmail(companyInfo?.email));

    // Mapping tracking historique (EmailSend) : les variantes
    // BANK_TRANSFER_* restent tracées sous ORDER_CREATED / ORDER_VALIDATED
    // pour ne pas casser l'historique des envois (continuity analytics).
    const trackingScenarioKey:
      | "ORDER_CREATED"
      | "ORDER_VALIDATED"
      | "ORDER_SHIPPED"
      | "ORDER_CANCELLED" =
      scenarioKey === "ORDER_BANK_TRANSFER_PENDING"
        ? "ORDER_CREATED"
        : scenarioKey === "ORDER_BANK_TRANSFER_CONFIRMED"
          ? "ORDER_VALIDATED"
          : scenarioKey;

    await sendMail({
      fromName: shopName,
      to: order.clientEmail,
      subject: rendered.subject,
      html: rendered.html,
      tracking: {
        scenarioKey: trackingScenarioKey,
        userId,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          newStatus: data.newStatus,
          hasAdjustments: data.hasAdjustments ?? false,
        },
      },
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
  if (!(await isAdminEmailEnabled("chat_message"))) return;
  const [shopName, notifyEmail] = await Promise.all([
    getCachedShopName(),
    resolveNotifyEmail(),
  ]);
  if (!notifyEmail) return;

  const ref = `CONV-${conversationId.slice(-8).toUpperCase()}`;
  const baseUrl = await getCurrentTenantBaseUrl();

  const rendered = await renderTransactionalEmail({
    scenarioKey: "ADMIN_NEW_MESSAGE",
    vars: {
      clientName: escapeHtml(clientName),
      clientCompany: escapeHtml(clientCompany),
      subject: escapeHtml(subject),
      messagePreview: escapeHtml(messagePreview).substring(0, 500),
      adminUrl: `${baseUrl}/admin`,
      shopName: escapeHtml(shopName ?? ""),
    },
  });

  await sendMail({
    fromName: shopName || "Boutique",
    to: notifyEmail,
    subject: `[${ref}] ${rendered.subject}`,
    html: rendered.html,
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

  const rendered = await renderTransactionalEmail({
    scenarioKey: "SUPPORT_REPLY",
    vars: {
      greeting,
      conversationUrl,
      shopName: escapeHtml(shopName || "notre boutique"),
    },
  });

  await sendMail({
    fromName: shopName || "Boutique",
    to: clientEmail,
    subject: rendered.subject,
    html: rendered.html,
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
 * Envoie à l'admin le mail « un client a répondu dans sa conversation ».
 *
 * Symétrique de `sendGenericSupportReplyEmail`, destiné à l'admin de la
 * boutique (adresse `resolveNotifyEmail`). Déclenché par le même worker
 * `support-email-worker.ts` quand un `PendingSupportEmail` avec
 * `recipientRole = ADMIN` arrive à échéance.
 */
export async function sendGenericAdminReplyEmail(params: {
  clientName: string;
  clientCompany: string;
  conversationId: string;
  context: SupportReplyContext;
  claimId?: string;
}): Promise<boolean> {
  const { clientName, clientCompany, conversationId, context, claimId } = params;
  if (!(await isAdminEmailEnabled("chat_message"))) return false;
  const [shopName, notifyEmail, baseUrl] = await Promise.all([
    getCachedShopName(),
    resolveNotifyEmail(),
    getCurrentTenantBaseUrl(),
  ]);
  if (!notifyEmail) {
    logger.warn("[Notifications] Aucun email admin configuré — mail client-a-répondu ignoré.");
    return false;
  }

  const conversationUrl =
    context === "claim" && claimId
      ? `${baseUrl}/admin/service-client/${claimId}`
      : `${baseUrl}/admin`;

  const displayName = clientName?.trim() || "Un client";
  const companySuffix = clientCompany?.trim() ? ` (${escapeHtml(clientCompany.trim())})` : "";

  const rendered = await renderTransactionalEmail({
    scenarioKey: "ADMIN_CLIENT_REPLIED",
    vars: {
      clientName: escapeHtml(displayName),
      companySuffix,
      conversationUrl,
      shopName: escapeHtml(shopName || "Service Client"),
    },
  });

  await sendMail({
    fromName: shopName || "Boutique",
    to: notifyEmail,
    subject: rendered.subject,
    html: rendered.html,
  });

  logger.info(
    `[Notifications] Admin notifié — ${displayName} a répondu — conv ${conversationId} (${context}${claimId ? ` claim=${claimId}` : ""})`,
  );
  return true;
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
  if (!(await isAdminEmailEnabled("claim_new"))) return;
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

  const rendered = await renderTransactionalEmail({
    scenarioKey: "ADMIN_NEW_CLAIM",
    vars: {
      claimReference: escapeHtml(claimReference),
      clientName: escapeHtml(clientName),
      clientCompany: clientCompany ? escapeHtml(clientCompany) : escapeHtml(clientName),
      orderRow,
      subject: escapeHtml(subject),
      reportedItemsBlock,
      messagePreview: escapeHtml(messagePreview).substring(0, 500),
      claimUrl: `${baseUrl}/admin/service-client/${claimId}`,
      shopName: escapeHtml(shopName ?? ""),
    },
  });

  await sendMail({
    fromName: shopName || "Boutique",
    to: notifyEmail,
    subject: rendered.subject,
    html: rendered.html,
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
    if (!(await isAdminEmailEnabled("order_new"))) return;
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

    const rendered = await renderTransactionalEmail({
      scenarioKey: "ADMIN_NEW_ORDER",
      vars: {
        orderNumber: escapeHtml(order.orderNumber),
        clientLabel: escapeHtml(clientLabel),
        totalTTC: totalTTC.toFixed(2),
        orderUrl: `${baseUrl}/admin/commandes/${order.id}`,
        shopName: escapeHtml(shopName),
      },
    });

    await sendMail({
      fromName: shopName,
      to: notifyEmail,
      subject: rendered.subject,
      html: rendered.html,
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
    const rendered = await renderTransactionalEmail({
      scenarioKey: "ACCOUNT_APPROVED",
      vars: {
        firstName: escapeHtml(params.firstName),
        loginUrl: `${baseUrl}/fr/connexion`,
        shopName: escapeHtml(shopName),
      },
    });
    await sendMail({
      fromName: shopName,
      to: params.email,
      subject: rendered.subject,
      html: rendered.html,
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
    const rendered = await renderTransactionalEmail({
      scenarioKey: "ACCOUNT_REJECTED",
      vars: {
        firstName: escapeHtml(params.firstName),
        reasonBlock,
        contactBlock,
        shopName: escapeHtml(shopName),
      },
    });
    await sendMail({
      fromName: shopName,
      to: params.email,
      subject: rendered.subject,
      html: rendered.html,
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
    const rendered = await renderTransactionalEmail({
      scenarioKey: "ACCOUNT_REVOKED",
      vars: {
        firstName: escapeHtml(params.firstName),
        reasonBlock,
        contactBlock,
        shopName: escapeHtml(shopName),
      },
    });
    await sendMail({
      fromName: shopName,
      to: params.email,
      subject: rendered.subject,
      html: rendered.html,
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
    const rendered = await renderTransactionalEmail({
      scenarioKey: "ORDER_MODIFIED",
      vars: {
        orderNumber: escapeHtml(order.orderNumber),
        clientCompany: order.clientCompany ? ` <strong>${escapeHtml(order.clientCompany)}</strong>` : "",
        modificationsHtml: rows,
        totalCredit: totalCredit.toFixed(2),
        orderUrl: `${baseUrl}/fr/commandes/${order.id}`,
        shopName: escapeHtml(shopName),
      },
    });
    await sendMail({
      fromName: shopName,
      to: order.clientEmail,
      subject: rendered.subject,
      html: rendered.html,
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
    const rendered = await renderTransactionalEmail({
      scenarioKey: "CHECKOUT_PAYMENT_LINK",
      vars: {
        greeting,
        amountStr,
        checkoutUrl: escapeHtml(params.url),
        expiresStr: escapeHtml(expiresStr),
        orderTag,
        shopName: escapeHtml(shopName),
      },
    });
    const subjectWithSuffix = params.orderNumber
      ? `${rendered.subject} — Commande ${params.orderNumber}`
      : rendered.subject;
    // (variable subjectSuffix historique conservée pour éviter unused — l'override
    // peut suffire si la cliente met {orderTag} dans son sujet)
    void subjectSuffix;
    await sendMail({
      fromName: shopName,
      to: params.email,
      subject: subjectWithSuffix,
      html: rendered.html,
      tracking: {
        scenarioKey: "CHECKOUT_PAYMENT_LINK",
        userId,
        metadata: {
          amountTTC: params.amountTTC,
          expiresAt: params.expiresAt.toISOString(),
          orderNumber: params.orderNumber ?? null,
        },
      },
    });
    logger.info("[checkout-payment-link] Email envoyé", { to: params.email, amount: params.amountTTC });
  } catch (err) {
    logger.error("[checkout-payment-link] Erreur envoi email", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Email client pour demander un complément de paiement après modification de
 * commande (dépassement du montant initial). Supporte deux modes :
 *  - `STRIPE_LINK` : bouton direct vers Checkout Session Stripe
 *  - `BANK_TRANSFER` : rappel que les coordonnées IBAN sont visibles sur la
 *    page commande (on redirige la cliente dessus pour éviter de dupliquer
 *    l'IBAN dans deux endroits).
 */
export async function notifyClientSupplementRequest(params: {
  email: string;
  orderNumber: string;
  orderId: string;
  amountTTC: number;
  method: "STRIPE_LINK" | "BANK_TRANSFER";
  checkoutUrl: string | null;
  expiresAt: Date | null;
}): Promise<void> {
  try {
    const shopName = await getCachedShopName();
    const baseUrl = await getCurrentTenantBaseUrl();
    const amountStr = params.amountTTC.toFixed(2).replace(".", ",");
    const orderPageUrl = `${baseUrl}/fr/commandes/${params.orderId}`;
    const expiresStr = params.expiresAt
      ? params.expiresAt.toLocaleString("fr-FR", {
          day: "2-digit",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
    const userId = await resolveUserIdByEmail(params.email);

    const button =
      params.method === "STRIPE_LINK" && params.checkoutUrl
        ? `
          <div style="text-align:center;margin:24px 0;">
            <a href="${escapeHtml(params.checkoutUrl)}"
               style="background:#0F172A;color:#ffffff;padding:14px 32px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;font-size:15px;">
              Régler ${amountStr} € →
            </a>
          </div>
          ${
            expiresStr
              ? `<p style="font-size:12px;color:#6B6B6B;text-align:center;line-height:1.5;">Lien valable jusqu'au <strong>${escapeHtml(expiresStr)}</strong>.</p>`
              : ""
          }
          <p style="font-size:12px;color:#6B6B6B;text-align:center;margin-top:12px;">
            Le bouton est aussi accessible depuis votre espace commandes :<br/>
            <a href="${escapeHtml(orderPageUrl)}" style="color:#334155;">${escapeHtml(orderPageUrl)}</a>
          </p>
        `
        : `
          <div style="text-align:center;margin:24px 0;">
            <a href="${escapeHtml(orderPageUrl)}"
               style="background:#0F172A;color:#ffffff;padding:14px 32px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;font-size:15px;">
              Voir les coordonnées de virement →
            </a>
          </div>
          <p style="font-size:13px;color:#334155;text-align:center;line-height:1.6;">
            Les coordonnées IBAN sont affichées sur la page de votre commande.
            Dès réception du virement, nous expédions.
          </p>
        `;

    const rendered = await renderTransactionalEmail({
      scenarioKey: "ORDER_SUPPLEMENT_REQUEST",
      vars: {
        orderNumber: escapeHtml(params.orderNumber),
        amountStr,
        paymentBlock: button,
        shopName: escapeHtml(shopName),
      },
    });
    await sendMail({
      fromName: shopName,
      to: params.email,
      subject: rendered.subject,
      html: rendered.html,
      tracking: {
        scenarioKey: "ORDER_SUPPLEMENT_REQUEST",
        userId,
        metadata: {
          orderNumber: params.orderNumber,
          amountTTC: params.amountTTC,
          method: params.method,
        },
      },
    });

    logger.info("[order-supplement] Email complément envoyé", {
      to: params.email,
      orderNumber: params.orderNumber,
      amountTTC: params.amountTTC,
      method: params.method,
    });
  } catch (err) {
    logger.error("[order-supplement] Erreur envoi email", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
