"use server";

/**
 * Envoi d'une newsletter à plusieurs clients à la fois.
 *
 * Flux :
 *  1. Charge le modèle newsletter (blocs)
 *  2. Charge les produits référencés dans les blocs « Grille produits »
 *  3. Charge les emails des clients sélectionnés
 *  4. Rend le HTML du mail (une seule fois — même contenu pour tous)
 *  5. Envoie séquentiellement avec un petit délai anti-flood
 *  6. Trace chaque envoi dans EmailSend + update lastSentAt du modèle
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/email";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { getCachedShopName } from "@/lib/cached-data";
import { renderNewsletterHtml, substituteVariables, type ProductLite, type NewsletterBlock } from "@/lib/newsletter-blocks";
import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";
import { buildUnsubscribeUrl } from "@/lib/newsletter-unsubscribe-token";

const INTER_MAIL_DELAY_MS = 300; // Anti-flood SMTP

/**
 * Rend le HTML d'un modèle de newsletter pour aperçu dans la modale
 * d'envoi. Utilise exactement le même pipeline que l'envoi réel — ce que
 * voit la cliente = ce que reçoit le client.
 */
export async function getNewsletterPreviewHtml(
  templateId: string,
): Promise<{ success: true; html: string; subject: string } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const template = await prisma.newsletterTemplate.findFirst({
      where: { id: templateId, tenantId: tenant.id },
    });
    if (!template) return { success: false, error: "Modèle introuvable." };

    const blocks = Array.isArray(template.blocks) ? (template.blocks as unknown as NewsletterBlock[]) : [];
    const productsById = await loadProductsForBlocks(tenant.id, blocks);
    const shopName = await getCachedShopName();
    const baseUrl = await getCurrentTenantBaseUrl();
    const legalLine = await buildLegalLine(tenant.id);
    // Aperçu cohérent avec l'envoi réel : les 2 passent omitGlobalChrome=true —
    // l'en-tête et le pied de page sont composés via les blocs éditables du
    // modèle, plus d'habillage global partagé.
    const html = renderNewsletterHtml({
      subject: template.subject,
      blocks,
      productsById,
      shared: { shopName, baseUrl, legalLine },
      omitGlobalChrome: true,
    });
    return { success: true, html, subject: template.subject };
  } catch (err) {
    logger.error("[getNewsletterPreviewHtml]", { templateId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/** Charge les produits référencés par les blocs « Grille produits ». */
async function loadProductsForBlocks(
  tenantId: string,
  blocks: NewsletterBlock[],
): Promise<Map<string, ProductLite>> {
  const productIds = blocks
    .filter((b): b is Extract<NewsletterBlock, { type: "products" }> => b.type === "products")
    .flatMap((b) => b.data.productIds);
  const uniqueProductIds = [...new Set(productIds)];
  const productsById = new Map<string, ProductLite>();
  if (uniqueProductIds.length === 0) return productsById;

  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds }, tenantId },
    select: {
      id: true,
      name: true,
      reference: true,
      colors: {
        take: 1,
        orderBy: { isPrimary: "desc" },
        select: {
          unitPrice: true,
          images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
        },
      },
    },
  });
  for (const p of products) {
    const v = p.colors[0];
    productsById.set(p.id, {
      id: p.id,
      name: p.name,
      reference: p.reference,
      imagePath: v?.images[0]?.path ?? null,
      priceCents: v ? Math.round(Number(v.unitPrice) * 100) : null,
    });
  }
  return productsById;
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

    // 1. Charge le modèle
    const template = await prisma.newsletterTemplate.findFirst({
      where: { id: templateId, tenantId: tenant.id },
    });
    if (!template) return { success: false, error: "Modèle introuvable." };

    const blocks = Array.isArray(template.blocks) ? (template.blocks as unknown as NewsletterBlock[]) : [];

    // 2. Charge tous les produits référencés dans les blocs « Grille produits »
    const productsById = await loadProductsForBlocks(tenant.id, blocks);

    // 3. Emails des clients sélectionnés — filtre RGPD strict :
    // seuls les clients APPROVED + acceptsNewsletter=true reçoivent la newsletter.
    // Les autres sont exclus silencieusement mais comptés pour retour visuel.
    // On charge les champs nécessaires à l'interpolation des variables
    // ({firstName}, {company}, {city}…) — la substitution est faite par user.
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

    // 4. Contexte partagé (shopName, baseUrl — identiques à tous les destinataires)
    const shopName = await getCachedShopName();
    const baseUrl = await getCurrentTenantBaseUrl();
    const legalLine = await buildLegalLine(tenant.id);
    const companyInfo = await prisma.companyInfo.findFirst({
      where: { tenantId: tenant.id },
      select: { address: true, postalCode: true, city: true, email: true, phone: true, website: true },
    });
    const shopContext: MailMergeContext = {
      shopName,
      shopAddress: companyInfo
        ? [companyInfo.address, [companyInfo.postalCode, companyInfo.city].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(", ")
        : "",
      shopEmail: companyInfo?.email ?? "",
      shopPhone: companyInfo?.phone ?? "",
      shopWebsite: companyInfo?.website ?? baseUrl.replace(/^https?:\/\//, ""),
    };

    // 5. Rendu ET envoi PAR USER (substitution des variables {firstName}, etc.)
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
      };
      // Mentions légales : chaque destinataire a son propre lien de désinscription
      // (token signé sur son userId). `privacyLink` est le même pour tous
      // (pointe vers la page publique /confidentialite).
      const userContextWithLegal: MailMergeContext = {
        ...userContext,
        unsubscribeLink: buildUnsubscribeUrl({
          baseUrl,
          userId: user.id,
          tenantId: tenant.id,
        }),
        privacyLink: `${baseUrl}/fr/confidentialite`,
      };
      const interpolatedBlocks = substituteVariables(blocks, userContextWithLegal);
      const interpolatedSubject = interpolate(template.subject, userContextWithLegal);
      const html = renderNewsletterHtml({
        subject: interpolatedSubject,
        blocks: interpolatedBlocks,
        productsById,
        // Marketing : l'admin compose son propre en-tête/pied via blocs et
        // insère les mentions légales via les 4 variables obligatoires.
        // On désactive l'habillage global pour éviter la duplication.
        omitGlobalChrome: true,
        shared: { shopName, baseUrl, legalLine, mergeContext: userContextWithLegal },
      });

      const result = await sendMail({
        to: user.email,
        subject: interpolatedSubject,
        html,
        fromName: shopName,
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
        // Si config manquante, on n'insiste pas
        if (result.reason === "no_config" || result.reason === "no_from") break;
      }

      if (INTER_MAIL_DELAY_MS > 0) await new Promise((r) => setTimeout(r, INTER_MAIL_DELAY_MS));
    }

    // 6. Update lastSentAt
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

async function buildLegalLine(tenantId: string): Promise<string> {
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
