/**
 * lib/email-marketing/back-in-stock.ts
 *
 * Le retour en stock est piloté MANUELLEMENT par l'admin. Deux fonctions clés :
 *
 *   - `recordRestockEvent(productColorId)` — appelée en fire-and-forget dès
 *     qu'une variante passe de stock=0 à stock>0 (typiquement depuis
 *     `updateProduct`). Crée juste une ligne `RestockEvent` en attente.
 *     Aucun email n'est envoyé à ce moment.
 *
 *   - `dispatchPendingRestockEvents(tenantId)` — appelée quand l'admin
 *     clique "Envoyer les notifications" dans le widget flottant.
 *     Pour chaque client qui a favorisé au moins un produit dans la file,
 *     envoie 1 seul email récapitulatif listant TOUS ses favoris qui
 *     viennent de repasser en stock. Puis marque les events dispatchés.
 *
 * On respecte STOCK_ALERTS + MARKETING_ALL pour la désinscription.
 * Idempotent : un client n'est notifié qu'une seule fois par batch.
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
  renderBackInStockDigestEmail,
  type DigestProductView,
} from "@/lib/email-marketing/templates/back-in-stock-digest";

export interface DispatchResult {
  productsDispatched: number;
  clientsNotified: number;
  emailsSent: number;
  emailsSkipped: number;
  emailsErrors: number;
}

// ─────────────────────────────────────────────────────────────
// 1. Enregistrement de l'événement (côté trigger)
// ─────────────────────────────────────────────────────────────

/**
 * Note un retour en stock dans la file d'attente. Ne PAS envoyer d'email —
 * l'admin décide du moment via le widget.
 * Fire-and-forget côté appelant.
 */
export async function recordRestockEvent(productColorId: string): Promise<void> {
  try {
    const variant = await prisma.productColor.findUnique({
      where: { id: productColorId },
      select: { tenantId: true, productId: true, stock: true },
    });
    if (!variant?.tenantId || !variant.productId) return;
    if (variant.stock <= 0) return;

    // Si un event non-dispatché existe déjà pour cette variante → on n'en
    // crée pas un doublon. Sinon on en crée un nouveau.
    const existing = await prisma.restockEvent.findFirst({
      where: {
        tenantId: variant.tenantId,
        productColorId,
        dispatchedAt: null,
      },
      select: { id: true },
    });
    if (existing) return;

    await prisma.restockEvent.create({
      data: {
        tenantId: variant.tenantId,
        productColorId,
        productId: variant.productId,
      },
    });
  } catch (err) {
    logger.warn("[BackInStock] Impossible d'enregistrer l'event", {
      productColorId,
      error: err as Error,
    });
  }
}

/**
 * Alias historique — `triggerBackInStockForVariant` bascule maintenant sur
 * l'enregistrement pur (plus d'envoi immédiat).
 */
export async function triggerBackInStockForVariant(productColorId: string): Promise<void> {
  await recordRestockEvent(productColorId);
}

// ─────────────────────────────────────────────────────────────
// 2. Vue "en attente" (pour widget flottant + page admin)
// ─────────────────────────────────────────────────────────────

export interface PendingRestockSummary {
  events: number; // nb de RestockEvent pending
  distinctProducts: number; // nb de produits distincts concernés
  eligibleClients: number; // nb de clients qui recevront un email
}

export interface PendingRestockProductItem {
  productId: string;
  productName: string;
  reference: string;
  priceLabel: string;
  imageUrl: string | null;
  /** Liste des couleurs concernées ("Rose, Doré") — vide si non renseigné. */
  colors: string[];
  /** Nombre total de variantes réapprovisionnées pour ce produit. */
  variantsCount: number;
  /** Nombre de clients qui ont ce produit en favori (avant filtrage désinscription). */
  favoritedBy: number;
  /** Timestamp du plus ancien event pour ce produit. */
  occurredAt: string;
}

/**
 * Compte ce qui se passerait si l'admin déclenchait le dispatch maintenant.
 * Sert au widget et à la page admin — jamais d'effet secondaire.
 */
export async function getPendingRestockSummary(
  tenantId: string,
): Promise<PendingRestockSummary> {
  const events = await prisma.restockEvent.findMany({
    where: { tenantId, dispatchedAt: null },
    select: { productId: true },
  });
  if (events.length === 0) {
    return { events: 0, distinctProducts: 0, eligibleClients: 0 };
  }

  const productIds = [...new Set(events.map((e) => e.productId))];

  // Clients ayant favorisé au moins un produit dans la file, avec status
  // APPROVED et email non vide. On EXCLUT ceux désinscrits STOCK_ALERTS
  // (ou MARKETING_ALL) via un JOIN inverse.
  const favorites = await prisma.favorite.findMany({
    where: {
      tenantId,
      productId: { in: productIds },
      user: { status: "APPROVED", email: { not: "" } },
    },
    select: { userId: true, user: { select: { email: true } } },
  });

  // Retire les désinscrits (STOCK_ALERTS ou MARKETING_ALL)
  const emails = favorites
    .map((f) => f.user.email.toLowerCase().trim())
    .filter((e) => e.length > 0);
  const uniqueEmails = [...new Set(emails)];
  const unsubRows = await prisma.emailUnsubscribe.findMany({
    where: {
      tenantId,
      email: { in: uniqueEmails },
      scope: { in: ["STOCK_ALERTS", "MARKETING_ALL"] },
    },
    select: { email: true },
  });
  const unsubSet = new Set(unsubRows.map((u) => u.email));
  const eligibleUsers = new Set(
    favorites
      .filter((f) => !unsubSet.has(f.user.email.toLowerCase().trim()))
      .map((f) => f.userId),
  );

  return {
    events: events.length,
    distinctProducts: productIds.length,
    eligibleClients: eligibleUsers.size,
  };
}

/**
 * Liste détaillée des produits en attente d'envoi. Utilisée par le widget
 * flottant + la page /admin/emails pour visualiser avant dispatch.
 */
export async function getPendingRestockList(
  tenantId: string,
): Promise<PendingRestockProductItem[]> {
  const events = await prisma.restockEvent.findMany({
    where: { tenantId, dispatchedAt: null },
    orderBy: { occurredAt: "asc" },
    select: {
      productId: true,
      occurredAt: true,
      productColor: {
        select: {
          color: { select: { name: true } },
        },
      },
      product: {
        select: {
          id: true,
          name: true,
          reference: true,
          colors: {
            where: { isPrimary: true },
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
      },
    },
    take: 500,
  });

  if (events.length === 0) return [];

  const productIds = [...new Set(events.map((e) => e.productId))];

  // Nb de clients par produit qui l'ont favorisé (all statuses, pour affichage)
  const favoriteCounts = await prisma.favorite.groupBy({
    by: ["productId"],
    where: { tenantId, productId: { in: productIds } },
    _count: { productId: true },
  });
  const favoriteMap = new Map(
    favoriteCounts.map((f) => [f.productId, f._count.productId]),
  );

  const baseUrl = await getTenantBaseUrl(tenantId);

  // Groupe par produit
  const byProduct = new Map<string, PendingRestockProductItem>();
  for (const ev of events) {
    let bucket = byProduct.get(ev.productId);
    const colorName = ev.productColor?.color?.name?.trim();
    if (!bucket) {
      const p = ev.product;
      const v = p.colors[0];
      bucket = {
        productId: p.id,
        productName: p.name,
        reference: p.reference,
        priceLabel: v ? formatEuros(Number(v.unitPrice)) : "",
        imageUrl: v?.images[0]?.path ? absoluteUrl(baseUrl, v.images[0].path) : null,
        colors: [],
        variantsCount: 0,
        favoritedBy: favoriteMap.get(ev.productId) ?? 0,
        occurredAt: ev.occurredAt.toISOString(),
      };
      byProduct.set(ev.productId, bucket);
    }
    bucket.variantsCount += 1;
    if (colorName && !bucket.colors.includes(colorName)) {
      bucket.colors.push(colorName);
    }
  }

  return [...byProduct.values()];
}

// ─────────────────────────────────────────────────────────────
// 3. Dispatch (envoi manuel groupé)
// ─────────────────────────────────────────────────────────────

/**
 * Envoie les notifications de retour en stock en attente. Groupe par
 * utilisateur : 1 seul email par client, listant tous ses produits
 * favorisés qui sont dans la file.
 */
export async function dispatchPendingRestockEvents(
  tenantId: string,
): Promise<DispatchResult> {
  const result: DispatchResult = {
    productsDispatched: 0,
    clientsNotified: 0,
    emailsSent: 0,
    emailsSkipped: 0,
    emailsErrors: 0,
  };

  return await tenantALS.run(tenantId, async () => {
    try {
      const scenario = await getOrCreateScenario(tenantId, "BACK_IN_STOCK");
      if (!scenario.enabled) {
        logger.warn("[BackInStock] Scénario désactivé — envoi refusé");
        return result;
      }

      const pendingEvents = await prisma.restockEvent.findMany({
        where: { tenantId, dispatchedAt: null },
        select: {
          id: true,
          productId: true,
          productColorId: true,
          product: {
            select: {
              id: true,
              name: true,
              reference: true,
              colors: {
                where: { isPrimary: true },
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
          },
        },
      });

      if (pendingEvents.length === 0) return result;

      const distinctProductIds = [...new Set(pendingEvents.map((e) => e.productId))];
      result.productsDispatched = distinctProductIds.length;

      // Chargement des favoris ciblés (APPROVED, email non vide)
      const favorites = await prisma.favorite.findMany({
        where: {
          tenantId,
          productId: { in: distinctProductIds },
          user: { status: "APPROVED", email: { not: "" } },
        },
        select: {
          userId: true,
          productId: true,
          user: { select: { email: true, firstName: true } },
        },
      });

      if (favorites.length === 0) {
        // Aucun client concerné — on marque quand même les events comme
        // dispatchés pour ne pas les traiter en boucle.
        await prisma.restockEvent.updateMany({
          where: { id: { in: pendingEvents.map((e) => e.id) } },
          data: { dispatchedAt: new Date() },
        });
        return result;
      }

      // Group par client
      const byUser = new Map<
        string,
        {
          email: string;
          firstName: string;
          productIds: Set<string>;
        }
      >();
      for (const fav of favorites) {
        const email = fav.user.email.trim().toLowerCase();
        if (!email) continue;
        let bucket = byUser.get(fav.userId);
        if (!bucket) {
          bucket = { email, firstName: fav.user.firstName ?? "", productIds: new Set() };
          byUser.set(fav.userId, bucket);
        }
        bucket.productIds.add(fav.productId);
      }
      result.clientsNotified = byUser.size;

      // Contexte partagé (baseUrl, mentions légales)
      const baseUrl = await getTenantBaseUrl(tenantId);
      const companyLegal = await getCompanyLegalLine(tenantId);
      const productViewMap = new Map<string, DigestProductView>();
      for (const ev of pendingEvents) {
        if (productViewMap.has(ev.productId)) continue;
        const p = ev.product;
        const v = p.colors[0];
        productViewMap.set(ev.productId, {
          productName: p.name,
          reference: p.reference,
          priceLabel: v ? formatEuros(Number(v.unitPrice)) : "",
          productUrl: `${baseUrl}/fr/produits/${p.id}`,
          imageUrl: v?.images[0]?.path ? absoluteUrl(baseUrl, v.images[0].path) : null,
        });
      }

      // Batch id partagé pour dédup + trace
      const batchId = `restock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      for (const [userId, bucket] of byUser) {
        try {
          // Désinscription STOCK_ALERTS (ou MARKETING_ALL)
          if (await isUnsubscribed(tenantId, bucket.email, "STOCK_ALERTS")) {
            result.emailsSkipped += 1;
            continue;
          }

          const products = [...bucket.productIds]
            .map((id) => productViewMap.get(id))
            .filter((p): p is DigestProductView => Boolean(p));
          if (products.length === 0) {
            result.emailsSkipped += 1;
            continue;
          }

          // Dédup au niveau du batch (2 dispatch simultanés ne créent qu'1 mail)
          const dedupKey = `${batchId}:user-${userId}`;
          let sendRow;
          try {
            sendRow = await prisma.emailSend.create({
              data: {
                tenantId,
                scenarioKey: "BACK_IN_STOCK",
                recipientEmail: bucket.email,
                userId,
                subject: "",
                dedupKey,
                metadata: {
                  batchId,
                  productIds: [...bucket.productIds],
                } as Prisma.InputJsonValue,
              },
              select: { id: true },
            });
          } catch (err) {
            logger.warn("[BackInStock] EmailSend race — skip", {
              tenantId,
              dedupKey,
              error: (err as Error).message,
            });
            result.emailsSkipped += 1;
            continue;
          }

          const pixelToken = encodeTrackingToken(sendRow.id);
          const pixelUrl = `${baseUrl}/api/emails/track/pixel?t=${encodeURIComponent(pixelToken)}`;
          const unsubToken = encodeUnsubscribeToken(tenantId, bucket.email, "STOCK_ALERTS");
          const unsubscribeUrl = `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`;

          const { subject, html } = renderBackInStockDigestEmail({
            customerFirstName: bucket.firstName,
            products,
            browseAllUrl: `${baseUrl}/fr/produits`,
            unsubscribeUrl,
            pixelUrl,
            companyLegal,
          });

          const smtpResult = await sendMail({ to: bucket.email, subject, html });

          if (smtpResult.sent) {
            await prisma.emailSend.update({
              where: { id: sendRow.id },
              data: { subject, messageId: smtpResult.id || null },
            });
            result.emailsSent += 1;
          } else {
            await prisma.emailSend.update({
              where: { id: sendRow.id },
              data: { subject: `[ÉCHEC SMTP] ${subject}` },
            });
            result.emailsErrors += 1;
            if (smtpResult.sent === false && smtpResult.reason === "no_config") {
              logger.error("[BackInStock] SMTP absent — arrêt du dispatch", { tenantId });
              break;
            }
          }
        } catch (err) {
          result.emailsErrors += 1;
          logger.error("[BackInStock] Échec envoi client", {
            tenantId,
            userId,
            error: err as Error,
          });
        }
      }

      // Marque tous les events comme dispatchés (que le SMTP ait marché ou non,
      // pour éviter de rescanner en boucle en cas de config manquante).
      const now = new Date();
      await prisma.restockEvent.updateMany({
        where: { id: { in: pendingEvents.map((e) => e.id) } },
        data: { dispatchedAt: now },
      });

      logger.info("[BackInStock] Dispatch terminé", { tenantId, ...result });
      return result;
    } catch (err) {
      logger.error("[BackInStock] Dispatch échoué", { tenantId, error: err as Error });
      return result;
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

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
