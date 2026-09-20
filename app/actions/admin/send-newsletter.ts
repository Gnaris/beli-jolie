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
import {
  renderNewsletterHtml,
  substituteVariables,
  type ProductLite,
  type NewsletterBlock,
  type NewsletterDynamicContext,
  type CartItemDynamic,
} from "@/lib/newsletter-blocks";
import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";
import { buildUnsubscribeUrl } from "@/lib/newsletter-unsubscribe-token";
import { KEY_VERIFIED_EMAIL } from "./admin-personal-email-constants";
import type { ProductStatus } from "@prisma/client";

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
    const computedShopAddress = companyInfo
      ? [companyInfo.address, [companyInfo.postalCode, companyInfo.city].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ")
      : "";
    // Filet RGPD/LCEN : bloque l'envoi de masse si les mentions légales
    // sortiraient vides. La cliente doit compléter ses infos entreprise
    // (Paramètres → Boutique) avant de pouvoir envoyer une newsletter.
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
        listUnsubscribeUrl: userContextWithLegal.unsubscribeLink,
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

/**
 * Mail perso vérifié de l'admin — utilisé par l'option « Moi-même » dans
 * l'aperçu de l'éditeur newsletter. Retourne `null` si aucun mail perso n'est
 * encore verrouillé (dans ce cas l'UI grise l'option avec un message clair).
 */
export async function getAdminSelfEmail(): Promise<string | null> {
  const { tenant } = await requireAdmin();
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId: tenant.id, key: KEY_VERIFIED_EMAIL },
    select: { value: true },
  });
  const email = (row?.value ?? "").trim();
  return email.length > 0 ? email : null;
}

/**
 * Envoie le modèle courant en test à un destinataire unique (l'admin ou un
 * client). Sert au bouton « Envoyer un test » de l'éditeur newsletter.
 *
 * - `recipient.kind === "self"` : envoie au mail perso vérifié de l'admin.
 *   Refuse si aucun mail perso vérifié.
 * - `recipient.kind === "client"` : envoie au client (scopé tenant). Ne
 *   requiert PAS status APPROVED ni acceptsNewsletter — c'est un test envoyé
 *   à la demande explicite de l'admin, pas une action marketing automatique.
 *
 * Pour les modèles panier abandonné (`scenarioKey === "ABANDONED_CART"`) et
 * un destinataire client, le panier LIVE du client est injecté dans le rendu
 * (même filtre ONLINE + stock > 0 que le worker). Sinon (self ou client sans
 * panier), un panier fictif est utilisé pour que le bloc « Panier » reste
 * visible à l'aperçu.
 */
export async function sendTestNewsletterEmail({
  templateId,
  recipient,
}: {
  templateId: string;
  recipient: { kind: "self" } | { kind: "client"; userId: string };
}): Promise<
  | { success: true; sentTo: string }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();

    const template = await prisma.newsletterTemplate.findFirst({
      where: { id: templateId, tenantId: tenant.id },
      select: {
        id: true,
        name: true,
        subject: true,
        blocks: true,
        scenarioKey: true,
      },
    });
    if (!template) return { success: false, error: "Modèle introuvable." };

    // Résolution du destinataire : soit mail perso admin, soit vrai client.
    // Dans les 2 cas on récupère aussi les infos pour interpoler les tokens
    // ({firstName}, {company}, etc.) — l'admin n'a pas de fiche client, on
    // retombe sur des valeurs neutres pour rester lisible en aperçu.
    let toEmail: string;
    let userContextBase: Partial<MailMergeContext>;
    let clientUser: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      company: string;
    } | null = null;

    if (recipient.kind === "self") {
      const selfEmail = await getAdminSelfEmail();
      if (!selfEmail) {
        return {
          success: false,
          error:
            "Vous n'avez pas encore vérifié votre mail perso. Paramètres → Messagerie pour l'enregistrer.",
        };
      }
      toEmail = selfEmail;
      userContextBase = {
        firstName: "Marie",
        lastName: "Dupont",
        fullName: "Marie Dupont",
        email: selfEmail,
        company: "Boutique de test",
        phone: "06 12 34 56 78",
        siret: "",
        tvaIntra: "",
        address: "",
        postalCode: "",
        city: "",
        country: "",
      };
    } else {
      const user = await prisma.user.findFirst({
        where: {
          id: recipient.userId,
          tenantId: tenant.id,
          role: "CLIENT",
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          company: true,
          phone: true,
          siret: true,
          vatNumber: true,
          addressStreet: true,
          addressZip: true,
          addressCity: true,
          addressCountry: true,
        },
      });
      if (!user) return { success: false, error: "Client introuvable." };
      toEmail = user.email;
      clientUser = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        company: user.company,
      };
      userContextBase = {
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
    }

    const blocks = Array.isArray(template.blocks)
      ? (template.blocks as unknown as NewsletterBlock[])
      : [];

    // Contexte partagé boutique + lien de désinscription. On génère le lien
    // même pour l'admin : évite d'afficher un `{unsubscribeLink}` non-résolu
    // en aperçu (mais l'admin ne cliquera pas dessus, et si oui rien de casse).
    const [shopName, baseUrl, legalLine, productsById, companyInfo] =
      await Promise.all([
        getCachedShopName(),
        getCurrentTenantBaseUrl(),
        buildLegalLine(tenant.id),
        loadProductsForBlocks(tenant.id, blocks),
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

    const computedShopAddressTest = companyInfo
      ? [
          companyInfo.address,
          [companyInfo.postalCode, companyInfo.city]
            .filter(Boolean)
            .join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      : "";
    // Même filet RGPD/LCEN qu'à l'envoi de masse : refuse le test si les
    // mentions légales sortiraient vides — sinon l'aperçu ment sur le mail
    // réel (qui serait lui aussi refusé côté worker).
    if (!shopName.trim() || !computedShopAddressTest.trim()) {
      return {
        success: false,
        error:
          "Nom de boutique ou adresse manquant dans les infos entreprise. " +
          "Ouvre Paramètres → Boutique et complète tes coordonnées avant d'envoyer un mail de test.",
      };
    }
    const shopContext: MailMergeContext = {
      shopName,
      shopAddress: computedShopAddressTest,
      shopEmail: companyInfo?.email ?? "",
      shopPhone: companyInfo?.phone ?? "",
      shopWebsite: companyInfo?.website ?? baseUrl.replace(/^https?:\/\//, ""),
    };

    // Dynamic context pour les blocs « Panier », « Favoris »… selon scénario.
    const dynamic = await buildTestDynamicContext({
      scenarioKey: template.scenarioKey,
      tenantId: tenant.id,
      clientUser,
    });

    // Total panier interpolé dans les tokens {cartTotal} / {cartCount}.
    const cartTotalCents = dynamic.cart?.totalCents ?? 0;
    const cartCount = dynamic.cart?.items.length ?? 0;

    // Lien de désinscription — utilise l'userId du client, ou une valeur
    // neutre pour l'admin (URL boutique) pour éviter un token cassé.
    const unsubscribeLink =
      clientUser
        ? buildUnsubscribeUrl({
            baseUrl,
            userId: clientUser.id,
            tenantId: tenant.id,
          })
        : `${baseUrl}/fr`;

    const userContext: MailMergeContext = {
      ...shopContext,
      ...userContextBase,
      cartTotal: (cartTotalCents / 100).toLocaleString("fr-FR", {
        style: "currency",
        currency: "EUR",
      }),
      cartCount: String(cartCount),
      days:
        dynamic.daysInactive === null || dynamic.daysInactive === undefined
          ? ""
          : String(dynamic.daysInactive),
      unsubscribeLink,
      privacyLink: `${baseUrl}/fr/confidentialite`,
    };

    const finalBlocks = substituteVariables(blocks, userContext);
    const finalSubject = interpolate(template.subject, userContext);
    const html = renderNewsletterHtml({
      subject: finalSubject,
      blocks: finalBlocks,
      productsById,
      shared: { shopName, baseUrl, legalLine, mergeContext: userContext },
      dynamic,
      omitGlobalChrome: true,
    });

    // Sujet marqué [TEST HH:MM:SS] pour que la cliente distingue clairement
    // un aperçu d'un vrai envoi. L'horodatage rend chaque test unique — sans
    // ça Gmail iOS regroupe les tests successifs dans un même fil et
    // affiche le fameux « … » (contenu tronqué) au-dessus du corps du mail.
    const stamp = new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const testSubject = `[TEST ${stamp}] ${finalSubject}`;

    const result = await sendMail({
      to: toEmail,
      subject: testSubject,
      html,
      fromName: shopName,
      // Header List-Unsubscribe uniquement quand on envoie à un vrai client
      // (l'admin en self-test ne doit pas pouvoir se désinscrire lui-même).
      listUnsubscribeUrl: clientUser ? unsubscribeLink : undefined,
      tracking: {
        // On trace en NEWSLETTER (catégorie marketing) même pour les tests
        // panier abandonné — permet de retrouver dans le journal côté client
        // quand un test a été envoyé. userId=null pour l'admin (self).
        scenarioKey: "NEWSLETTER",
        userId: clientUser?.id ?? null,
        metadata: {
          source: "test",
          templateId,
          templateName: template.name,
          scenarioKey: template.scenarioKey,
          recipientKind: recipient.kind,
        },
      },
    });

    if (!result.sent) {
      const reason =
        result.reason === "no_config"
          ? "Configuration SMTP absente — la boîte pro n'est pas encore branchée."
          : result.reason === "no_from"
            ? "Adresse expéditeur non configurée."
            : `Refusé (${result.error ?? "raison inconnue"}).`;
      return { success: false, error: reason };
    }

    return { success: true, sentTo: toEmail };
  } catch (err) {
    logger.error("[sendTestNewsletterEmail]", {
      templateId,
      error: err as Error,
    });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Construit le contexte dynamique pour un envoi de test selon le scénario.
 * ABANDONED_CART + vrai client → panier live (filtre ONLINE + stock > 0).
 * Autres cas → fallback fictif pour que les blocs restent visibles.
 */
async function buildTestDynamicContext({
  scenarioKey,
  tenantId,
  clientUser,
}: {
  scenarioKey: string | null;
  tenantId: string;
  clientUser: { id: string; firstName: string } | null;
}): Promise<NewsletterDynamicContext> {
  if (scenarioKey === "ABANDONED_CART" && clientUser) {
    const cart = await prisma.cart.findFirst({
      where: { userId: clientUser.id, tenantId },
      select: {
        items: {
          select: {
            quantity: true,
            variant: {
              select: {
                unitPrice: true,
                stock: true,
                saleType: true,
                packQuantity: true,
                color: { select: { name: true } },
                product: { select: { name: true, status: true } },
                images: {
                  orderBy: { order: "asc" },
                  take: 1,
                  select: { path: true },
                },
              },
            },
          },
        },
      },
    });
    const validItems = (cart?.items ?? []).filter((it) => {
      const status = it.variant.product.status as ProductStatus;
      if (status !== "ONLINE") return false;
      const effective =
        it.variant.saleType === "PACK" && it.variant.packQuantity
          ? Math.floor(it.variant.stock / it.variant.packQuantity)
          : it.variant.stock;
      return effective > 0;
    });
    if (validItems.length > 0) {
      const items: CartItemDynamic[] = validItems.map((it) => ({
        productName: it.variant.product.name,
        colorName: it.variant.color?.name ?? null,
        quantity: it.quantity,
        totalCents:
          Math.round(Number(it.variant.unitPrice) * 100) * it.quantity,
        imagePath: it.variant.images[0]?.path ?? null,
      }));
      const totalCents = items.reduce((s, it) => s + it.totalCents, 0);
      return {
        firstName: clientUser.firstName,
        cart: { items, totalCents },
      };
    }
    // Client sans panier live → panier fictif pour que l'admin voie le rendu.
    // On marque avec des libellés « (aperçu) » pour éviter la confusion.
    return {
      firstName: clientUser.firstName,
      cart: buildFakeCart(),
    };
  }

  // INACTIVE_CLIENT : injecte daysInactive calculé depuis le vrai lastSeenAt
  // du client, ou une valeur d'aperçu (45 j) pour un self-test admin.
  if (scenarioKey === "INACTIVE_CLIENT") {
    let daysInactive: number | null = 45;
    if (clientUser) {
      const u = await prisma.user.findFirst({
        where: { id: clientUser.id, tenantId },
        select: { lastSeenAt: true },
      });
      daysInactive = u?.lastSeenAt
        ? Math.floor((Date.now() - u.lastSeenAt.getTime()) / 86400_000)
        : null;
    }
    return {
      firstName: clientUser?.firstName ?? "Marie",
      daysInactive,
    };
  }

  return {
    firstName: clientUser?.firstName ?? "Marie",
    cart: scenarioKey === "ABANDONED_CART" ? buildFakeCart() : undefined,
  };
}

function buildFakeCart(): { items: CartItemDynamic[]; totalCents: number } {
  const items: CartItemDynamic[] = [
    {
      productName: "Article exemple (aperçu)",
      colorName: "Or",
      quantity: 2,
      totalCents: 4800,
      imagePath: null,
    },
    {
      productName: "Article exemple 2 (aperçu)",
      colorName: null,
      quantity: 1,
      totalCents: 3200,
      imagePath: null,
    },
  ];
  return { items, totalCents: 8000 };
}
