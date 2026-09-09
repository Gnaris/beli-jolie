/**
 * Worker qui envoie les mails de relance panier abandonné aux échéances.
 *
 * Poll toutes les WORKER_POLL_INTERVAL_MS (10 s) : SELECT les
 * AbandonedCartJob où status=PENDING et nextStageAt <= now(), regroupés
 * par tenant, et traite chaque job dans un tenantALS.run() pour que les
 * lectures Prisma soient scopées au bon tenant (ALS obligatoire côté
 * worker, cf. CLAUDE.md).
 *
 * Pour chaque job :
 *   1. Recharge la config des stades du tenant + user.
 *   2. Si user opt-out / non-APPROVED → CANCELLED.
 *   3. Panier live vide (après filtre ARCHIVED/OFFLINE/rupture) → CANCELLED.
 *   4. Automation globale off (SiteConfig) → skip sans annuler (la cliente
 *      peut vouloir remettre l'automation demain, on ne perd rien).
 *   5. Le template du stade doit contenir {unsubscribeLink} — sinon skip
 *      (envoi bloqué au niveau global côté server action mais filet ici).
 *   6. Envoi via sendMail + tracking scenarioKey ABANDONED_CART.
 *   7. Ajoute le stade à `stagesFired`, recalcule `nextStageAt` = now +
 *      delay(stage suivant). Si plus de stade → COMPLETED.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { sendMail } from "@/lib/email";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { getCachedShopName } from "@/lib/cached-data";
import {
  renderNewsletterHtml,
  substituteVariables,
  type NewsletterBlock,
  type NewsletterDynamicContext,
  type CartItemDynamic,
} from "@/lib/newsletter-blocks";
import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";
import { buildUnsubscribeUrl } from "@/lib/newsletter-unsubscribe-token";
import {
  WORKER_POLL_INTERVAL_MS,
  templateHasUnsubscribeLink,
} from "@/lib/abandoned-cart-config";
import { pickNextStage } from "@/lib/abandoned-cart-trigger";
import type { ProductStatus } from "@prisma/client";

const AUTOMATION_ENABLED_KEY = "abandoned_cart_automation_enabled";

interface FiredEntry {
  stageIndex: number;
  sentAt: string;
  emailSendId?: string;
}

let started = false;

export function startAbandonedCartWorker(): void {
  if (started) return;
  started = true;
  logger.info?.("[abandonedCart] worker démarré", {
    pollMs: WORKER_POLL_INTERVAL_MS,
  });
  scheduleNextTick();
}

function scheduleNextTick(): void {
  setTimeout(async () => {
    try {
      await tick();
    } catch (err) {
      logger.error("[abandonedCart] tick failed", { error: err as Error });
    } finally {
      scheduleNextTick();
    }
  }, WORKER_POLL_INTERVAL_MS);
}

async function tick(): Promise<void> {
  const now = new Date();
  // Passe par les jobs échus tenants confondus. On limite le batch pour
  // éviter d'écrouler la BDD si des milliers ont dû partir en même temps.
  const due = await prisma.abandonedCartJob.findMany({
    where: {
      status: "PENDING",
      nextStageAt: { lte: now, not: null },
    },
    orderBy: { nextStageAt: "asc" },
    take: 100,
    select: {
      id: true,
      tenantId: true,
      userId: true,
      currentStage: true,
      stagesFired: true,
    },
  });
  if (due.length === 0) return;

  // Groupe par tenant pour ne charger la config qu'une fois par tenant.
  const byTenant = new Map<string, typeof due>();
  for (const j of due) {
    const arr = byTenant.get(j.tenantId) ?? [];
    arr.push(j);
    byTenant.set(j.tenantId, arr);
  }

  for (const [tenantId, jobs] of byTenant.entries()) {
    // tenantALS.run scope les reads Prisma multi-tenant (extension).
    await tenantALS.run(tenantId, async () => {
      // Kill switch global : off → skip mais ne cancel PAS (la cliente peut
      // vouloir rallumer plus tard, les jobs reprennent proprement).
      const cfg = await prisma.siteConfig.findFirst({
        where: { tenantId, key: AUTOMATION_ENABLED_KEY },
        select: { value: true },
      });
      if (cfg?.value !== "true") return;

      const stages = await prisma.abandonedCartStage.findMany({
        where: { tenantId },
        orderBy: { stageIndex: "asc" },
        include: {
          template: {
            select: { id: true, name: true, subject: true, blocks: true },
          },
        },
      });
      if (stages.length === 0) return;

      const stageByIndex = new Map(stages.map((s) => [s.stageIndex, s]));

      for (const job of jobs) {
        try {
          await processJob(tenantId, job, stageByIndex);
        } catch (err) {
          logger.error("[abandonedCart] job failed", {
            tenantId,
            jobId: job.id,
            userId: job.userId,
            error: err as Error,
          });
          // On avance quand même : recule le job d'1 tick pour ne pas
          // spammer le même job en boucle.
          await prisma.abandonedCartJob
            .update({
              where: { id: job.id },
              data: {
                nextStageAt: new Date(Date.now() + WORKER_POLL_INTERVAL_MS * 6),
                lastEvaluatedAt: new Date(),
              },
            })
            .catch(() => undefined);
        }
      }
    });
  }
}

async function processJob(
  tenantId: string,
  job: {
    id: string;
    tenantId: string;
    userId: string;
    currentStage: number;
    stagesFired: unknown;
  },
  stageByIndex: Map<
    number,
    {
      id: string;
      stageIndex: number;
      delaySeconds: number;
      template: { id: string; name: string; subject: string; blocks: unknown };
    }
  >,
): Promise<void> {
  const now = new Date();

  const fired = parseStagesFired(job.stagesFired);
  const maxFired = fired.reduce(
    (m, e) => (e.stageIndex > m ? e.stageIndex : m),
    0,
  );
  const nextStageIndex = maxFired + 1;
  const stage = stageByIndex.get(nextStageIndex);
  if (!stage) {
    // Ce stage n'existe plus (la cliente a supprimé) → passe au suivant
    // configuré > maxFired, ou COMPLETED s'il n'y en a plus.
    const remaining = pickNextStage(
      [...stageByIndex.values()].map((s) => ({
        stageIndex: s.stageIndex,
        delaySeconds: s.delaySeconds,
      })),
      maxFired,
    );
    if (!remaining) {
      await prisma.abandonedCartJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", nextStageAt: null, lastEvaluatedAt: now },
      });
      return;
    }
    await prisma.abandonedCartJob.update({
      where: { id: job.id },
      data: {
        nextStageAt: new Date(now.getTime() + remaining.delaySeconds * 1000),
        lastEvaluatedAt: now,
      },
    });
    return;
  }

  // Recharge user + panier live avec filtre ARCHIVED/OFFLINE/rupture.
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
      abandonedCartOptOut: true,
      acceptsNewsletter: true,
    },
  });
  if (!user || user.role !== "CLIENT" || user.status !== "APPROVED") {
    await cancel(job.id, "USER_NOT_APPROVED");
    return;
  }
  if (user.abandonedCartOptOut || !user.acceptsNewsletter) {
    await cancel(job.id, "OPT_OUT");
    return;
  }

  const cart = await prisma.cart.findFirst({
    where: { userId: user.id },
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

  // Filtre live : garde uniquement les items dont le produit est ONLINE
  // et dont la variante a du stock effectif > 0.
  const validItems = (cart?.items ?? []).filter((it) => {
    const status = it.variant.product.status as ProductStatus;
    if (status !== "ONLINE") return false;
    const effective =
      it.variant.saleType === "PACK" && it.variant.packQuantity
        ? Math.floor(it.variant.stock / it.variant.packQuantity)
        : it.variant.stock;
    return effective > 0;
  });

  if (validItems.length === 0) {
    // Panier vide après filtre — on annule (règle validée : « skip si vide »).
    await cancel(job.id, "CART_EMPTY");
    return;
  }

  const blocks = Array.isArray(stage.template.blocks)
    ? (stage.template.blocks as unknown as NewsletterBlock[])
    : [];
  if (!templateHasUnsubscribeLink(blocks)) {
    logger.error("[abandonedCart] skip send: unsubscribe missing", {
      tenantId,
      stageIndex: stage.stageIndex,
      templateId: stage.template.id,
    });
    // Filet dur : on n'envoie pas + on retarde le job de 1 h pour laisser à
    // la cliente le temps de corriger. Ne cancel pas (elle peut réparer).
    await prisma.abandonedCartJob.update({
      where: { id: job.id },
      data: {
        nextStageAt: new Date(now.getTime() + 3600_000),
        lastEvaluatedAt: now,
      },
    });
    return;
  }

  // Construction du contexte + envoi.
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

  const totalCents = validItems.reduce(
    (s, it) => s + Math.round(Number(it.variant.unitPrice) * 100) * it.quantity,
    0,
  );
  const dynamicItems: CartItemDynamic[] = validItems.map((it) => ({
    productName: it.variant.product.name,
    colorName: it.variant.color?.name ?? null,
    quantity: it.quantity,
    totalCents: Math.round(Number(it.variant.unitPrice) * 100) * it.quantity,
    imagePath: it.variant.images[0]?.path ?? null,
  }));

  const shopContext: MailMergeContext = {
    shopName,
    shopAddress: companyInfo
      ? [
          companyInfo.address,
          [companyInfo.postalCode, companyInfo.city].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      : "",
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
    cartTotal: (totalCents / 100).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR",
    }),
    cartCount: String(dynamicItems.length),
    unsubscribeLink: buildUnsubscribeUrl({
      baseUrl,
      userId: user.id,
      tenantId,
    }),
    privacyLink: `${baseUrl}/fr/confidentialite`,
  };

  const legalLine = [
    shopName,
    [companyInfo?.address, companyInfo?.postalCode, companyInfo?.city]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(" · ");
  const shared = { shopName, baseUrl, legalLine, mergeContext: userContext };

  const dynamic: NewsletterDynamicContext = {
    firstName: user.firstName ?? undefined,
    cart: { items: dynamicItems, totalCents },
  };

  const finalBlocks = substituteVariables(blocks, userContext);
  const finalSubject = interpolate(stage.template.subject, userContext);
  const html = renderNewsletterHtml({
    subject: finalSubject,
    blocks: finalBlocks,
    productsById: new Map(),
    shared,
    dynamic,
    omitGlobalChrome: true,
  });

  const result = await sendMail({
    to: user.email,
    subject: finalSubject,
    html,
    fromName: shopName,
    tracking: {
      scenarioKey: "ABANDONED_CART",
      userId: user.id,
      metadata: {
        source: "auto",
        stageIndex: stage.stageIndex,
        cartItems: dynamicItems.length,
      },
    },
  });

  if (!result.sent) {
    logger.error("[abandonedCart] send failed", {
      tenantId,
      userId: user.id,
      stageIndex: stage.stageIndex,
      reason: result.reason,
      error: result.error,
    });
    // Retarde de 15 min pour retry.
    await prisma.abandonedCartJob.update({
      where: { id: job.id },
      data: {
        nextStageAt: new Date(now.getTime() + 900_000),
        lastEvaluatedAt: now,
      },
    });
    return;
  }

  // Envoi OK → enregistre le stade tiré + calcule le suivant.
  const newFired: FiredEntry[] = [
    ...fired,
    {
      stageIndex: stage.stageIndex,
      sentAt: now.toISOString(),
    },
  ];
  const remainingStages = [...stageByIndex.values()].map((s) => ({
    stageIndex: s.stageIndex,
    delaySeconds: s.delaySeconds,
  }));
  const next = pickNextStage(remainingStages, stage.stageIndex);
  await prisma.abandonedCartJob.update({
    where: { id: job.id },
    data: {
      currentStage: stage.stageIndex,
      stagesFired: newFired as unknown as object,
      status: next ? "PENDING" : "COMPLETED",
      nextStageAt: next ? new Date(now.getTime() + next.delaySeconds * 1000) : null,
      lastEvaluatedAt: now,
    },
  });
}

async function cancel(jobId: string, reason: string): Promise<void> {
  await prisma.abandonedCartJob.update({
    where: { id: jobId },
    data: {
      status: "CANCELLED",
      nextStageAt: null,
      cancelReason: reason,
      lastEvaluatedAt: new Date(),
    },
  });
}

function parseStagesFired(raw: unknown): FiredEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e): FiredEntry | null => {
      if (!e || typeof e !== "object") return null;
      const rec = e as Record<string, unknown>;
      const idx = Number(rec.stageIndex);
      const at = typeof rec.sentAt === "string" ? rec.sentAt : "";
      if (!Number.isFinite(idx) || idx <= 0 || !at) return null;
      return {
        stageIndex: idx,
        sentAt: at,
        emailSendId:
          typeof rec.emailSendId === "string" ? rec.emailSendId : undefined,
      };
    })
    .filter((x): x is FiredEntry => x !== null);
}
