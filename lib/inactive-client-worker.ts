/**
 * Worker qui envoie les mails de relance inactivité aux échéances.
 *
 * Contrairement au panier abandonné qui est *poussé* par chaque mutation du
 * panier, ce worker est *tiré* : toutes les 10 minutes il scanne les
 * utilisateurs éligibles et envoie ceux qui sont dus (le `lastSeenAt` bump
 * toutes les 30 s pendant que le client navigue → impossible de hook dessus
 * sans exploser la BDD).
 *
 * Pour chaque tenant → chaque user éligible :
 *   1. Compute referenceAt = max(lastSeenAt, lastOrderAt, createdAt).
 *   2. Charge le job (peut être null pour un nouveau).
 *   3. Si shouldWipeCycle (referenceAt > lastFiredSentAt) → wipe stagesFired.
 *   4. Cherche stage[stageIndex = maxFired + 1] :
 *      - inexistant → COMPLETED (silence total jusqu'au prochain cycle).
 *      - (now - referenceAt) < delaySeconds → pas encore dû, on skip.
 *      - sinon → envoi + mémorise dans stagesFired.
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
} from "@/lib/newsletter-blocks";
import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";
import { buildUnsubscribeUrl } from "@/lib/newsletter-unsubscribe-token";
import {
  INACTIVE_WORKER_POLL_INTERVAL_MS,
  computeReferenceAt,
  pickFastForwardStage,
  shouldWipeCycle,
  templateHasUnsubscribeLink,
} from "@/lib/inactive-client-config";
import { isOnline } from "@/lib/online-status";

const AUTOMATION_ENABLED_KEY = "inactive_client_automation_enabled";

interface FiredEntry {
  stageIndex: number;
  sentAt: string;
  emailSendId?: string;
}

let started = false;

export function startInactiveClientWorker(): void {
  if (started) return;
  started = true;
  logger.info?.("[inactiveClient] worker démarré", {
    pollMs: INACTIVE_WORKER_POLL_INTERVAL_MS,
  });
  // 1er tick rapide (5 s) pour ne pas attendre 10 min au démarrage — utile
  // en dev/test et pour rattraper les jobs en retard après un redémarrage
  // long. Ensuite tick régulier toutes les 10 min.
  setTimeout(() => {
    void tick()
      .catch((err) =>
        logger.error("[inactiveClient] tick failed", { error: err as Error }),
      )
      .finally(() => scheduleNextTick());
  }, 5_000);
}

function scheduleNextTick(): void {
  setTimeout(async () => {
    try {
      await tick();
    } catch (err) {
      logger.error("[inactiveClient] tick failed", { error: err as Error });
    } finally {
      scheduleNextTick();
    }
  }, INACTIVE_WORKER_POLL_INTERVAL_MS);
}

async function tick(): Promise<void> {
  // 1. Récupère les tenants qui ont l'automation activée.
  const enabledTenants = await prisma.siteConfig.findMany({
    where: { key: AUTOMATION_ENABLED_KEY, value: "true" },
    select: { tenantId: true },
  });
  if (enabledTenants.length === 0) return;

  for (const { tenantId } of enabledTenants) {
    if (!tenantId) continue;
    await tenantALS.run(tenantId, async () => {
      try {
        await processTenant(tenantId);
      } catch (err) {
        logger.error("[inactiveClient] tenant tick failed", {
          tenantId,
          error: err as Error,
        });
      }
    });
  }
}

async function processTenant(tenantId: string): Promise<void> {
  const stages = await prisma.inactiveClientStage.findMany({
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
  const minDelaySeconds = stages[0].delaySeconds;
  const now = new Date();
  const eligibilityCutoff = new Date(now.getTime() - minDelaySeconds * 1000);

  // Filtre DB : ne charge que les users éligibles côté attributs. On exclut
  // aussi les clients « en ligne » (heartbeat < 60 s) — leur timer est en
  // PAUSE tant qu'ils sont sur le site. Le filtre createdAt est une simple
  // sur-approximation (on affine en app selon le stade en cours).
  const onlineCutoff = new Date(now.getTime() - 60_000);
  const candidateUsers = await prisma.user.findMany({
    where: {
      tenantId,
      role: "CLIENT",
      status: "APPROVED",
      acceptsNewsletter: true,
      inactiveClientOptOut: false,
      createdAt: { lte: eligibilityCutoff },
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: onlineCutoff } }],
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
      createdAt: true,
      lastSeenAt: true,
      inactiveClientJob: {
        select: {
          id: true,
          stagesFired: true,
          status: true,
          currentStage: true,
        },
      },
    },
    take: 500, // batch prudent — un tick suivant ramassera les suivants
  });

  if (candidateUsers.length === 0) return;

  // Charge la dernière commande (max createdAt) par user pour finaliser le
  // filtre `referenceAt <= eligibilityCutoff` en app.
  const lastOrders = await prisma.order.groupBy({
    by: ["userId"],
    where: {
      tenantId,
      userId: { in: candidateUsers.map((u) => u.id) },
    },
    _max: { createdAt: true },
  });
  const lastOrderByUser = new Map(
    lastOrders.map((row) => [row.userId, row._max.createdAt]),
  );

  // Attache lastOrderAt à chaque user pour la suite (processUser en a besoin).
  const users = candidateUsers.map((u) => ({
    ...u,
    lastOrderAt: lastOrderByUser.get(u.id) ?? null,
  }));

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
    logger.error("[inactiveClient] skip tenant: shop legal info missing", {
      tenantId,
      hasShopName: Boolean(shopName.trim()),
      hasShopAddress: Boolean(shopAddress.trim()),
    });
    return;
  }

  for (const user of users) {
    try {
      await processUser({
        tenantId,
        user,
        stageByIndex,
        now,
        shopName,
        shopAddress,
        baseUrl,
        companyInfo,
      });
    } catch (err) {
      logger.error("[inactiveClient] user failed", {
        tenantId,
        userId: user.id,
        error: err as Error,
      });
    }
  }
}

async function processUser(params: {
  tenantId: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    phone: string | null;
    siret: string | null;
    vatNumber: string | null;
    addressStreet: string | null;
    addressZip: string | null;
    addressCity: string | null;
    addressCountry: string | null;
    createdAt: Date;
    lastSeenAt: Date | null;
    lastOrderAt: Date | null;
    inactiveClientJob: {
      id: string;
      stagesFired: unknown;
      status: string;
      currentStage: number;
    } | null;
  };
  stageByIndex: Map<
    number,
    {
      id: string;
      stageIndex: number;
      delaySeconds: number;
      template: { id: string; name: string; subject: string; blocks: unknown };
    }
  >;
  now: Date;
  shopName: string;
  shopAddress: string;
  baseUrl: string;
  companyInfo: {
    address: string | null;
    postalCode: string | null;
    city: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
  } | null;
}): Promise<void> {
  const {
    tenantId,
    user,
    stageByIndex,
    now,
    shopName,
    shopAddress,
    baseUrl,
    companyInfo,
  } = params;
  // Filet dur : client en train de naviguer (heartbeat < 60 s) → PAUSE.
  if (isOnline(user.lastSeenAt, now)) {
    return;
  }

  // Wipe uniquement si commande post-dernier-envoi. Visite ne wipe pas.
  let fired = parseStagesFired(user.inactiveClientJob?.stagesFired);
  const lastSent = fired.length > 0
    ? fired.reduce(
        (max, e) => (new Date(e.sentAt) > max ? new Date(e.sentAt) : max),
        new Date(fired[0].sentAt),
      )
    : null;
  const wipe = shouldWipeCycle(user.lastOrderAt, lastSent);
  if (wipe) fired = [];

  if (wipe && user.inactiveClientJob) {
    await prisma.inactiveClientJob.updateMany({
      where: { id: user.inactiveClientJob.id, currentStage: { gt: 0 } },
      data: {
        currentStage: 0,
        stagesFired: [] as unknown as object,
        status: "PENDING",
        cancelReason: null,
      },
    });
  }

  const maxFired = fired.reduce(
    (m, e) => (e.stageIndex > m ? e.stageIndex : m),
    0,
  );

  // Point de départ = dernière activité connue (visite, commande, création).
  const referenceAt = computeReferenceAt({
    lastSeenAt: user.lastSeenAt,
    lastOrderAt: user.lastOrderAt,
    createdAt: user.createdAt,
  });
  const elapsedSeconds = Math.floor(
    (now.getTime() - referenceAt.getTime()) / 1000,
  );

  // Fast-forward : si plusieurs stades sont dus (client anciennement inactif
  // au moment de l'activation), on envoie DIRECTEMENT le plus haut atteint
  // (ex : 1 an sans venir + config 30/45/60j → Stade 3 direct, pas 1+2+3
  // en cascade). Les stades intermédiaires sont sautés (pas mémorisés dans
  // stagesFired), ils sont simplement "zappés" par avance de currentStage.
  const stagesArr = Array.from(stageByIndex.values());
  const stage = pickFastForwardStage(stagesArr, elapsedSeconds, maxFired);

  if (!stage) {
    // Aucun stade dû. Si maxFired couvre déjà tous les stades → COMPLETED.
    const highest = stagesArr.reduce(
      (m, s) => (s.stageIndex > m ? s.stageIndex : m),
      0,
    );
    if (
      maxFired >= highest &&
      user.inactiveClientJob &&
      user.inactiveClientJob.status !== "COMPLETED"
    ) {
      await prisma.inactiveClientJob.update({
        where: { id: user.inactiveClientJob.id },
        data: {
          status: "COMPLETED",
          referenceAt,
          lastEvaluatedAt: now,
          currentStage: maxFired,
          stagesFired: fired as unknown as object,
        },
      });
    }
    return;
  }

  // Filet dur RGPD : template doit contenir {unsubscribeLink}.
  const blocks = Array.isArray(stage.template.blocks)
    ? (stage.template.blocks as unknown as NewsletterBlock[])
    : [];
  if (!templateHasUnsubscribeLink(blocks)) {
    logger.error("[inactiveClient] skip send: unsubscribe missing", {
      tenantId,
      stageIndex: stage.stageIndex,
      templateId: stage.template.id,
    });
    return; // au prochain tick on revérifie ; laisse le temps à la cliente de corriger
  }

  // Nombre de jours d'inactivité affichable (null = pas de lastSeenAt).
  const daysInactive = user.lastSeenAt
    ? Math.floor((now.getTime() - user.lastSeenAt.getTime()) / 86400_000)
    : null;

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
    days: daysInactive === null ? "" : String(daysInactive),
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
    daysInactive,
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

  // ─── LOCK OPTIMISTE avant l'envoi ───────────────────────────────────
  // On MARQUE d'abord le stade comme envoyé (avec condition sur maxFired
  // via `currentStage`) puis on envoie. Si un autre tick / hot reload a
  // déjà avancé le compteur, notre update touche 0 ligne → on skippe.
  // Effet de bord accepté : si sendMail crash SANS envoyer, le stade sera
  // marqué envoyé quand même (aucun mail parti, mais pas de retry auto).
  // C'est infiniment moins grave qu'un doublon dans la boîte du client.
  const newFired: FiredEntry[] = [
    ...fired,
    { stageIndex: stage.stageIndex, sentAt: now.toISOString() },
  ];
  const hasMoreStages = stageByIndex.has(stage.stageIndex + 1);

  let jobId: string;
  if (user.inactiveClientJob) {
    const upd = await prisma.inactiveClientJob.updateMany({
      where: {
        id: user.inactiveClientJob.id,
        currentStage: maxFired, // ← garde-fou anti-doublon
      },
      data: {
        currentStage: stage.stageIndex,
        stagesFired: newFired as unknown as object,
        status: hasMoreStages ? "PENDING" : "COMPLETED",
        referenceAt,
        lastEvaluatedAt: now,
        cancelReason: null,
      },
    });
    if (upd.count === 0) {
      // Un autre tick a devancé — on skippe silencieusement.
      logger.info?.("[inactiveClient] skip: raced by another tick", {
        tenantId,
        userId: user.id,
        stageIndex: stage.stageIndex,
      });
      return;
    }
    jobId = user.inactiveClientJob.id;
  } else {
    // Pas de job existant : on tente une création. Le champ userId est
    // @unique sur InactiveClientJob → un doublon simultané échouera avec
    // P2002 et on skippera aussi.
    try {
      const created = await prisma.inactiveClientJob.create({
        data: {
          tenantId,
          userId: user.id,
          currentStage: stage.stageIndex,
          stagesFired: newFired as unknown as object,
          status: hasMoreStages ? "PENDING" : "COMPLETED",
          referenceAt,
          lastEvaluatedAt: now,
        },
        select: { id: true },
      });
      jobId = created.id;
    } catch (err) {
      logger.info?.("[inactiveClient] skip: job already created concurrently", {
        tenantId,
        userId: user.id,
        error: (err as Error).message,
      });
      return;
    }
  }

  // Envoi — le lock est déjà posé, un éventuel crash ici ne recréera pas
  // de doublon au prochain tick.
  const result = await sendMail({
    to: user.email,
    subject: finalSubject,
    html,
    fromName: shopName,
    listUnsubscribeUrl: userContext.unsubscribeLink,
    tracking: {
      scenarioKey: "INACTIVE_CLIENT",
      userId: user.id,
      metadata: {
        source: "auto",
        stageIndex: stage.stageIndex,
        daysInactive,
      },
    },
  });

  if (!result.sent) {
    // L'envoi a échoué mais le lock reste posé (pas de re-tentative auto).
    // On loggue en erreur pour que la cliente / dev voient et puissent
    // agir manuellement (bouton « Réinitialiser » sur la fiche client).
    logger.error("[inactiveClient] send failed AFTER lock — pas de retry auto", {
      tenantId,
      userId: user.id,
      jobId,
      stageIndex: stage.stageIndex,
      reason: result.reason,
      error: result.error,
    });
  }
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
