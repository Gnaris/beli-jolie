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
  type HtmlFavorite,
} from "@/lib/newsletter-html-render";
import { missingRequiredMarketingVariables } from "@/lib/mail-merge-variables";
import { buildLegalLine } from "./send-newsletter";
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
      /**
       * Nombre d'articles réellement présents dans le panier de l'utilisateur
       * affiché (scénario ABANDONED_CART uniquement). Permet à l'UI d'afficher
       * un badge « Vrai panier — N articles » ou « Panier vide » sans deviner.
       */
      liveCartCount?: number;
      /**
       * Email du compte dont on affiche le panier (admin en self, ou client
       * sélectionné). Affiché dans le badge pour que la cliente sache d'un
       * coup d'œil sur quel compte le panier est lu.
       */
      previewedEmail: string;
    }
  | { success: false; error: string; missingVariables?: string[] }
> {
  const { tenant, session } = await requireAdmin();
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

  // Résolution du destinataire.
  // - client : on prend ses vraies infos + on lie l'unsubscribe à son userId.
  // - self   : mail envoyé au perso Gmail de l'admin, mais on injecte les
  //            vraies infos de son compte User (nom, société, adresse) pour
  //            que l'aperçu soit fidèle. `adminCartUserId` sert uniquement
  //            au chargement du vrai panier de l'admin dans le scénario
  //            ABANDONED_CART — `clientUserId` reste null (pas de tracking
  //            unsubscribe sur un self-test).
  let toEmail: string;
  let clientUserId: string | null = null;
  let adminCartUserId: string | null = null;
  let userContextBase: Partial<MailMergeContext>;

  if (params.recipient.kind === "self") {
    // « Moi-même » = le compte admin de session, pas le mail perso vérifié.
    // On envoie donc le test au login admin (ex. beliandjolie@gmail.com) et
    // on utilise ses vraies infos + son vrai panier.
    const admin = await prisma.user.findFirst({
      where: { id: session.user.id, tenantId: tenant.id },
      select: {
        id: true, email: true, firstName: true, lastName: true, company: true,
        phone: true, siret: true, vatNumber: true,
        addressStreet: true, addressZip: true, addressCity: true, addressCountry: true,
      },
    });
    if (!admin) {
      return {
        success: false,
        error: "Compte admin introuvable en base — reconnecte-toi.",
      };
    }
    toEmail = admin.email;
    adminCartUserId = admin.id;
    userContextBase = {
      firstName: admin.firstName ?? "",
      lastName: admin.lastName ?? "",
      fullName: [admin.firstName, admin.lastName].filter(Boolean).join(" "),
      email: admin.email,
      company: admin.company ?? "",
      phone: admin.phone ?? "",
      siret: admin.siret ?? "",
      tvaIntra: admin.vatNumber ?? "",
      address: admin.addressStreet ?? "",
      postalCode: admin.addressZip ?? "",
      city: admin.addressCity ?? "",
      country: admin.addressCountry ?? "",
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

  // Contexte dynamique selon le scénario. On charge TOUJOURS le vrai panier
  // de l'utilisateur affiché (client sélectionné OU admin en self) — s'il est
  // vide, la boucle `{{#each cart}}` se développe à vide, l'aperçu montre
  // fidèlement ce que verrait le destinataire à l'envoi.
  const dynamic: HtmlDynamicContext = {};
  let daysForContext: number | null = null;
  let liveCartCount: number | undefined;
  if (scenarioKey === "ABANDONED_CART") {
    const cartUserId = clientUserId ?? adminCartUserId;
    if (cartUserId) {
      const live = await fetchLiveCartForHtml(tenant.id, cartUserId);
      dynamic.cart = live;
      liveCartCount = live.items.length;
    } else {
      dynamic.cart = { items: [], totalCents: 0 };
      liveCartCount = 0;
    }
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
  } else if (scenarioKey === "RESTOCK") {
    // Pour un vrai client sélectionné : on charge ses favoris + historique
    // commandes et on garde ceux qui sont ONLINE + stock > 0. Pour un
    // self-test admin, les 2 listes restent vides (pas de favoris propres).
    if (clientUserId) {
      const live = await fetchLiveRestockForHtml(tenant.id, clientUserId);
      dynamic.favorites = live.favorites;
      dynamic.ordered = live.ordered;
    }
  }

  const cartTotalCents = dynamic.cart?.totalCents ?? 0;
  const cartCount = dynamic.cart?.items.length ?? 0;
  const favoritesCount = dynamic.favorites?.length ?? 0;
  const orderedCount = dynamic.ordered?.length ?? 0;

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
    orderedCount: String(orderedCount),
    restockTotal: String(favoritesCount + orderedCount),
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
    liveCartCount,
    previewedEmail: toEmail,
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
  | {
      success: true;
      html: string;
      subject: string;
      liveCartCount?: number;
      previewedEmail: string;
    }
  | { success: false; error: string }
> {
  try {
    const built = await buildRenderedHtml({ ...params, requireMarketingTokens: false });
    if (!built.success) return built;
    return {
      success: true,
      html: built.html,
      subject: built.subject,
      liveCartCount: built.liveCartCount,
      previewedEmail: built.previewedEmail,
    };
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
              colorId: true,
              unitPrice: true,
              stock: true,
              saleType: true,
              packQuantity: true,
              color: { select: { name: true } },
              product: {
                select: {
                  name: true,
                  status: true,
                  primaryColorId: true,
                  // Toutes les images du produit — on résout la bonne en JS
                  // par colorId (voir plus bas). Nécessaire parce que
                  // `ProductColorImage` est en modèle hybride : les images
                  // legacy ont `productColorId=null` et ne remontent donc PAS
                  // via `variant.images` (link direct). Ici on passe par la
                  // relation `product.colorImages` qui n'a pas ce trou.
                  colorImages: {
                    orderBy: { order: "asc" },
                    select: { colorId: true, path: true },
                  },
                },
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
  const items: HtmlCartItem[] = validItems.map((it) => {
    const productImages = it.variant.product.colorImages;
    const forThisColor = productImages.find((img) => img.colorId === it.variant.colorId);
    const forPrimary = productImages.find(
      (img) => img.colorId === it.variant.product.primaryColorId,
    );
    const anyImage = productImages[0];
    const imagePath = forThisColor?.path ?? forPrimary?.path ?? anyImage?.path ?? null;
    return {
      productName: it.variant.product.name,
      colorName: it.variant.color?.name ?? null,
      quantity: it.quantity,
      totalCents: Math.round(Number(it.variant.unitPrice) * 100) * it.quantity,
      imagePath,
    };
  });
  const totalCents = items.reduce((s, it) => s + it.totalCents, 0);
  return { items, totalCents };
}

/**
 * Charge l'aperçu RESTOCK pour un utilisateur donné : ses favoris + les
 * produits de ses commandes passées (non annulées) qui sont actuellement
 * ONLINE avec stock > 0. Priorité favoris : un produit à la fois favori ET
 * déjà commandé apparaît uniquement dans la section favoris (évite les
 * doublons visuels, aligné sur la règle du worker prod).
 *
 * Note : contrairement au worker réel qui ne liste QUE les produits qui
 * viennent de revenir en stock sur la fenêtre du compteur, cet aperçu
 * montre TOUS les favoris / commandés en stock pour que la cliente voie
 * à quoi ressemble le mail quand il est bien rempli. Si vous voulez
 * reproduire exactement l'envoi réel, préférez le bouton « Envoyer un
 * test » après avoir fait baisser puis remonter un stock.
 */
async function fetchLiveRestockForHtml(
  tenantId: string,
  userId: string,
): Promise<{ favorites: HtmlFavorite[]; ordered: HtmlFavorite[] }> {
  // 1. Favoris du user → productIds.
  const favorites = await prisma.favorite.findMany({
    where: { userId, tenantId },
    select: { productId: true },
  });
  const favoriteProductIds = new Set(favorites.map((f) => f.productId));

  // 2. Historique commandes (non annulées) → productIds via OrderItem.
  //    `OrderItem.productColorId` est nullable (ligne historique non liée) ;
  //    on retombe sur Product.reference pour couvrir ces cas.
  const orderItems = await prisma.orderItem.findMany({
    where: {
      order: { userId, tenantId, status: { not: "CANCELLED" } },
    },
    select: { productColorId: true, productRef: true },
  });
  const orderedVariantIds = Array.from(
    new Set(
      orderItems
        .map((o) => o.productColorId)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const orderedRefs = Array.from(
    new Set(orderItems.map((o) => o.productRef).filter(Boolean)),
  );
  const [orderedByVariant, orderedByRef] = await Promise.all([
    orderedVariantIds.length === 0
      ? Promise.resolve([] as { productId: string }[])
      : prisma.productColor.findMany({
          where: { id: { in: orderedVariantIds } },
          select: { productId: true },
        }),
    orderedRefs.length === 0
      ? Promise.resolve([] as { id: string }[])
      : prisma.product.findMany({
          where: { tenantId, reference: { in: orderedRefs } },
          select: { id: true },
        }),
  ]);
  const orderedProductIds = new Set<string>([
    ...orderedByVariant.map((o) => o.productId),
    ...orderedByRef.map((p) => p.id),
  ]);

  // Union des produits concernés.
  const allProductIds = new Set<string>([
    ...favoriteProductIds,
    ...orderedProductIds,
  ]);
  if (allProductIds.size === 0) {
    return { favorites: [], ordered: [] };
  }

  // 3. Pour chaque produit, on prend la variante ONLINE+stock>0 la mieux
  //    classée (isPrimary d'abord, puis ordre naturel). Produits OFFLINE
  //    ou entièrement en rupture : ignorés.
  const products = await prisma.product.findMany({
    where: {
      id: { in: [...allProductIds] },
      status: "ONLINE",
    },
    select: {
      id: true,
      name: true,
      primaryColorId: true,
      colors: {
        // Décision cliente : uniquement variantes UNIT dans le mail restock
        // (évite les doublons taille/couleur si plusieurs PACK reviennent).
        where: { stock: { gt: 0 }, disabled: false, saleType: "UNIT" },
        orderBy: [{ isPrimary: "desc" }],
        take: 1,
        select: {
          unitPrice: true,
          color: { select: { name: true } },
          images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
        },
      },
      colorImages: {
        orderBy: { order: "asc" },
        take: 1,
        select: { path: true },
      },
    },
  });

  const favoritesLines: HtmlFavorite[] = [];
  const orderedLines: HtmlFavorite[] = [];
  for (const p of products) {
    const variant = p.colors[0];
    if (!variant) continue; // tout en rupture / désactivé
    const imagePath =
      variant.images[0]?.path ?? p.colorImages[0]?.path ?? null;
    const line: HtmlFavorite = {
      productName: p.name,
      colorName: variant.color?.name ?? null,
      priceCents: Math.round(Number(variant.unitPrice) * 100),
      imagePath,
    };
    // Priorité favoris : si le produit est dans les favoris du user, il
    // va dans la section favoris. Sinon section « déjà commandés ».
    if (favoriteProductIds.has(p.id)) {
      favoritesLines.push(line);
    } else if (orderedProductIds.has(p.id)) {
      orderedLines.push(line);
    }
  }
  return { favorites: favoritesLines, ordered: orderedLines };
}
