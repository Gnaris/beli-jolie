"use server";

/**
 * Preview + envoi de test pour les modèles newsletter format="html".
 *
 * Symétrique de `sendTestNewsletterEmail` (blocks) : mêmes semantics de
 * résolution destinataire (`self` = mail perso admin, `client` = vrai
 * client), mêmes filets RGPD/LCEN (refus si {shopName}/{shopAddress} vides),
 * mais le rendu passe par `renderNewsletterHtmlForSend` — pas de blocs
 * dynamiques (cart/favorites) puisque le HTML est écrit libre par la cliente.
 */

import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/email";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { getCachedShopName } from "@/lib/cached-data";
import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";
import { buildUnsubscribeUrl } from "@/lib/newsletter-unsubscribe-token";
import {
  renderNewsletterHtmlForSend,
  type HtmlCartItem,
  type HtmlDynamicContext,
} from "@/lib/newsletter-html-render";
import { missingRequiredMarketingVariables } from "@/lib/mail-merge-variables";
import { getAdminSelfEmail, buildLegalLine } from "./send-newsletter";
import type { ProductStatus } from "@prisma/client";

/**
 * Charge un modèle HTML + sa bibliothèque d'images + les infos du destinataire
 * (client réel ou admin en test), construit le contexte de merge et retourne
 * le HTML final rendu. Utilisé pour :
 *   - alimenter l'iframe d'aperçu de l'éditeur quand un client est sélectionné,
 *   - servir de source au bouton « Envoyer un test » (même pipeline exact).
 */
async function buildRenderedHtml(params: {
  templateId: string;
  recipient: { kind: "self" } | { kind: "client"; userId: string };
  /**
   * HTML courant côté éditeur (non encore enregistré) — permet à l'aperçu
   * client de refléter EXACTEMENT ce que la cliente est en train de taper.
   * Si absent, on retombe sur `template.html` de la BDD.
   */
  htmlOverride?: string;
  subjectOverride?: string;
  /**
   * Si `true`, valide que les 4 tokens marketing obligatoires (RGPD/LCEN)
   * sont présents dans le HTML. Utilisé pour le bouton « Envoyer un test »
   * (on refuse d'expédier un mail non conforme) — pas pour l'aperçu (on
   * veut voir même un modèle en cours d'écriture).
   */
  requireMarketingTokens?: boolean;
}): Promise<
  | {
      success: true;
      html: string;
      subject: string;
      toEmail: string;
      clientUserId: string | null;
      unsubscribeLink: string;
    }
  | { success: false; error: string; missingVariables?: string[] }
> {
  const { tenant } = await requireAdmin();
  const template = await prisma.newsletterTemplate.findFirst({
    where: { id: params.templateId, tenantId: tenant.id },
    include: {
      images: {
        orderBy: { createdAt: "asc" },
        select: { name: true, path: true },
      },
    },
  });
  if (!template) return { success: false, error: "Modèle introuvable." };
  if (template.format !== "html") {
    return { success: false, error: "Ce modèle n'est pas au format HTML." };
  }
  const scenarioKey = template.scenarioKey;

  const sourceHtml = params.htmlOverride ?? template.html ?? "";
  const sourceSubject = params.subjectOverride ?? template.subject;

  if (params.requireMarketingTokens) {
    const missing = missingRequiredMarketingVariables(sourceHtml);
    if (missing.length > 0) {
      return {
        success: false,
        error: `Impossible d'envoyer le test : ces mentions légales obligatoires manquent dans le HTML — ${missing.map((v) => `{${v.token}}`).join(", ")}.`,
        missingVariables: missing.map((v) => v.token),
      };
    }
  }

  // Résolution du destinataire — même logique que sendTestNewsletterEmail
  // pour rester cohérent (admin en test = valeurs neutres « Marie Dupont »).
  let toEmail: string;
  let clientUserId: string | null = null;
  let userContextBase: Partial<MailMergeContext>;

  if (params.recipient.kind === "self") {
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
      where: { id: params.recipient.userId, tenantId: tenant.id, role: "CLIENT" },
      select: {
        id: true, email: true, firstName: true, lastName: true, company: true,
        phone: true, siret: true, vatNumber: true,
        addressStreet: true, addressZip: true, addressCity: true, addressCountry: true,
      },
    });
    if (!user) return { success: false, error: "Client introuvable." };
    toEmail = user.email;
    clientUserId = user.id;
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

  const [shopName, baseUrl, companyInfo] = await Promise.all([
    getCachedShopName(),
    getCurrentTenantBaseUrl(),
    prisma.companyInfo.findFirst({
      where: { tenantId: tenant.id },
      select: {
        address: true, postalCode: true, city: true,
        email: true, phone: true, website: true,
      },
    }),
  ]);

  const shopAddress = companyInfo
    ? [
        companyInfo.address,
        [companyInfo.postalCode, companyInfo.city].filter(Boolean).join(" "),
      ].filter(Boolean).join(", ")
    : "";
  if (!shopName.trim() || !shopAddress.trim()) {
    return {
      success: false,
      error:
        "Nom de boutique ou adresse manquant dans les infos entreprise. " +
        "Ouvre Paramètres → Boutique et complète tes coordonnées avant d'envoyer un mail de test.",
    };
  }

  const unsubscribeLink = clientUserId
    ? buildUnsubscribeUrl({ baseUrl, userId: clientUserId, tenantId: tenant.id })
    : `${baseUrl}/fr`;

  // Contexte dynamique selon le scénario. Pour un scénario auto testé sur
  // un vrai client, on injecte ses vraies données (cart, days). Pour un
  // self-test ou un client sans données live, on tombe sur un aperçu factice
  // qui montre le rendu attendu (sinon la boucle {{#each cart}} rendrait vide).
  const dynamic: HtmlDynamicContext = {};
  let daysForContext: number | null = null;
  if (scenarioKey === "ABANDONED_CART") {
    dynamic.cart = clientUserId
      ? await fetchLiveCartForHtml(tenant.id, clientUserId)
      : buildFakeCart();
    // Si le vrai panier est vide, on retombe sur un panier fictif pour que
    // l'aperçu / test soit toujours démonstratif.
    if (dynamic.cart.items.length === 0) dynamic.cart = buildFakeCart();
  } else if (scenarioKey === "INACTIVE_CLIENT") {
    if (clientUserId) {
      const u = await prisma.user.findFirst({
        where: { id: clientUserId, tenantId: tenant.id },
        select: { lastSeenAt: true },
      });
      daysForContext = u?.lastSeenAt
        ? Math.floor((Date.now() - u.lastSeenAt.getTime()) / 86400_000)
        : null;
    } else {
      daysForContext = 45; // valeur d'aperçu pour un self-test admin
    }
  }
  // RESTOCK : pas d'implémentation live pour le test — la boucle {{#each favorites}}
  // rendra vide au test. Le worker prod fournit les vraies données.

  const cartTotalCents = dynamic.cart?.totalCents ?? 0;
  const cartCount = dynamic.cart?.items.length ?? 0;
  const favoritesCount = dynamic.favorites?.length ?? 0;

  const mergeContext: MailMergeContext = {
    ...userContextBase,
    shopName,
    shopAddress,
    shopEmail: companyInfo?.email ?? "",
    shopPhone: companyInfo?.phone ?? "",
    shopWebsite: companyInfo?.website ?? baseUrl.replace(/^https?:\/\//, ""),
    unsubscribeLink,
    privacyLink: `${baseUrl}/fr/confidentialite`,
    // Tokens dynamiques scénario — inutiles pour un modèle libre, mais
    // les mettre systématiquement n'a pas d'effet (interpolate ignore les
    // tokens absents du HTML).
    cartTotal: (cartTotalCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }),
    cartCount: String(cartCount),
    days: daysForContext == null ? "" : String(daysForContext),
    favoritesCount: String(favoritesCount),
  };

  const html = renderNewsletterHtmlForSend({
    html: sourceHtml,
    images: template.images,
    baseUrl,
    mergeContext,
    dynamic,
  });
  const subject = interpolate(sourceSubject, mergeContext);

  return {
    success: true,
    html,
    subject,
    toEmail,
    clientUserId,
    unsubscribeLink,
  };
}

/**
 * Renvoie le HTML final tel qu'il partira au destinataire — utilisé dans
 * l'éditeur pour montrer un aperçu réaliste avec les vraies données du client
 * (nom, prénom, adresse…) OU avec les valeurs neutres « Marie Dupont » pour
 * le self.
 */
export async function getNewsletterHtmlPreview(params: {
  templateId: string;
  recipient: { kind: "self" } | { kind: "client"; userId: string };
  /** HTML courant (non encore sauvé) — permet un aperçu en temps réel. */
  htmlOverride?: string;
  subjectOverride?: string;
}): Promise<
  | { success: true; html: string; subject: string }
  | { success: false; error: string }
> {
  try {
    const built = await buildRenderedHtml({ ...params, requireMarketingTokens: false });
    if (!built.success) return built;
    return { success: true, html: built.html, subject: built.subject };
  } catch (err) {
    logger.error("[getNewsletterHtmlPreview]", { params, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Envoie le modèle HTML courant en test à un destinataire unique. Même sujet
 * marqué `[TEST HH:MM:SS]` que le format blocks, même trace EmailSend
 * (categorie NEWSLETTER, source="test").
 */
export async function sendTestNewsletterHtmlEmail(params: {
  templateId: string;
  recipient: { kind: "self" } | { kind: "client"; userId: string };
  /**
   * HTML courant (non encore sauvé) — le test envoie ce qu'affiche l'éditeur,
   * pas ce qui est en BDD. Filet RGPD : les 4 tokens légaux obligatoires sont
   * revérifiés côté serveur avant expédition (voir `requireMarketingTokens`).
   */
  htmlOverride?: string;
  subjectOverride?: string;
}): Promise<
  | { success: true; sentTo: string }
  | { success: false; error: string }
> {
  try {
    const built = await buildRenderedHtml({ ...params, requireMarketingTokens: true });
    if (!built.success) return built;
    const { tenant } = await requireAdmin();
    const shopName = await getCachedShopName();
    // Legal line calculée dans le contexte partagé — le HTML libre n'a pas de
    // header/footer partagé (la cliente compose tout via ses balises).
    await buildLegalLine(tenant.id);

    const stamp = new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const testSubject = `[TEST ${stamp}] ${built.subject}`;

    const result = await sendMail({
      to: built.toEmail,
      subject: testSubject,
      html: built.html,
      fromName: shopName,
      listUnsubscribeUrl: built.clientUserId ? built.unsubscribeLink : undefined,
      tracking: {
        scenarioKey: "NEWSLETTER",
        userId: built.clientUserId,
        metadata: {
          source: "test",
          templateId: params.templateId,
          recipientKind: params.recipient.kind,
          format: "html",
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
    return { success: true, sentTo: built.toEmail };
  } catch (err) {
    logger.error("[sendTestNewsletterHtmlEmail]", { params, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/* ─────────────────────────────────────────────
   Helpers scénarios : panier live + panier factice
   ───────────────────────────────────────────── */

async function fetchLiveCartForHtml(
  tenantId: string,
  userId: string,
): Promise<{ items: HtmlCartItem[]; totalCents: number }> {
  const cart = await prisma.cart.findFirst({
    where: { userId, user: { tenantId } },
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
              images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
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
  const items: HtmlCartItem[] = validItems.map((it) => ({
    productName: it.variant.product.name,
    colorName: it.variant.color?.name ?? null,
    quantity: it.quantity,
    totalCents: Math.round(Number(it.variant.unitPrice) * 100) * it.quantity,
    imagePath: it.variant.images[0]?.path ?? null,
  }));
  const totalCents = items.reduce((s, it) => s + it.totalCents, 0);
  return { items, totalCents };
}

function buildFakeCart(): { items: HtmlCartItem[]; totalCents: number } {
  const items: HtmlCartItem[] = [
    { productName: "Article exemple (aperçu)", colorName: "Or", quantity: 2, totalCents: 4800, imagePath: null },
    { productName: "Autre article (aperçu)", colorName: "Argent", quantity: 1, totalCents: 3200, imagePath: null },
  ];
  return { items, totalCents: items.reduce((s, i) => s + i.totalCents, 0) };
}
