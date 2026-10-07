"use server";

/**
 * Envoi d'une newsletter à plusieurs clients à la fois (format HTML pur).
 *
 * Flux :
 *  1. Charge le modèle newsletter (HTML + bibliothèque d'images)
 *  2. Charge les emails des clients sélectionnés (filtre acceptsNewsletter)
 *  3. Rend le HTML par destinataire (interpolation des `{tokens}`)
 *  4. Envoie séquentiellement avec un petit délai anti-flood
 *  5. Trace chaque envoi dans EmailSend + update lastSentAt du modèle
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/email";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { getCachedShopName } from "@/lib/cached-data";
import { renderNewsletterHtmlForSend } from "@/lib/newsletter-html-render";
import { resolveTemplateForCountry } from "@/lib/newsletter-locale-resolve";
import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";
import { buildUnsubscribeUrl } from "@/lib/newsletter-unsubscribe-token";

const INTER_MAIL_DELAY_MS = 300; // Anti-flood SMTP

/**
 * Rend le HTML d'un modèle de newsletter pour aperçu neutre (sans destinataire
 * particulier) — utilisé par les modales d'envoi. L'interpolation réelle par
 * client se fait au moment de l'envoi.
 */
export async function getNewsletterPreviewHtml(
  templateId: string,
): Promise<{ success: true; html: string; subject: string } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const template = await prisma.newsletterTemplate.findFirst({
      where: { id: templateId, tenantId: tenant.id },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
          select: { name: true, path: true },
        },
      },
    });
    if (!template) return { success: false, error: "Modèle introuvable." };

    const baseUrl = await getCurrentTenantBaseUrl();
    const html = renderNewsletterHtmlForSend({
      html: template.html ?? "",
      images: template.images,
      baseUrl,
    });
    return { success: true, html, subject: template.subject };
  } catch (err) {
    logger.error("[getNewsletterPreviewHtml]", { templateId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function sendNewsletterToUsers({
  templateId,
  userIds,
}: {
  templateId: string;
  userIds: string[];
}): Promise<
  | { success: true; sent: number; failed: number; excluded: number; details: Array<{ userId: string; email: string; ok: boolean; error?: string }> }
  | { success: false; error: string }
> {
  try {
    if (userIds.length === 0) {
      return { success: false, error: "Aucun destinataire sélectionné." };
    }

    const { tenant } = await requireAdmin();

    const template = await prisma.newsletterTemplate.findFirst({
      where: { id: templateId, tenantId: tenant.id },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
          select: { name: true, path: true },
        },
      },
    });
    if (!template) return { success: false, error: "Modèle introuvable." };

    // Emails des clients sélectionnés — filtre RGPD strict :
    // seuls les clients APPROVED + acceptsNewsletter=true reçoivent la newsletter.
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        tenantId: tenant.id,
        role: "CLIENT",
        status: "APPROVED",
        acceptsNewsletter: true,
      },
      select: {
        id: true, email: true, firstName: true, lastName: true, company: true,
        phone: true, siret: true, vatNumber: true,
        addressStreet: true, addressZip: true, addressCity: true, addressCountry: true,
      },
    });
    const excludedCount = userIds.length - users.length;
    if (users.length === 0) {
      return {
        success: false,
        error: excludedCount > 0
          ? `Aucun destinataire valide : ${excludedCount} client${excludedCount > 1 ? "s" : ""} exclu${excludedCount > 1 ? "s" : ""} (désinscrit${excludedCount > 1 ? "s" : ""} ou compte non-approuvé).`
          : "Aucun client valide trouvé parmi la sélection.",
      };
    }

    // Contexte partagé (shopName, baseUrl — identiques à tous les destinataires)
    const shopName = await getCachedShopName();
    const baseUrl = await getCurrentTenantBaseUrl();
    const companyInfo = await prisma.companyInfo.findFirst({
      where: { tenantId: tenant.id },
      select: { address: true, postalCode: true, city: true, email: true, phone: true, website: true },
    });
    const computedShopAddress = companyInfo
      ? [companyInfo.address, [companyInfo.postalCode, companyInfo.city].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ")
      : "";
    if (!shopName.trim() || !computedShopAddress.trim()) {
      return {
        success: false,
        error:
          "Nom de boutique ou adresse manquant dans les infos entreprise. " +
          "Ouvre Paramètres → Boutique et complète tes coordonnées avant d'envoyer un mail marketing.",
      };
    }
    const shopContext: MailMergeContext = {
      shopName,
      shopAddress: computedShopAddress,
      shopEmail: companyInfo?.email ?? "",
      shopPhone: companyInfo?.phone ?? "",
      shopWebsite: companyInfo?.website ?? baseUrl.replace(/^https?:\/\//, ""),
    };

    const details: Array<{ userId: string; email: string; ok: boolean; error?: string }> = [];
    let sentCount = 0;
    for (const user of users) {
      const userContext: MailMergeContext = {
        ...shopContext,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        company: user.company,
        phone: user.phone,
        siret: user.siret ?? "",
        tvaIntra: user.vatNumber ?? "",
        address: user.addressStreet ?? "",
        postalCode: user.addressZip ?? "",
        city: user.addressCity ?? "",
        country: user.addressCountry ?? "",
        unsubscribeLink: buildUnsubscribeUrl({
          baseUrl,
          userId: user.id,
          tenantId: tenant.id,
        }),
        privacyLink: `${baseUrl}/fr/confidentialite`,
      };
      // Résolution de la langue selon le pays du client (cascade : locale
      // cible → EN → FR si la version choisie est vide).
      const resolved = await resolveTemplateForCountry(
        template.id,
        user.addressCountry ?? null,
      );
      if (!resolved) {
        details.push({
          userId: user.id,
          email: user.email,
          ok: false,
          error: "Modèle introuvable au moment de l'envoi.",
        });
        continue;
      }
      const html = renderNewsletterHtmlForSend({
        html: resolved.html,
        images: resolved.images,
        baseUrl,
        mergeContext: userContext,
      });
      const interpolatedSubject = interpolate(resolved.subject, userContext);

      const result = await sendMail({
        to: user.email,
        subject: interpolatedSubject,
        html,
        fromName: shopName,
        listUnsubscribeUrl: userContext.unsubscribeLink,
        tracking: {
          scenarioKey: "NEWSLETTER",
          userId: user.id,
          metadata: { templateId, templateName: template.name },
        },
      });

      if (result.sent) {
        sentCount++;
        details.push({ userId: user.id, email: user.email, ok: true });
      } else {
        const reason =
          result.reason === "no_config"
            ? "Configuration SMTP absente."
            : result.reason === "no_from"
              ? "Adresse expéditeur non configurée."
              : `Refusé (${result.error ?? "raison inconnue"}).`;
        details.push({ userId: user.id, email: user.email, ok: false, error: reason });
        if (result.reason === "no_config" || result.reason === "no_from") break;
      }

      if (INTER_MAIL_DELAY_MS > 0) await new Promise((r) => setTimeout(r, INTER_MAIL_DELAY_MS));
    }

    if (sentCount > 0) {
      await prisma.newsletterTemplate.update({
        where: { id: templateId },
        data: { lastSentAt: new Date() },
      });
    }

    revalidatePath("/admin/clients");
    revalidatePath("/admin/marketing/mails");

    return {
      success: true,
      sent: sentCount,
      failed: users.length - sentCount,
      excluded: excludedCount,
      details,
    };
  } catch (err) {
    logger.error("[sendNewsletterToUsers]", { templateId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function buildLegalLine(tenantId: string): Promise<string> {
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

/**
 * Mail du compte admin connecté (session.user.email) — utilisé par l'aperçu
 * newsletter HTML pour afficher « Moi-même — beliandjolie@gmail.com » et
 * envoyer les tests vers ce login.
 */
export async function getAdminSessionEmail(): Promise<string> {
  const { session } = await requireAdmin();
  return session.user.email;
}

/**
 * Renvoie les valeurs boutique du tenant courant à injecter dans la preview
 * client des éditeurs (fallback avant le rendu serveur).
 */
export async function getBoutiquePreviewOverrides(): Promise<{
  shopName: string;
  shopAddress: string;
  shopEmail: string;
  shopPhone: string;
  shopWebsite: string;
}> {
  const { tenant } = await requireAdmin();
  const [shopName, baseUrl, companyInfo] = await Promise.all([
    getCachedShopName(),
    getCurrentTenantBaseUrl(),
    prisma.companyInfo.findFirst({
      where: { tenantId: tenant.id },
      select: {
        address: true,
        postalCode: true,
        city: true,
        email: true,
        phone: true,
        website: true,
      },
    }),
  ]);
  const shopAddress = companyInfo
    ? [
        companyInfo.address,
        [companyInfo.postalCode, companyInfo.city].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  return {
    shopName,
    shopAddress,
    shopEmail: companyInfo?.email ?? "",
    shopPhone: companyInfo?.phone ?? "",
    shopWebsite: companyInfo?.website ?? baseUrl.replace(/^https?:\/\//, ""),
  };
}
