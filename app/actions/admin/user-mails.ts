"use server";

/**
 * Server actions pour la Vue Mails de /admin/clients.
 *
 * Ces actions préparent le contexte affiché dans la modale « Envoyer un mail »
 * (panier, inactivité, favoris en rupture) + les avertissements contextuels
 * (déjà envoyé récemment, panier vide, etc.).
 *
 * L'envoi réel des mails est traité à l'étape 3 (templates HTML + sendMail).
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/email";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { getCachedShopName } from "@/lib/cached-data";
import {
  renderNewsletterHtmlForSend,
  type HtmlCartItem,
} from "@/lib/newsletter-html-render";
import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";
import { buildUnsubscribeUrl } from "@/lib/newsletter-unsubscribe-token";
import {
  computeMailGates,
  hasBlockers,
  listMailConditions,
  type MailScenario as GateMailScenario,
  type MailGateInput,
  type MailCondition,
} from "@/lib/mail-gates";

// Note : on ne peut PAS re-exporter des types depuis un fichier "use server".
// Les consommateurs client doivent importer MailCondition directement depuis
// "@/lib/mail-gates".
export type MailScenario = GateMailScenario;

export interface MailScenarioContext {
  key: MailScenario;
  /** true si tous les blockers sont passés (le bouton peut envoyer). */
  canSend: boolean;
  /** Ligne descriptive de l'état actuel (« Panier de 3 articles laissé depuis 2j »). */
  contextLine: string;
  /** Date du dernier envoi de ce type à ce client, ou null. */
  lastSentAt: Date | null;
  /** Blockers formatés (raisons pour lesquelles l'envoi est refusé). */
  blockers: string[];
  /** Warnings non-bloquants (envoyable mais douteux). */
  warnings: string[];
  /** Liste complète des conditions applicables (grille UI ✓/✗). */
  conditions: MailCondition[];
}

export interface CartItemPreview {
  productName: string;
  colorName: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  imagePath: string | null;
}

export interface FavoritePreview {
  productName: string;
  colorName: string | null;
  priceCents: number;
  imagePath: string | null;
}

export interface PreviewData {
  /** Contenu réel du panier du client (vide si aucun panier). */
  cart: {
    items: CartItemPreview[];
    totalCents: number;
    updatedAt: Date | null;
  };
  /** Jours depuis la dernière activité (null si jamais connecté). */
  daysSinceLastActivity: number | null;
  /** Favoris du client disponibles en stock. */
  favoritesInStock: FavoritePreview[];
  /** Prénom pour personnalisation (« Bonjour Marie »). */
  firstName: string;
}

export interface ClientMailContext {
  userId: string;
  userLabel: string;
  userEmail: string;
  scenarios: Record<MailScenario, MailScenarioContext>;
  preview: PreviewData;
}

const RECENT_RESTOCK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

function hoursBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (60 * 60 * 1000));
}

function formatDaysAgo(days: number): string {
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} jours`;
}

/**
 * Charge tout le contexte nécessaire pour afficher la modale « Envoyer un mail »
 * pour un client donné. Retourne l'état des 4 scénarios en une seule requête.
 */
export async function getClientMailContext(
  userId: string,
): Promise<{ success: true; data: ClientMailContext } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const now = new Date();

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: tenant.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        company: true,
        lastLoginAt: true,
        lastSeenAt: true,
        acceptsNewsletter: true,
        status: true,
      },
    });
    if (!user) return { success: false, error: "Client introuvable." };
    const loadedUser = user;

    // Nombre de commandes passées (nécessaire pour le gate INACTIVE_CLIENT)
    const orderCount = await prisma.order.count({
      where: { userId, tenantId: tenant.id },
    });

    // Panier en cours — avec les items complets (photo, prix, quantité, stock) pour l'aperçu réel
    const cart = await prisma.cart.findFirst({
      where: { userId },
      select: {
        id: true,
        updatedAt: true,
        items: {
          select: {
            quantity: true,
            variant: {
              select: {
                unitPrice: true,
                stock: true,
                color: { select: { name: true } },
                product: { select: { name: true } },
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

    const cartItemsPreview: CartItemPreview[] = cart
      ? cart.items.map((line) => {
          const unitPriceCents = Math.round(Number(line.variant.unitPrice) * 100);
          return {
            productName: line.variant.product.name,
            colorName: line.variant.color?.name ?? null,
            quantity: line.quantity,
            unitPriceCents,
            totalCents: unitPriceCents * line.quantity,
            imagePath: line.variant.images[0]?.path ?? null,
          };
        })
      : [];
    const cartTotalCents = cartItemsPreview.reduce((s, i) => s + i.totalCents, 0);
    const cartAllOutOfStock =
      cart != null && cart.items.length > 0 && cart.items.every((i) => i.variant.stock <= 0);

    // Favoris dont au moins une variante du produit a du stock.
    // Charge les données complètes (produit, prix, photo) pour l'aperçu réel.
    const favoritesRaw = await prisma.favorite.findMany({
      where: {
        userId,
        product: { colors: { some: { stock: { gt: 0 } } } },
      },
      take: 6,
      orderBy: { createdAt: "desc" },
      select: {
        product: {
          select: {
            name: true,
            colors: {
              where: { stock: { gt: 0 } },
              take: 1,
              select: {
                id: true,
                unitPrice: true,
                color: { select: { name: true } },
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

    const favoritesInStockPreview: FavoritePreview[] = favoritesRaw
      .filter((f) => f.product.colors.length > 0)
      .map((f) => {
        const variant = f.product.colors[0];
        return {
          productName: f.product.name,
          colorName: variant.color?.name ?? null,
          priceCents: Math.round(Number(variant.unitPrice) * 100),
          imagePath: variant.images[0]?.path ?? null,
        };
      });
    const favoritesInStock = favoritesInStockPreview.length;

    // Compte des favoris récemment revenus en stock (StockMovement + quantity dans
    // les 7 derniers jours sur les ProductColor des favoris).
    const favoriteColorIds = favoritesRaw
      .flatMap((f) => f.product.colors.map((c) => c.id))
      .filter((id): id is string => Boolean(id));
    let recentlyRestockedCount = 0;
    if (favoriteColorIds.length > 0) {
      const recentPositiveMoves = await prisma.stockMovement.findMany({
        where: {
          tenantId: tenant.id,
          productColorId: { in: favoriteColorIds },
          quantity: { gt: 0 },
          createdAt: { gte: new Date(now.getTime() - RECENT_RESTOCK_WINDOW_MS) },
        },
        distinct: ["productColorId"],
        select: { productColorId: true },
      });
      recentlyRestockedCount = recentPositiveMoves.length;
    }

    const daysSinceLastActivity = user.lastSeenAt ?? user.lastLoginAt
      ? daysBetween(now, (user.lastSeenAt ?? user.lastLoginAt) as Date)
      : null;

    // Derniers envois pour chaque scénario (une requête groupée)
    const grouped = await prisma.emailSend.groupBy({
      by: ["scenarioKey"],
      where: {
        tenantId: tenant.id,
        userId,
        scenarioKey: { in: ["ABANDONED_CART", "INACTIVE_CLIENT", "NEWSLETTER", "RESTOCK"] },
      },
      _max: { sentAt: true },
    });
    const lastSends: Record<MailScenario, Date | null> = {
      ABANDONED_CART: null,
      INACTIVE_CLIENT: null,
      NEWSLETTER: null,
      RESTOCK: null,
    };
    for (const row of grouped) {
      lastSends[row.scenarioKey as MailScenario] = row._max.sentAt ?? null;
    }

    // ─── Base d'entrée pour computeMailGates (indépendante du scenario) ───
    const lastMarketingSentAt = (Object.values(lastSends) as (Date | null)[]).reduce<Date | null>(
      (max, d) => (d && (!max || d > max) ? d : max),
      null,
    );
    const gateInputBase: Omit<MailGateInput, "scenario"> = {
      now,
      acceptsNewsletter: loadedUser.acceptsNewsletter,
      status: loadedUser.status,
      cart: {
        itemCount: cartItemsPreview.length,
        updatedAt: cart?.updatedAt ?? null,
        allOutOfStock: cartAllOutOfStock,
      },
      activity: {
        lastActivityAt: loadedUser.lastSeenAt ?? loadedUser.lastLoginAt ?? null,
        daysSinceLastActivity,
      },
      history: { orderCount },
      favorites: {
        inStockCount: favoritesInStock,
        recentlyRestockedCount,
      },
      // Initial : 0 produit sélectionné. La modale recalcule les gates RESTOCK
      // côté client au fur et à mesure que l'admin ajoute/retire des produits.
      selectedProducts: { count: 0, allInStock: true },
      lastSentByScenario: lastSends,
      lastMarketingSentAt,
    };

    // ─── ContextLine descriptif (indépendant des gates, purement informatif) ───
    function contextLineFor(scenario: MailScenario): string {
      switch (scenario) {
        case "ABANDONED_CART": {
          if (cartItemsPreview.length === 0) return "Ce client n'a pas de panier en cours.";
          const ageH = cart ? hoursBetween(now, cart.updatedAt) : 0;
          const ageLabel = ageH < 24 ? `${ageH}h` : `${Math.floor(ageH / 24)}j`;
          return `Panier de ${cartItemsPreview.length} article${cartItemsPreview.length > 1 ? "s" : ""} laissé depuis ${ageLabel}.`;
        }
        case "INACTIVE_CLIENT": {
          const lastActivity = loadedUser.lastSeenAt ?? loadedUser.lastLoginAt ?? null;
          if (!lastActivity) return "Ce client ne s'est jamais connecté.";
          return `Dernière connexion ${formatDaysAgo(daysBetween(now, lastActivity))}.`;
        }
        case "NEWSLETTER":
          return "Envoi d'un modèle newsletter enregistré.";
        case "RESTOCK":
          return "Sélectionnez un ou plusieurs produits à annoncer au client.";
      }
    }

    function buildScenario(scenario: MailScenario): MailScenarioContext {
      const gateInput = { ...gateInputBase, scenario };
      const gates = computeMailGates(gateInput);
      return {
        key: scenario,
        canSend: !hasBlockers(gates),
        contextLine: contextLineFor(scenario),
        lastSentAt: lastSends[scenario],
        blockers: gates.filter((g) => g.level === "blocker").map((g) => g.message),
        warnings: gates.filter((g) => g.level === "warning").map((g) => g.message),
        conditions: listMailConditions(gateInput),
      };
    }

    const abandoned  = buildScenario("ABANDONED_CART");
    const inactive   = buildScenario("INACTIVE_CLIENT");
    const newsletter = buildScenario("NEWSLETTER");
    const restock    = buildScenario("RESTOCK");

    return {
      success: true,
      data: {
        userId: loadedUser.id,
        userLabel: `${loadedUser.firstName ?? ""} ${loadedUser.lastName ?? ""}`.trim() || loadedUser.company || loadedUser.email,
        userEmail: loadedUser.email,
        scenarios: {
          ABANDONED_CART: abandoned,
          INACTIVE_CLIENT: inactive,
          NEWSLETTER: newsletter,
          RESTOCK: restock,
        },
        preview: {
          cart: {
            items: cartItemsPreview,
            totalCents: cartTotalCents,
            updatedAt: cart?.updatedAt ?? null,
          },
          daysSinceLastActivity,
          favoritesInStock: favoritesInStockPreview,
          firstName: (loadedUser.firstName?.trim() || loadedUser.company || "cliente").split(/\s+/)[0],
        },
      },
    };
  } catch (err) {
    logger.error("[getClientMailContext]", { userId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

// ═══════════════════════════════════════════════════════════
// Envoi manuel d'un mail (Panier / Inactivité)
// - Newsletter → sendNewsletterToUsers (modale de choix de modèle).
// - RESTOCK   → refusé temporairement : la refonte du scénario (stades
//   dédiés + choix de produits couplé à la config auto) est encore à faire.
// ═══════════════════════════════════════════════════════════

const RESTOCK_DISABLED_MESSAGE =
  "Le mail Retour en stock est en cours de finalisation — cette relance sera activée dans un prochain lot.";

/** Charge le stade demandé (delay, template, images) pour un scénario à stades. */
async function loadStageForScenario(
  tenantId: string,
  scenario: "ABANDONED_CART" | "INACTIVE_CLIENT",
  stageIndex: number,
): Promise<
  | {
      ok: true;
      stage: {
        stageIndex: number;
        delaySeconds: number;
        template: {
          id: string;
          name: string;
          subject: string;
          html: string | null;
          images: { name: string; path: string }[];
        };
      };
    }
  | { ok: false; error: string }
> {
  if (!Number.isInteger(stageIndex) || stageIndex < 1) {
    return { ok: false, error: "Stade invalide — choisis un stade dans la liste." };
  }
  const row =
    scenario === "ABANDONED_CART"
      ? await prisma.abandonedCartStage.findFirst({
          where: { tenantId, stageIndex },
          select: {
            stageIndex: true,
            delaySeconds: true,
            template: {
              select: {
                id: true,
                name: true,
                subject: true,
                html: true,
                images: { select: { name: true, path: true } },
              },
            },
          },
        })
      : await prisma.inactiveClientStage.findFirst({
          where: { tenantId, stageIndex },
          select: {
            stageIndex: true,
            delaySeconds: true,
            template: {
              select: {
                id: true,
                name: true,
                subject: true,
                html: true,
                images: { select: { name: true, path: true } },
              },
            },
          },
        });
  if (!row) {
    return {
      ok: false,
      error: `Aucun Stade ${stageIndex} configuré pour ce scénario — vérifie tes modèles dans /admin/marketing/mails.`,
    };
  }
  return { ok: true, stage: row };
}

// ─── Types partagés stade / preview ───────────────────

export interface ScenarioStageSummary {
  stageIndex: number;
  templateId: string;
  subject: string;
  templateName: string;
  delaySeconds: number;
  /** Le HTML source contient-il du contenu ? (sert à griser les stades vides). */
  hasContent: boolean;
  /** {unsubscribeLink} présent dans le source — sinon envoi refusé côté serveur. */
  hasUnsubscribeToken: boolean;
}

/**
 * Liste les stades configurés pour un scénario donné (panier abandonné ou
 * inactivité), triés par ordre croissant. Alimente le sélecteur « Quel stade
 * envoyer ? » de la modale d'envoi manuel.
 */
export async function listStagesForScenario(
  scenario: "ABANDONED_CART" | "INACTIVE_CLIENT",
): Promise<
  | { success: true; stages: ScenarioStageSummary[] }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    const rows =
      scenario === "ABANDONED_CART"
        ? await prisma.abandonedCartStage.findMany({
            where: { tenantId: tenant.id },
            orderBy: { stageIndex: "asc" },
            select: {
              stageIndex: true,
              delaySeconds: true,
              template: {
                select: { id: true, name: true, subject: true, html: true },
              },
            },
          })
        : await prisma.inactiveClientStage.findMany({
            where: { tenantId: tenant.id },
            orderBy: { stageIndex: "asc" },
            select: {
              stageIndex: true,
              delaySeconds: true,
              template: {
                select: { id: true, name: true, subject: true, html: true },
              },
            },
          });
    const stages: ScenarioStageSummary[] = rows.map((r) => {
      const src = r.template.html ?? "";
      return {
        stageIndex: r.stageIndex,
        templateId: r.template.id,
        subject: r.template.subject,
        templateName: r.template.name,
        delaySeconds: r.delaySeconds,
        hasContent: src.trim().length > 0,
        hasUnsubscribeToken: src.includes("{unsubscribeLink}"),
      };
    });
    return { success: true, stages };
  } catch (err) {
    logger.error("[listStagesForScenario]", { scenario, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Aperçu HTML final d'un stade pour un client donné — même pipeline que
 * l'envoi réel (`sendManualMail` + worker auto). Injecte le panier live pour
 * ABANDONED_CART et le nombre de jours d'inactivité pour INACTIVE_CLIENT.
 * Ce que la cliente voit dans l'iframe = ce que le destinataire recevra.
 */
export async function getScenarioStagePreviewHtml(
  userId: string,
  scenario: "ABANDONED_CART" | "INACTIVE_CLIENT",
  stageIndex: number,
): Promise<
  | { success: true; html: string; subject: string }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();

    const ctxRes = await getClientMailContext(userId);
    if (!ctxRes.success) return { success: false, error: ctxRes.error };
    const ctx = ctxRes.data;

    const stageRes = await loadStageForScenario(tenant.id, scenario, stageIndex);
    if (!stageRes.ok) return { success: false, error: stageRes.error };

    const rendered = await renderStageForUser({
      tenantId: tenant.id,
      userId,
      scenario,
      stage: stageRes.stage,
      ctx,
    });
    if (!rendered.ok) return { success: false, error: rendered.error };
    return { success: true, html: rendered.html, subject: rendered.subject };
  } catch (err) {
    logger.error("[getScenarioStagePreviewHtml]", {
      userId,
      scenario,
      stageIndex,
      error: err as Error,
    });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Rend le HTML final d'un stade pour un utilisateur donné en réutilisant le
 * pipeline d'envoi automatique (`renderNewsletterHtmlForSend`). Utilisé à la
 * fois par la preview et par l'envoi manuel — un seul chemin de rendu, pour
 * que l'aperçu ne mente jamais sur le mail réel.
 */
async function renderStageForUser({
  tenantId,
  userId,
  scenario,
  stage,
  ctx,
}: {
  tenantId: string;
  userId: string;
  scenario: "ABANDONED_CART" | "INACTIVE_CLIENT";
  stage: {
    stageIndex: number;
    delaySeconds: number;
    template: {
      id: string;
      name: string;
      subject: string;
      html: string | null;
      images: { name: string; path: string }[];
    };
  };
  ctx: ClientMailContext;
}): Promise<
  | { ok: true; html: string; subject: string; mergeContext: MailMergeContext }
  | { ok: false; error: string }
> {
  const templateHtml = stage.template.html ?? "";
  if (!templateHtml.trim()) {
    return {
      ok: false,
      error: `Le Stade ${stage.stageIndex} n'a pas de contenu HTML — édite-le dans /admin/marketing/mails avant l'envoi.`,
    };
  }

  const [shopName, baseUrl, companyInfo, fullUser] = await Promise.all([
    getCachedShopName(),
    getCurrentTenantBaseUrl(),
    prisma.companyInfo.findFirst({
      where: { tenantId },
      select: { address: true, postalCode: true, city: true, email: true, phone: true, website: true },
    }),
    prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        firstName: true, lastName: true, email: true, company: true, phone: true,
        siret: true, vatNumber: true, addressStreet: true, addressZip: true,
        addressCity: true, addressCountry: true,
      },
    }),
  ]);

  const shopAddress = companyInfo
    ? [companyInfo.address, [companyInfo.postalCode, companyInfo.city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";
  if (!shopName.trim() || !shopAddress.trim()) {
    return {
      ok: false,
      error:
        "Nom de boutique ou adresse manquant dans les infos entreprise. " +
        "Ouvre Paramètres → Boutique et complète tes coordonnées avant d'envoyer ce mail.",
    };
  }

  const shopContext: MailMergeContext = {
    shopName,
    shopAddress,
    shopEmail: companyInfo?.email ?? "",
    shopPhone: companyInfo?.phone ?? "",
    shopWebsite: companyInfo?.website ?? baseUrl.replace(/^https?:\/\//, ""),
  };

  const cartItems: HtmlCartItem[] =
    scenario === "ABANDONED_CART"
      ? ctx.preview.cart.items.map((it) => ({
          productName: it.productName,
          colorName: it.colorName,
          quantity: it.quantity,
          totalCents: it.totalCents,
          imagePath: it.imagePath,
        }))
      : [];
  const cartTotalCents = ctx.preview.cart.totalCents;

  const userContext: MailMergeContext = {
    ...shopContext,
    firstName: fullUser?.firstName ?? ctx.preview.firstName,
    lastName: fullUser?.lastName ?? "",
    fullName: `${fullUser?.firstName ?? ""} ${fullUser?.lastName ?? ""}`.trim(),
    email: fullUser?.email ?? ctx.userEmail,
    company: fullUser?.company ?? "",
    phone: fullUser?.phone ?? "",
    siret: fullUser?.siret ?? "",
    tvaIntra: fullUser?.vatNumber ?? "",
    address: fullUser?.addressStreet ?? "",
    postalCode: fullUser?.addressZip ?? "",
    city: fullUser?.addressCity ?? "",
    country: fullUser?.addressCountry ?? "",
    cartTotal:
      scenario === "ABANDONED_CART"
        ? (cartTotalCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
        : "",
    cartCount: scenario === "ABANDONED_CART" ? String(cartItems.length) : "",
    days:
      scenario === "INACTIVE_CLIENT" && ctx.preview.daysSinceLastActivity != null
        ? String(ctx.preview.daysSinceLastActivity)
        : "",
    unsubscribeLink: buildUnsubscribeUrl({
      baseUrl,
      userId,
      tenantId,
    }),
    privacyLink: `${baseUrl}/fr/confidentialite`,
  };

  const finalSubject = interpolate(stage.template.subject, userContext);
  const html = renderNewsletterHtmlForSend({
    html: templateHtml,
    images: stage.template.images,
    baseUrl,
    mergeContext: userContext,
    dynamic:
      scenario === "ABANDONED_CART"
        ? { cart: { items: cartItems, totalCents: cartTotalCents } }
        : undefined,
  });
  return { ok: true, html, subject: finalSubject, mergeContext: userContext };
}

export async function sendManualMail(
  userId: string,
  scenario: MailScenario,
  payload?: { productIds?: string[]; stageIndex?: number },
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  try {
    if (scenario === "NEWSLETTER") {
      return { success: false, error: "L'envoi newsletter passe par la modale de choix de modèle." };
    }
    if (scenario === "RESTOCK") {
      return { success: false, error: RESTOCK_DISABLED_MESSAGE };
    }

    const { tenant } = await requireAdmin();

    const stageIndex = payload?.stageIndex;
    if (typeof stageIndex !== "number") {
      return {
        success: false,
        error: "Choisis d'abord un stade à envoyer (Stade 1, Stade 2, …).",
      };
    }

    const contextResult = await getClientMailContext(userId);
    if (!contextResult.success) return { success: false, error: contextResult.error };
    const ctx = contextResult.data;

    // Filet serveur : refuse l'envoi si un blocker « statique » (opt-in, statut,
    // cooldowns) est présent — même règle que côté UI, mais on ne fait jamais
    // confiance au client.
    const scenarioCtx = ctx.scenarios[scenario];
    if (scenarioCtx.blockers.length > 0) {
      return { success: false, error: scenarioCtx.blockers[0] };
    }

    const stageRes = await loadStageForScenario(tenant.id, scenario, stageIndex);
    if (!stageRes.ok) return { success: false, error: stageRes.error };
    const stage = stageRes.stage;

    // Filet RGPD : le mail doit contenir {unsubscribeLink} — même règle qu'à
    // l'envoi automatique (cf. abandoned-cart-worker.ts).
    const templateHtml = stage.template.html ?? "";
    if (!templateHtml.includes("{unsubscribeLink}")) {
      return {
        success: false,
        error:
          "Le modèle de ce stade ne contient plus le lien de désinscription obligatoire. " +
          "Ouvre-le dans /admin/marketing/mails et remets la variable {unsubscribeLink} dans le pied de page.",
      };
    }

    const rendered = await renderStageForUser({
      tenantId: tenant.id,
      userId,
      scenario,
      stage,
      ctx,
    });
    if (!rendered.ok) return { success: false, error: rendered.error };

    const result = await sendMail({
      to: ctx.userEmail,
      subject: rendered.subject,
      html: rendered.html,
      fromName: rendered.mergeContext.shopName ?? "",
      listUnsubscribeUrl: rendered.mergeContext.unsubscribeLink,
      tracking: {
        scenarioKey: scenario,
        userId,
        metadata: {
          source: "manual",
          stageIndex,
          templateId: stage.template.id,
          cartItems: scenario === "ABANDONED_CART" ? ctx.preview.cart.items.length : undefined,
          daysInactive: scenario === "INACTIVE_CLIENT" ? ctx.preview.daysSinceLastActivity : undefined,
        },
      },
    });

    if (!result.sent) {
      const reason =
        result.reason === "no_config"
          ? "Configuration SMTP absente pour cette boutique."
          : result.reason === "no_from"
            ? "Adresse expéditeur non configurée."
            : `Serveur SMTP a refusé l'envoi (${result.error ?? "raison inconnue"}).`;
      return { success: false, error: reason };
    }

    revalidatePath("/admin/clients");
    return { success: true, message: `Mail (Stade ${stageIndex}) envoyé à ${ctx.userEmail}.` };
  } catch (err) {
    logger.error("[sendManualMail]", { userId, scenario, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

// ═══════════════════════════════════════════════════════════
// Recherche de produits pour le mail « Retour en stock »
// ═══════════════════════════════════════════════════════════

export interface RestockSearchResult {
  id: string;
  name: string;
  reference: string;
  colorName: string | null;
  priceCents: number;
  imagePath: string | null;
  stock: number;
}

/**
 * Recherche des produits par nom/référence pour la sélection RESTOCK.
 * Retourne les 15 premiers matches, uniquement ONLINE, avec la variante
 * principale (stock, prix, image).
 */
export async function searchProductsForMail(
  query: string,
): Promise<{ success: true; results: RestockSearchResult[] } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const trimmed = query.trim();
    if (trimmed.length < 2) return { success: true, results: [] };

    const products = await prisma.product.findMany({
      where: {
        tenantId: tenant.id,
        status: "ONLINE",
        OR: [
          { name: { contains: trimmed } },
          { reference: { contains: trimmed } },
        ],
      },
      take: 15,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        reference: true,
        colors: {
          take: 1,
          orderBy: { isPrimary: "desc" },
          select: {
            stock: true,
            unitPrice: true,
            color: { select: { name: true } },
            images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
          },
        },
      },
    });

    const results: RestockSearchResult[] = products.map((p) => {
      const v = p.colors[0];
      return {
        id: p.id,
        name: p.name,
        reference: p.reference,
        colorName: v?.color?.name ?? null,
        priceCents: v ? Math.round(Number(v.unitPrice) * 100) : 0,
        imagePath: v?.images[0]?.path ?? null,
        stock: v?.stock ?? 0,
      };
    });
    return { success: true, results };
  } catch (err) {
    logger.error("[searchProductsForMail]", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

