"use server";

/**
 * Server actions pour la Vue Mails de /admin/utilisateurs.
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
import { renderAbandonedCartMail } from "@/lib/mail-templates/abandoned-cart";
import { renderInactiveClientMail } from "@/lib/mail-templates/inactive-client";
import { renderRestockMail } from "@/lib/mail-templates/restock";

export type MailScenario = "ABANDONED_CART" | "INACTIVE_CLIENT" | "NEWSLETTER" | "RESTOCK";

export interface MailScenarioContext {
  key: MailScenario;
  /** Peut-on techniquement envoyer ce mail ? (false = bouton grisé mais toujours cliquable si on force) */
  canSend: boolean;
  /** Message d'explication de l'état (« Panier de 3 articles laissé depuis 2j » / « Panier vide »). */
  contextLine: string;
  /** Date du dernier envoi de ce type à ce client, ou null. */
  lastSentAt: Date | null;
  /** Liste d'avertissements non bloquants — affichés dans la modale. */
  warnings: string[];
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

// Seuils recommandés (non bloquants)
const ABANDONED_CART_MIN_HOURS = 24;
const INACTIVE_MIN_DAYS = 14;
const NEWSLETTER_MIN_DAYS = 7;
const RESTOCK_MIN_DAYS = 7;

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

function formatHoursAgo(hours: number): string {
  if (hours < 1) return "il y a moins d'une heure";
  if (hours === 1) return "il y a 1 heure";
  if (hours < 24) return `il y a ${hours} heures`;
  return formatDaysAgo(Math.floor(hours / 24));
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
      },
    });
    if (!user) return { success: false, error: "Client introuvable." };

    // Panier en cours — avec les items complets (photo, prix, quantité) pour l'aperçu réel
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

    // ═══ Scénario 1 : Panier abandonné ═══
    const abandoned = ((): MailScenarioContext => {
      const warnings: string[] = [];
      const items = cartItemsPreview.length;
      let contextLine: string;
      const canSend = true;

      if (items === 0) {
        contextLine = "Ce client n'a pas de panier en cours.";
        warnings.push("Panier vide — le mail contiendra un message d'invitation générique.");
      } else {
        const ageH = cart ? hoursBetween(now, cart.updatedAt) : 0;
        const ageLabel = ageH < 24 ? `${ageH}h` : `${Math.floor(ageH / 24)}j`;
        contextLine = `Panier de ${items} article${items > 1 ? "s" : ""} laissé depuis ${ageLabel}.`;
        if (ageH < ABANDONED_CART_MIN_HOURS) {
          warnings.push(`Panier récent (moins de 24h) — recommandation : attendre au moins 24h.`);
        }
      }

      const last = lastSends.ABANDONED_CART;
      if (last) {
        const h = hoursBetween(now, last);
        if (h < 24) {
          warnings.push(`⚠️ Un mail « Panier abandonné » a déjà été envoyé ${formatHoursAgo(h)} — risque d'être perçu comme du spam.`);
        }
      }

      return { key: "ABANDONED_CART", canSend, contextLine, lastSentAt: last, warnings };
    })();

    // ═══ Scénario 2 : Inactivité ═══
    const inactive = ((): MailScenarioContext => {
      const warnings: string[] = [];
      const lastActivity = user.lastSeenAt ?? user.lastLoginAt ?? null;
      let contextLine: string;
      let canSend = true;

      if (!lastActivity) {
        contextLine = "Ce client ne s'est jamais connecté.";
        warnings.push("Jamais connecté — le mail d'inactivité aura peu de contexte.");
      } else {
        const d = daysBetween(now, lastActivity);
        contextLine = `Dernière connexion ${formatDaysAgo(d)}.`;
        if (d < INACTIVE_MIN_DAYS) {
          warnings.push(`Client encore actif (moins de 2 semaines) — recommandation : attendre au moins 14 jours d'inactivité.`);
        }
      }

      const last = lastSends.INACTIVE_CLIENT;
      if (last) {
        const d = daysBetween(now, last);
        if (d < INACTIVE_MIN_DAYS) {
          warnings.push(`⚠️ Un mail « Inactivité » a déjà été envoyé ${formatDaysAgo(d)} — recommandation : attendre au moins 2 semaines entre 2 relances d'inactivité.`);
        }
      }

      return { key: "INACTIVE_CLIENT", canSend, contextLine, lastSentAt: last, warnings };
    })();

    // ═══ Scénario 3 : Newsletter ═══
    const newsletter = ((): MailScenarioContext => {
      const warnings: string[] = [];
      const contextLine = "Envoi d'un modèle newsletter enregistré.";
      const canSend = true;

      const last = lastSends.NEWSLETTER;
      if (last) {
        const d = daysBetween(now, last);
        if (d < NEWSLETTER_MIN_DAYS) {
          warnings.push(`⚠️ Une newsletter a déjà été envoyée à ce client ${formatDaysAgo(d)} — risque de perception spam si trop fréquent.`);
        }
      }

      return { key: "NEWSLETTER", canSend, contextLine, lastSentAt: last, warnings };
    })();

    // ═══ Scénario 4 : Retour en stock ═══
    const restock = ((): MailScenarioContext => {
      const warnings: string[] = [];
      let contextLine: string;
      let canSend = true;

      if (favoritesInStock === 0) {
        contextLine = "Aucun favori en stock actuellement.";
        warnings.push("Aucun favori en stock — le mail n'aura rien à mettre en avant.");
        canSend = false;
      } else {
        contextLine = `${favoritesInStock} favori${favoritesInStock > 1 ? "s" : ""} disponible${favoritesInStock > 1 ? "s" : ""} en stock.`;
      }

      const last = lastSends.RESTOCK;
      if (last) {
        const d = daysBetween(now, last);
        if (d < RESTOCK_MIN_DAYS) {
          warnings.push(`⚠️ Un mail « Retour en stock » a déjà été envoyé ${formatDaysAgo(d)} — recommandation : attendre au moins 7 jours.`);
        }
      }

      return { key: "RESTOCK", canSend, contextLine, lastSentAt: last, warnings };
    })();

    return {
      success: true,
      data: {
        userId: user.id,
        userLabel: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.company || user.email,
        userEmail: user.email,
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
          firstName: (user.firstName?.trim() || user.company || "cliente").split(/\s+/)[0],
        },
      },
    };
  } catch (err) {
    logger.error("[getClientMailContext]", { userId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

// ═══════════════════════════════════════════════════════════
// Envoi manuel d'un mail (Panier / Inactivité / Retour stock)
// La Newsletter passe par une action séparée (choix de modèle).
// ═══════════════════════════════════════════════════════════

export async function sendManualMail(
  userId: string,
  scenario: MailScenario,
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  try {
    if (scenario === "NEWSLETTER") {
      return { success: false, error: "L'envoi newsletter passe par la modale de choix de modèle." };
    }

    const { tenant } = await requireAdmin();

    const contextResult = await getClientMailContext(userId);
    if (!contextResult.success) return { success: false, error: contextResult.error };
    const ctx = contextResult.data;

    const shopName = await getCachedShopName();
    const baseUrl = await getCurrentTenantBaseUrl();
    const legalLine = await buildLegalLine(tenant.id);
    const shared = { shopName, baseUrl, legalLine };

    let rendered: { subject: string; html: string };
    switch (scenario) {
      case "ABANDONED_CART":
        rendered = renderAbandonedCartMail({
          firstName: ctx.preview.firstName,
          items: ctx.preview.cart.items,
          totalCents: ctx.preview.cart.totalCents,
          shared,
        });
        break;
      case "INACTIVE_CLIENT":
        rendered = renderInactiveClientMail({
          firstName: ctx.preview.firstName,
          daysInactive: ctx.preview.daysSinceLastActivity,
          shared,
        });
        break;
      case "RESTOCK":
        rendered = renderRestockMail({
          firstName: ctx.preview.firstName,
          favorites: ctx.preview.favoritesInStock,
          shared,
        });
        break;
      default:
        return { success: false, error: "Type de mail inconnu." };
    }

    const result = await sendMail({
      to: ctx.userEmail,
      subject: rendered.subject,
      html: rendered.html,
      fromName: shopName,
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

    await prisma.emailSend.create({
      data: {
        tenantId: tenant.id,
        userId,
        recipientEmail: ctx.userEmail,
        scenarioKey: scenario,
        subject: rendered.subject,
        metadata: {
          source: "manual",
          cartItems: scenario === "ABANDONED_CART" ? ctx.preview.cart.items.length : undefined,
          daysInactive: scenario === "INACTIVE_CLIENT" ? ctx.preview.daysSinceLastActivity : undefined,
          favoritesCount: scenario === "RESTOCK" ? ctx.preview.favoritesInStock.length : undefined,
        },
      },
    });

    revalidatePath("/admin/utilisateurs");
    return { success: true, message: `Mail envoyé à ${ctx.userEmail}.` };
  } catch (err) {
    logger.error("[sendManualMail]", { userId, scenario, error: err as Error });
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
