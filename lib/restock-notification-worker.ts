/**
 * Worker qui envoie les mails de notification « retour en stock » aux
 * échéances. Pattern miroir d'`abandoned-cart-worker` et
 * `inactive-client-worker` mais simplifié : un seul envoi par cycle (pas de
 * stades), compteur unique de 24 h (configurable globalement) qui s'accumule
 * sur une fenêtre glissante — plusieurs produits qui reviennent en stock dans
 * la fenêtre partent dans le même mail récap.
 *
 * Poll toutes les RESTOCK_WORKER_POLL_INTERVAL_MS :
 *   1. Récupère les tenants avec automation activée (SiteConfig
 *      `restock_automation_enabled` = "true").
 *   2. Pour chaque tenant → wrap tenantALS.run(tid, …).
 *   3. SELECT les RestockNotificationJob PENDING dont scheduledSendAt <= now.
 *   4. Pour chaque job → processJob :
 *      - recharge le user + check APPROVED + newsletter + non opt-out,
 *      - recharge les produits de `entries`, filtre ceux encore ONLINE
 *        avec stock > 0 (la variante peut être repartie en rupture entre
 *        l'enqueue et l'envoi — on ne spam pas un mail bidon),
 *      - split les entrées en 2 listes selon isFavorite / hasOrdered,
 *      - lock optimiste (status PENDING → COMPLETED avec condition),
 *      - envoi via sendMail + tracking scenarioKey RESTOCK.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { sendMail } from "@/lib/email";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { getCachedShopName } from "@/lib/cached-data";
import {
  renderNewsletterHtmlForSend,
  type HtmlFavorite,
} from "@/lib/newsletter-html-render";
import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";
import { buildUnsubscribeUrl } from "@/lib/newsletter-unsubscribe-token";
import { resolveTemplateForCountry } from "@/lib/newsletter-locale-resolve";
import {
  RESTOCK_AUTOMATION_ENABLED_SITE_CONFIG_KEY,
  parseEntries,
  type RestockEntry,
} from "@/lib/restock-trigger";

/**
 * Tick 10 s — aligné sur `abandoned-cart-worker` et sur le `AutoRefresh` de
 * la vue /admin/marketing. La cliente peut régler le compteur à la seconde
 * (bornes 1 s → 365 j) ; 10 s garde une bonne précision sans surcharger la BDD.
 */
export const RESTOCK_WORKER_POLL_INTERVAL_MS = 10_000;

let started = false;

/**
 * Reprogramme les jobs PENDING dont `scheduledSendAt` est franchement dépassé
 * (après un long arrêt PM2 ou un crash). On les étale sur 1 min au lieu de
 * les repêcher d'un coup au prochain tick.
 */
async function sweepStaleJobsAtBoot(): Promise<void> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600_000);
  try {
    const res = await prisma.restockNotificationJob.updateMany({
      where: {
        status: "PENDING",
        scheduledSendAt: { lt: oneHourAgo, not: null },
      },
      data: {
        scheduledSendAt: new Date(now.getTime() + 60_000),
        lastEvaluatedAt: now,
      },
    });
    if (res.count > 0) {
      logger.info?.("[restock] boot sweep — jobs en retard reprogrammés", {
        count: res.count,
      });
    }
  } catch (err) {
    logger.error("[restock] boot sweep failed", { error: err as Error });
  }
}

export function startRestockNotificationWorker(): void {
  if (started) return;
  started = true;
  logger.info?.("[restock] worker démarré", {
    pollMs: RESTOCK_WORKER_POLL_INTERVAL_MS,
  });
  void sweepStaleJobsAtBoot();
  scheduleNextTick();
}

function scheduleNextTick(): void {
  setTimeout(async () => {
    try {
      await tick();
    } catch (err) {
      logger.error("[restock] tick failed", { error: err as Error });
    } finally {
      scheduleNextTick();
    }
  }, RESTOCK_WORKER_POLL_INTERVAL_MS);
}

async function tick(): Promise<void> {
  const now = new Date();
  // On lit la liste des tenants qui ont le kill switch ON, puis on scanne
  // leurs jobs échus. Groupage par tenant pour wrapper tenantALS proprement.
  const enabled = await prisma.siteConfig.findMany({
    where: { key: RESTOCK_AUTOMATION_ENABLED_SITE_CONFIG_KEY, value: "true" },
    select: { tenantId: true },
  });
  if (enabled.length === 0) return;

  for (const { tenantId } of enabled) {
    if (!tenantId) continue;
    await tenantALS.run(tenantId, async () => {
      try {
        await processTenant(tenantId, now);
      } catch (err) {
        logger.error("[restock] tenant tick failed", {
          tenantId,
          error: err as Error,
        });
      }
    });
  }
}

async function processTenant(tenantId: string, now: Date): Promise<void> {
  const due = await prisma.restockNotificationJob.findMany({
    where: {
      tenantId,
      status: "PENDING",
      scheduledSendAt: { lte: now, not: null },
    },
    orderBy: { scheduledSendAt: "asc" },
    take: 100,
    select: {
      id: true,
      userId: true,
      entries: true,
      scheduledSendAt: true,
    },
  });
  if (due.length === 0) return;

  // Un seul template RESTOCK par tenant (scenarioKey @unique composite).
  const template = await prisma.newsletterTemplate.findFirst({
    where: { tenantId, scenarioKey: "RESTOCK" },
    select: {
      id: true,
      subject: true,
      html: true,
      images: { select: { name: true, path: true } },
    },
  });
  if (!template || !template.html?.includes("{unsubscribeLink}")) {
    // Pas de template OU pas de lien de désinscription → on retarde tout
    // de 1 h pour laisser à la cliente le temps de corriger. On ne cancel
    // pas (c'est son travail de config, pas une faute du client).
    const retryAt = new Date(now.getTime() + 3600_000);
    await prisma.restockNotificationJob.updateMany({
      where: { id: { in: due.map((d) => d.id) } },
      data: { scheduledSendAt: retryAt, lastEvaluatedAt: now },
    });
    logger.error("[restock] template manquant ou {unsubscribeLink} absent — retry 1 h", {
      tenantId,
      hasTemplate: Boolean(template),
      hasUnsubscribe: Boolean(template?.html?.includes("{unsubscribeLink}")),
    });
    return;
  }

  for (const job of due) {
    try {
      await processJob(tenantId, job, template, now);
    } catch (err) {
      logger.error("[restock] job failed", {
        tenantId,
        jobId: job.id,
        error: err as Error,
      });
      await prisma.restockNotificationJob
        .update({
          where: { id: job.id },
          data: {
            scheduledSendAt: new Date(now.getTime() + 900_000), // retry 15 min
            lastEvaluatedAt: now,
          },
        })
        .catch(() => undefined);
    }
  }
}

interface JobRow {
  id: string;
  userId: string;
  entries: unknown;
  scheduledSendAt: Date | null;
}

interface TemplateRow {
  id: string;
  subject: string;
  html: string | null;
  images: { name: string; path: string }[];
}

async function processJob(
  tenantId: string,
  job: JobRow,
  template: TemplateRow,
  now: Date,
): Promise<void> {
  // ── User guard ──
  const user = await prisma.user.findFirst({
    where: { id: job.userId, tenantId },
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
      role: true,
      status: true,
      restockOptOut: true,
      acceptsNewsletter: true,
    },
  });
  if (!user || user.role !== "CLIENT" || user.status !== "APPROVED") {
    await cancel(job.id, "USER_NOT_APPROVED", now);
    return;
  }
  if (user.restockOptOut || !user.acceptsNewsletter) {
    await cancel(job.id, "OPT_OUT", now);
    return;
  }

  // ── Charge les produits de la file ──
  const entries = parseEntries(job.entries);
  if (entries.length === 0) {
    await cancel(job.id, "EMPTY_ENTRIES", now);
    return;
  }

  const variantIds = Array.from(new Set(entries.map((e) => e.productColorId)));
  const variants = await prisma.productColor.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      stock: true,
      saleType: true,
      unitPrice: true,
      color: { select: { name: true } },
      product: {
        select: { id: true, name: true, status: true },
      },
      images: {
        orderBy: { order: "asc" },
        take: 1,
        select: { path: true },
      },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  // Filtre live : garde uniquement les variantes UNIT dont le produit est
  // ONLINE et dont le stock est toujours > 0. Les PACKs sont rejetés par
  // décision cliente (une variante UNIT par produit, pas de doublons taille/couleur).
  type Line = HtmlFavorite & { entry: RestockEntry };
  const buildLine = (entry: RestockEntry): Line | null => {
    const v = variantById.get(entry.productColorId);
    if (!v) return null;
    if (v.saleType !== "UNIT") return null;
    if (v.product.status !== "ONLINE") return null;
    if (v.stock <= 0) return null;
    return {
      entry,
      productName: v.product.name,
      colorName: v.color?.name ?? null,
      priceCents: Math.round(Number(v.unitPrice) * 100),
      imagePath: v.images[0]?.path ?? null,
    };
  };

  const liveLines = entries
    .map(buildLine)
    .filter((l): l is Line => l !== null);
  if (liveLines.length === 0) {
    await cancel(job.id, "ALL_OUT_OF_STOCK_AGAIN", now);
    return;
  }

  // Deux sections distinctes. Priorité : si favoris → section favoris
  // (intention explicite d'achat future). Sinon → section commandés.
  // Évite le doublon pour un même produit dans les deux listes.
  const favoritesLines: HtmlFavorite[] = [];
  const orderedLines: HtmlFavorite[] = [];
  for (const line of liveLines) {
    if (line.entry.isFavorite) favoritesLines.push(toFavoriteLine(line));
    else if (line.entry.hasOrdered) orderedLines.push(toFavoriteLine(line));
  }

  // ── Config boutique + merge vars ──
  const [shopName, baseUrl, companyInfo] = await Promise.all([
    getCachedShopName(),
    getCurrentTenantBaseUrl(),
    prisma.companyInfo.findFirst({
      where: { tenantId },
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
  if (!shopName.trim() || !shopAddress.trim()) {
    logger.error("[restock] skip send: shop legal info missing", {
      tenantId,
      hasShopName: Boolean(shopName.trim()),
      hasShopAddress: Boolean(shopAddress.trim()),
    });
    await prisma.restockNotificationJob.update({
      where: { id: job.id },
      data: {
        scheduledSendAt: new Date(now.getTime() + 3600_000),
        lastEvaluatedAt: now,
      },
    });
    return;
  }

  const shopContext: MailMergeContext = {
    shopName,
    shopAddress,
    shopEmail: companyInfo?.email ?? "",
    shopPhone: companyInfo?.phone ?? "",
    shopWebsite: companyInfo?.website ?? baseUrl.replace(/^https?:\/\//, ""),
  };
  const userContext: MailMergeContext = {
    ...shopContext,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    fullName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
    email: user.email,
    company: user.company ?? "",
    phone: user.phone ?? "",
    siret: user.siret ?? "",
    tvaIntra: user.vatNumber ?? "",
    address: user.addressStreet ?? "",
    postalCode: user.addressZip ?? "",
    city: user.addressCity ?? "",
    country: user.addressCountry ?? "",
    favoritesCount: String(favoritesLines.length),
    orderedCount: String(orderedLines.length),
    restockTotal: String(favoritesLines.length + orderedLines.length),
    unsubscribeLink: buildUnsubscribeUrl({
      baseUrl,
      userId: user.id,
      tenantId,
    }),
    privacyLink: `${baseUrl}/fr/confidentialite`,
  };

  // Résolution de la langue d'envoi selon le pays du destinataire + cascade
  // de secours (locale cible → EN → FR) si la version choisie est vide.
  const resolved = await resolveTemplateForCountry(
    template.id,
    user.addressCountry ?? null,
  );
  if (!resolved) {
    logger.error("[restock] template unresolvable", { tenantId, templateId: template.id });
    await prisma.restockNotificationJob
      .update({
        where: { id: job.id },
        data: { scheduledSendAt: new Date(now.getTime() + 3600_000), lastEvaluatedAt: now },
      })
      .catch(() => undefined);
    return;
  }
  const finalSubject = interpolate(resolved.subject, userContext);
  const html = renderNewsletterHtmlForSend({
    html: resolved.html,
    images: resolved.images,
    baseUrl,
    mergeContext: userContext,
    dynamic: {
      favorites: favoritesLines,
      ordered: orderedLines,
    },
  });

  // ── Lock optimiste AVANT l'envoi ──
  // On marque le job COMPLETED d'abord. Si un autre tick vient de le traiter
  // (race), updateMany renvoie count=0 et on skip. Si l'envoi crash après,
  // le job reste COMPLETED mais aucun doublon côté client — accepté.
  const locked = await prisma.restockNotificationJob.updateMany({
    where: { id: job.id, status: "PENDING" },
    data: {
      status: "COMPLETED",
      scheduledSendAt: null,
      lastSentAt: now,
      lastEvaluatedAt: now,
      cancelReason: null,
    },
  });
  if (locked.count === 0) {
    logger.info?.("[restock] skip: raced by another tick", {
      tenantId,
      jobId: job.id,
    });
    return;
  }

  const result = await sendMail({
    to: user.email,
    subject: finalSubject,
    html,
    fromName: shopName,
    listUnsubscribeUrl: userContext.unsubscribeLink,
    tracking: {
      scenarioKey: "RESTOCK",
      userId: user.id,
      metadata: {
        source: "auto",
        favoritesCount: favoritesLines.length,
        orderedCount: orderedLines.length,
      },
    },
  });

  if (!result.sent) {
    logger.error("[restock] send failed AFTER lock — pas de retry auto", {
      tenantId,
      userId: user.id,
      jobId: job.id,
      reason: result.reason,
      error: result.error,
    });
  }
}

function toFavoriteLine(line: {
  productName: string;
  colorName: string | null;
  priceCents: number;
  imagePath: string | null;
}): HtmlFavorite {
  return {
    productName: line.productName,
    colorName: line.colorName,
    priceCents: line.priceCents,
    imagePath: line.imagePath,
  };
}

async function cancel(jobId: string, reason: string, now: Date): Promise<void> {
  await prisma.restockNotificationJob.update({
    where: { id: jobId },
    data: {
      status: "CANCELLED",
      scheduledSendAt: null,
      cancelReason: reason,
      lastEvaluatedAt: now,
    },
  });
}
