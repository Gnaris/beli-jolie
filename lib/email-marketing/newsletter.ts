/**
 * lib/email-marketing/newsletter.ts
 *
 * Envoi manuel de newsletter depuis l'admin.
 *
 * L'admin :
 *   - choisit une liste de produits (max 12) via l'UI
 *   - saisit un objet + un intro
 *   - choisit "envoyer un test" (à son adresse perso) ou "envoyer à tous"
 *
 * Côté serveur, on parcourt tous les clients APPROVED du tenant qui ne sont
 * pas désinscrits (NEWSLETTER ou MARKETING_ALL) et on envoie séquentiellement
 * avec un délai entre chaque pour ne pas saturer le SMTP.
 *
 * Dédup : dedupKey = `newsletter-{campaignId}-{userId}` — on peut relancer
 * une campagne sur les erreurs sans doublon.
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
import {
  renderNewsletterEmail,
  type NewsletterProductView,
} from "@/lib/email-marketing/templates/newsletter";

// Rate limit doux pour ne pas saturer Postfix : 500 ms entre chaque email
// = ~2 emails/s = ~7200/h. Assez pour les catalogues clients pros.
const DELAY_BETWEEN_SENDS_MS = 500;

// Un maximum raisonnable de destinataires par appel manuel.
const MAX_RECIPIENTS_PER_CAMPAIGN = 5000;

export interface NewsletterCampaign {
  subject: string;
  eyebrow: string;
  title: string;
  intro: string;
  browseAllUrl: string;
  browseAllLabel: string;
  productIds: string[];
}

export interface NewsletterSendResult {
  campaignId: string;
  targeted: number;
  sent: number;
  skipped: number;
  errors: number;
}

/**
 * Envoie un email de test (1 destinataire) — utilisé par le bouton
 * "Envoyer un test" de l'admin.
 */
export async function sendNewsletterTest(
  tenantId: string,
  toEmail: string,
  campaign: NewsletterCampaign,
): Promise<{ success: boolean; error?: string }> {
  return await tenantALS.run(tenantId, async () => {
    try {
      const baseUrl = await getTenantBaseUrl(tenantId);
      const products = await loadProductViews(tenantId, campaign.productIds, baseUrl);
      const companyLegal = await getCompanyLegalLine(tenantId);
      const unsubToken = encodeUnsubscribeToken(tenantId, toEmail, "NEWSLETTER");
      const unsubscribeUrl = `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`;

      const { subject, html } = renderNewsletterEmail({
        subject: `[TEST] ${campaign.subject}`,
        eyebrow: campaign.eyebrow,
        title: campaign.title,
        intro: campaign.intro,
        products,
        browseAllUrl: campaign.browseAllUrl,
        browseAllLabel: campaign.browseAllLabel,
        unsubscribeUrl,
        companyLegal,
      });

      const result = await sendMail({ to: toEmail, subject, html });
      if (!result.sent) {
        return { success: false, error: `Envoi échoué (${result.reason})` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}

/**
 * Envoie la campagne à tous les clients APPROVED du tenant qui ne sont pas
 * désinscrits. Long-running — appelée en fire-and-forget côté admin, avec
 * suivi via EmailSend.
 */
export async function sendNewsletterCampaign(
  tenantId: string,
  campaign: NewsletterCampaign,
): Promise<NewsletterSendResult> {
  const campaignId = `nl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const result: NewsletterSendResult = {
    campaignId,
    targeted: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
  };

  return await tenantALS.run(tenantId, async () => {
    try {
      const scenario = await getOrCreateScenario(tenantId, "NEWSLETTER");
      if (!scenario.enabled) {
        logger.warn("[Newsletter] Scénario désactivé — envoi refusé");
        return result;
      }

      const users = await prisma.user.findMany({
        where: {
          tenantId,
          status: "APPROVED",
          role: "CLIENT",
          email: { not: "" },
        },
        select: { id: true, email: true, firstName: true },
        take: MAX_RECIPIENTS_PER_CAMPAIGN,
      });

      result.targeted = users.length;
      if (users.length === 0) return result;

      const baseUrl = await getTenantBaseUrl(tenantId);
      const products = await loadProductViews(tenantId, campaign.productIds, baseUrl);
      const companyLegal = await getCompanyLegalLine(tenantId);

      for (const user of users) {
        const email = user.email?.trim().toLowerCase();
        if (!email) {
          result.skipped += 1;
          continue;
        }

        try {
          if (await isUnsubscribed(tenantId, email, "NEWSLETTER")) {
            result.skipped += 1;
            continue;
          }

          const dedupKey = `${campaignId}:user-${user.id}`;
          let sendRow;
          try {
            sendRow = await prisma.emailSend.create({
              data: {
                tenantId,
                scenarioKey: "NEWSLETTER",
                recipientEmail: email,
                userId: user.id,
                subject: "",
                dedupKey,
                metadata: {
                  campaignId,
                  productIds: campaign.productIds,
                } as Prisma.InputJsonValue,
              },
              select: { id: true },
            });
          } catch (err) {
            logger.warn("[Newsletter] EmailSend race — skip", {
              tenantId,
              dedupKey,
              error: (err as Error).message,
            });
            result.skipped += 1;
            continue;
          }

          const pixelToken = encodeTrackingToken(sendRow.id);
          const pixelUrl = `${baseUrl}/api/emails/track/pixel?t=${encodeURIComponent(pixelToken)}`;
          const unsubToken = encodeUnsubscribeToken(tenantId, email, "NEWSLETTER");
          const unsubscribeUrl = `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`;

          const { subject, html } = renderNewsletterEmail({
            subject: campaign.subject,
            eyebrow: campaign.eyebrow,
            title: campaign.title,
            intro: campaign.intro,
            products,
            browseAllUrl: campaign.browseAllUrl,
            browseAllLabel: campaign.browseAllLabel,
            unsubscribeUrl,
            pixelUrl,
            companyLegal,
          });

          const smtpResult = await sendMail({ to: email, subject, html });

          if (smtpResult.sent) {
            await prisma.emailSend.update({
              where: { id: sendRow.id },
              data: { subject, messageId: smtpResult.id || null },
            });
            result.sent += 1;
          } else {
            await prisma.emailSend.update({
              where: { id: sendRow.id },
              data: { subject: `[ÉCHEC SMTP] ${subject}` },
            });
            result.errors += 1;
            if (smtpResult.sent === false && smtpResult.reason === "no_config") {
              logger.error("[Newsletter] SMTP non configuré — arrêt de la campagne", {
                tenantId,
              });
              return result;
            }
          }

          if (DELAY_BETWEEN_SENDS_MS > 0) {
            await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SENDS_MS));
          }
        } catch (err) {
          result.errors += 1;
          logger.error("[Newsletter] Erreur envoi", {
            tenantId,
            userId: user.id,
            error: err as Error,
          });
        }
      }

      logger.info("[Newsletter] Campagne terminée", { tenantId, ...result });
      return result;
    } catch (err) {
      logger.error("[Newsletter] Campagne échouée", { tenantId, error: err as Error });
      return result;
    }
  });
}

async function loadProductViews(
  tenantId: string,
  productIds: string[],
  baseUrl: string,
): Promise<NewsletterProductView[]> {
  if (productIds.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { tenantId, id: { in: productIds }, status: "ONLINE" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      colors: {
        orderBy: { isPrimary: "desc" },
        take: 1,
        select: {
          unitPrice: true,
          images: {
            orderBy: { order: "asc" },
            take: 1,
            select: { path: true },
          },
        },
      },
    },
  });
  const now = Date.now();
  const NEW_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

  // Préserve l'ordre demandé par l'admin.
  const byId = new Map(products.map((p) => [p.id, p]));
  return productIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => {
      const v = p.colors[0];
      return {
        name: p.name,
        priceLabel: v ? formatEuros(Number(v.unitPrice)) : "",
        productUrl: `${baseUrl}/fr/produits/${p.id}`,
        imageUrl: v?.images[0]?.path ? absoluteUrl(baseUrl, v.images[0].path) : null,
        isNew: now - p.createdAt.getTime() < NEW_THRESHOLD_MS,
      };
    });
}

function formatEuros(amount: number): string {
  return amount.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function absoluteUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function getCompanyLegalLine(tenantId: string): Promise<string> {
  try {
    const info = await prisma.companyInfo.findFirst({
      where: { tenantId },
      select: { shopName: true, name: true, address: true, postalCode: true, city: true },
    });
    if (!info) return "";
    const displayName = info.shopName?.trim() || info.name?.trim();
    const addressLine = [info.address, [info.postalCode, info.city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    return [displayName, addressLine].filter(Boolean).join(" · ");
  } catch {
    return "";
  }
}
