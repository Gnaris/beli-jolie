/**
 * lib/order-followup-notify.ts
 *
 * Envoi du mail « Suivi 10 j après expédition » pour une commande boutique.
 * Déclenché par `lib/order-followup-scheduler.ts` 10 jours après que la
 * commande a été marquée SHIPPED.
 *
 * Scenarioé scenarioKey : `ORDER_FOLLOWUP_REVIEW` — personnalisable depuis
 * /admin/contact-client/mails/systeme.
 *
 * Fire-and-forget : toute erreur est loggée mais n'empêche pas le scheduler
 * de passer à la commande suivante. L'appelant est responsable de marquer
 * `reviewRequestEmailSentAt` APRÈS un retour `{ sent: true }`.
 */

import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { getCachedShopName } from "@/lib/cached-data";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { renderTransactionalEmail } from "@/lib/transactional-email-render";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface OrderFollowupResult {
  sent: boolean;
  reason?: "order_not_found" | "order_not_shipped" | "already_sent" | "send_failed";
}

export async function sendOrderFollowupReviewEmail(
  orderId: string,
): Promise<OrderFollowupResult> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        clientEmail: true,
        clientCompany: true,
        reviewRequestEmailSentAt: true,
        userId: true,
        user: { select: { id: true, firstName: true } },
      },
    });

    if (!order) return { sent: false, reason: "order_not_found" };
    if (order.status !== "SHIPPED") return { sent: false, reason: "order_not_shipped" };
    if (order.reviewRequestEmailSentAt) return { sent: false, reason: "already_sent" };

    const [shopName, baseUrl] = await Promise.all([
      getCachedShopName(),
      getCurrentTenantBaseUrl(),
    ]);

    const firstName = order.user?.firstName?.trim() || "";
    const clientCompany = order.clientCompany?.trim() || "";
    const orderUrl = `${baseUrl}/fr/commandes/${order.id}`;
    const reviewUrl = `${baseUrl}/fr/espace-pro`;
    const catalogUrl = `${baseUrl}/fr/produits`;
    const supportUrl = `${baseUrl}/fr/contact`;

    const rendered = await renderTransactionalEmail({
      scenarioKey: "ORDER_FOLLOWUP_REVIEW",
      vars: {
        orderNumber: escapeHtml(order.orderNumber),
        firstName: firstName ? escapeHtml(firstName) : "",
        clientCompany: clientCompany ? escapeHtml(clientCompany) : "",
        orderUrl,
        reviewUrl,
        catalogUrl,
        supportUrl,
        shopName: escapeHtml(shopName),
      },
    });

    const result = await sendMail({
      fromName: shopName,
      to: order.clientEmail,
      subject: rendered.subject,
      html: rendered.html,
      tracking: {
        scenarioKey: "ORDER_FOLLOWUP_REVIEW",
        userId: order.userId ?? null,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
        },
      },
    });

    if (!result.sent) {
      logger.warn("[orderFollowup] mail non envoyé", {
        orderId: order.id,
        reason: result.reason,
      });
      return { sent: false, reason: "send_failed" };
    }

    return { sent: true };
  } catch (err) {
    logger.error("[orderFollowup] erreur envoi", {
      orderId,
      error: err as Error,
    });
    return { sent: false, reason: "send_failed" };
  }
}
