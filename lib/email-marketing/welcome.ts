/**
 * lib/email-marketing/welcome.ts
 *
 * Envoi de l'email de bienvenue au moment où l'admin valide un compte
 * client (PENDING → APPROVED). Uses le template ardoise + tracking +
 * désinscription.
 *
 * Fire-and-forget côté appelant. Si le scénario WELCOME est désactivé,
 * `sendWelcomeEmail` retourne false sans erreur (l'appelant peut alors
 * fallback sur un envoi transactionnel plus basique).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { getOrCreateScenario } from "@/lib/email-marketing/scenarios";
import { getTenantBaseUrl } from "@/lib/email-marketing/tenant-domain";
import { isUnsubscribed } from "@/lib/email-marketing/unsubscribe";
import { encodeUnsubscribeToken, encodeTrackingToken } from "@/lib/email-marketing/tokens";
import { renderWelcomeEmail } from "@/lib/email-marketing/templates/welcome";

interface SendWelcomeParams {
  userId: string;
  email: string;
  firstName: string;
  tenantId?: string; // Sinon résolu depuis l'ALS
}

/**
 * Envoie l'email de bienvenue si le scénario est actif pour le tenant.
 * @returns true si envoyé, false sinon (désactivé, dédup, désabonné, etc.)
 */
export async function sendWelcomeEmail(params: SendWelcomeParams): Promise<boolean> {
  const tenantId = params.tenantId ?? tenantALS.getStore() ?? null;
  if (!tenantId) {
    logger.warn("[Welcome] Pas de tenantId — email ignoré");
    return false;
  }

  return await tenantALS.run(tenantId, async () => {
    try {
      const scenario = await getOrCreateScenario(tenantId, "WELCOME");
      if (!scenario.enabled) return false;

      const email = params.email.trim();
      if (!email) return false;

      const dedupKey = `user-${params.userId}`;
      const already = await prisma.emailSend.findUnique({
        where: {
          tenantId_scenarioKey_dedupKey: {
            tenantId,
            scenarioKey: "WELCOME",
            dedupKey,
          },
        },
        select: { id: true },
      });
      if (already) return false;

      if (await isUnsubscribed(tenantId, email, "MARKETING_ALL")) return false;

      const baseUrl = await getTenantBaseUrl(tenantId);
      const [companyInfo, tenant] = await Promise.all([
        prisma.companyInfo.findFirst({
          where: { tenantId },
          select: {
            shopName: true,
            name: true,
            email: true,
            phone: true,
            address: true,
            postalCode: true,
            city: true,
          },
        }),
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      ]);

      const shopName = companyInfo?.shopName?.trim() || tenant?.name || "notre boutique";
      const contactEmail = companyInfo?.email || `contact@${new URL(baseUrl).hostname}`;
      const contactPhone = companyInfo?.phone || undefined;
      const legalName = companyInfo?.shopName?.trim() || companyInfo?.name?.trim() || shopName;
      const addressLine = [
        companyInfo?.address,
        [companyInfo?.postalCode, companyInfo?.city].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ");
      const companyLegal = [legalName, addressLine].filter(Boolean).join(" · ");

      let sendRow;
      try {
        sendRow = await prisma.emailSend.create({
          data: {
            tenantId,
            scenarioKey: "WELCOME",
            recipientEmail: email.toLowerCase(),
            userId: params.userId,
            subject: "",
            dedupKey,
            metadata: { userId: params.userId } as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
      } catch (err) {
        logger.warn("[Welcome] EmailSend déjà présent (race) — skip", {
          tenantId,
          dedupKey,
          error: (err as Error).message,
        });
        return false;
      }

      const pixelToken = encodeTrackingToken(sendRow.id);
      const pixelUrl = `${baseUrl}/api/emails/track/pixel?t=${encodeURIComponent(pixelToken)}`;
      const unsubToken = encodeUnsubscribeToken(tenantId, email, "MARKETING_ALL");
      const unsubscribeUrl = `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`;

      const { subject, html } = renderWelcomeEmail({
        customerFirstName: params.firstName || "",
        shopName,
        catalogUrl: `${baseUrl}/fr/produits`,
        contactEmail,
        contactPhone,
        unsubscribeUrl,
        pixelUrl,
        companyLegal,
      });

      const result = await sendMail({ to: email, subject, html });

      if (result.sent) {
        await prisma.emailSend.update({
          where: { id: sendRow.id },
          data: { subject, messageId: result.id || null },
        });
        return true;
      }

      await prisma.emailSend.update({
        where: { id: sendRow.id },
        data: { subject: `[ÉCHEC SMTP] ${subject}` },
      });
      logger.error("[Welcome] Échec SMTP", { tenantId, to: email });
      return false;
    } catch (err) {
      logger.error("[Welcome] Erreur envoi bienvenue", {
        tenantId,
        userId: params.userId,
        error: err as Error,
      });
      return false;
    }
  });
}
