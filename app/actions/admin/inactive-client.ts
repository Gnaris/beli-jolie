"use server";

/**
 * CRUD des stades de relance inactivité + toggle global.
 *
 * Miroir strict de `app/actions/admin/abandoned-cart.ts`. Pilote la page
 * `/admin/marketing/mails/inactivite`. Chaque stade a son propre
 * NewsletterTemplate (Stage 1 = template scenarioKey = INACTIVE_CLIENT,
 * Stages 2+ = templates avec scenarioKey null, protégés via FK
 * InactiveClientStage.templateId).
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { SCENARIO_LABELS } from "@/lib/mail-scenario-defaults";
import { SCENARIO_HTML_DEFAULTS } from "@/lib/newsletter-html-defaults";
import {
  extractLastSentFromFired,
  MAX_STAGES,
  MIN_DELAY_SECONDS,
  MAX_DELAY_SECONDS,
  DEFAULT_STAGE_1_DELAY_SECONDS,
  validateStages,
  shouldWipeCycle,
  computeReferenceAt,
  pickFastForwardStage,
} from "@/lib/inactive-client-config";
import { isOnline } from "@/lib/online-status";
import { setSiteConfig } from "@/lib/site-config-write";

const AUTOMATION_ENABLED_KEY = "inactive_client_automation_enabled";

export interface InactiveClientStageDTO {
  id: string;
  stageIndex: number;
  delaySeconds: number;
  templateId: string;
  templateName: string;
  templateSubject: string;
  templateHasUnsubscribeLink: boolean;
  templateUpdatedAt: Date;
}

export interface InactiveClientConfigDTO {
  automationEnabled: boolean;
  stages: InactiveClientStageDTO[];
  allTemplatesLegal: boolean;
}

/**
 * Charge la config complète pour l'affichage. Migration lazy : si aucun stade
 * n'existe encore, crée le Stage 1 lié au template historique INACTIVE_CLIENT
 * (délai par défaut 30 jours).
 */
export async function getInactiveClientConfig(): Promise<InactiveClientConfigDTO> {
  const { tenant } = await requireAdmin();

  await ensureStage1ExistsFor(tenant.id);

  const [stages, cfg] = await Promise.all([
    prisma.inactiveClientStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      include: {
        template: {
          select: { id: true, name: true, subject: true, html: true, updatedAt: true },
        },
      },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: AUTOMATION_ENABLED_KEY },
      select: { value: true },
    }),
  ]);

  const dtos: InactiveClientStageDTO[] = stages.map((s) => {
    const html = s.template.html ?? "";
    return {
      id: s.id,
      stageIndex: s.stageIndex,
      delaySeconds: s.delaySeconds,
      templateId: s.template.id,
      templateName: s.template.name,
      templateSubject: s.template.subject,
      templateHasUnsubscribeLink: html.includes("{unsubscribeLink}"),
      templateUpdatedAt: s.template.updatedAt,
    };
  });

  const allTemplatesLegal =
    dtos.length > 0 && dtos.every((s) => s.templateHasUnsubscribeLink);

  return {
    automationEnabled: cfg?.value === "true",
    stages: dtos,
    allTemplatesLegal,
  };
}

// ─── Migration lazy Stage 1 ────────────────────────────────────────────

async function ensureStage1ExistsFor(tenantId: string): Promise<void> {
  const already = await prisma.inactiveClientStage.findFirst({
    where: { tenantId, stageIndex: 1 },
    select: { id: true },
  });
  if (already) return;

  let template = await prisma.newsletterTemplate.findFirst({
    where: { tenantId, scenarioKey: "INACTIVE_CLIENT" },
    select: { id: true },
  });
  if (!template) {
    const def = SCENARIO_HTML_DEFAULTS.INACTIVE_CLIENT;
    template = await prisma.newsletterTemplate.create({
      data: {
        tenantId,
        name: def.name,
        subject: def.subject,
        format: "html",
        blocks: [],
        html: def.html,
        scenarioKey: "INACTIVE_CLIENT",
      },
      select: { id: true },
    });
  }

  try {
    await prisma.inactiveClientStage.create({
      data: {
        tenantId,
        stageIndex: 1,
        delaySeconds: DEFAULT_STAGE_1_DELAY_SECONDS,
        templateId: template.id,
      },
    });
  } catch (err) {
    logger.error("[inactiveClient] ensureStage1 skip", { tenantId, error: err as Error });
  }
}

// ─── CRUD stades ───────────────────────────────────────────────────────

export async function addInactiveClientStage(): Promise<
  | { success: true; stageId: string; config: InactiveClientConfigDTO }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();

    const existing = await prisma.inactiveClientStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      include: {
        template: { select: { html: true, subject: true } },
      },
    });
    if (existing.length >= MAX_STAGES) {
      return {
        success: false,
        error: `Maximum ${MAX_STAGES} stades — retirez-en un avant d'en ajouter.`,
      };
    }

    const lastStage = existing[existing.length - 1];
    const newStageIndex = (lastStage?.stageIndex ?? 0) + 1;
    const defaultDelay = lastStage
      ? Math.min(
          MAX_DELAY_SECONDS,
          Math.max(MIN_DELAY_SECONDS, lastStage.delaySeconds * 2),
        )
      : DEFAULT_STAGE_1_DELAY_SECONDS;

    // Depuis 2026-09-22 : tous les stades partent du template HTML par défaut.
    // Stades > 1 clonent le HTML du dernier stade si présent (permet à la
    // cliente de dupliquer ses ajustements), sinon fallback sur le défaut.
    const def = SCENARIO_HTML_DEFAULTS.INACTIVE_CLIENT;
    const seedHtml = lastStage?.template.html?.trim().length
      ? lastStage.template.html
      : def.html;
    const seedSubject = lastStage?.template.subject ?? def.subject;

    const created = await prisma.$transaction(async (tx) => {
      const tpl = await tx.newsletterTemplate.create({
        data: {
          tenantId: tenant.id,
          name: `${SCENARIO_LABELS.INACTIVE_CLIENT} — Stade ${newStageIndex}`,
          subject: seedSubject,
          format: "html",
          blocks: [],
          html: seedHtml,
          scenarioKey: null,
        },
      });
      return tx.inactiveClientStage.create({
        data: {
          tenantId: tenant.id,
          stageIndex: newStageIndex,
          delaySeconds: defaultDelay,
          templateId: tpl.id,
        },
      });
    });

    revalidatePath("/admin/marketing/mails");
    revalidatePath("/admin/marketing/mails/inactivite");
    const config = await getInactiveClientConfig();
    return { success: true, stageId: created.id, config };
  } catch (err) {
    logger.error("[addInactiveClientStage]", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function updateInactiveClientStageDelay(
  stageId: string,
  delaySeconds: number,
): Promise<
  | { success: true; config: InactiveClientConfigDTO }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    if (!Number.isFinite(delaySeconds) || delaySeconds < MIN_DELAY_SECONDS) {
      return {
        success: false,
        error: `Le délai doit être d'au moins ${MIN_DELAY_SECONDS} secondes.`,
      };
    }
    if (delaySeconds > MAX_DELAY_SECONDS) {
      return { success: false, error: "Le délai est trop grand." };
    }

    const target = await prisma.inactiveClientStage.findFirst({
      where: { id: stageId, tenantId: tenant.id },
    });
    if (!target) return { success: false, error: "Stade introuvable." };

    const siblings = await prisma.inactiveClientStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      select: { id: true, stageIndex: true, delaySeconds: true },
    });
    const projected = siblings.map((s) =>
      s.id === stageId ? { ...s, delaySeconds } : s,
    );
    const errors = validateStages(projected);
    if (errors.length > 0) {
      return { success: false, error: errors[0].message };
    }

    await prisma.inactiveClientStage.update({
      where: { id: stageId },
      data: { delaySeconds: Math.floor(delaySeconds) },
    });

    // Contrairement au panier abandonné, on n'a pas de nextStageAt à recaler :
    // le worker inactivité recalcule tout à chaque tick à partir de referenceAt.

    revalidatePath("/admin/marketing/mails/inactivite");
    const config = await getInactiveClientConfig();
    return { success: true, config };
  } catch (err) {
    logger.error("[updateInactiveClientStageDelay]", { stageId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Ré-applique les designs par défaut de `inactiveClientStageDefault()` à chaque
 * stade existant du tenant courant (mêmes blocs + sujet + nom). N'affecte pas
 * les délais ni le nombre de stades. Sert à réinitialiser d'un coup les 3
 * modèles quand la cliente veut repartir sur les designs officiels sans avoir
 * à ouvrir chaque modèle un par un. Idempotent.
 */
export async function applyInactiveClientDefaultDesigns(): Promise<
  | { success: true; config: InactiveClientConfigDTO; updated: number }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();

    const stages = await prisma.inactiveClientStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      select: { id: true, stageIndex: true, templateId: true },
    });

    if (stages.length === 0) {
      return {
        success: false,
        error: "Aucun stade à réinitialiser — ajoutez au moins un stade d'abord.",
      };
    }

    // Depuis 2026-09-22 : reset = ré-application du template HTML par défaut.
    // Tous les stades reprennent le même design (la cliente ré-ajuste ensuite
    // stage par stage si besoin).
    const def = SCENARIO_HTML_DEFAULTS.INACTIVE_CLIENT;
    let updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const s of stages) {
        await tx.newsletterTemplate.update({
          where: { id: s.templateId },
          data: {
            name: `${SCENARIO_LABELS.INACTIVE_CLIENT} — Stade ${s.stageIndex}`,
            subject: def.subject,
            format: "html",
            blocks: [],
            html: def.html,
          },
        });
        updated++;
      }
    });

    revalidatePath("/admin/marketing/mails");
    revalidatePath("/admin/marketing/mails/inactivite");
    const config = await getInactiveClientConfig();
    return { success: true, config, updated };
  } catch (err) {
    logger.error("[applyInactiveClientDefaultDesigns]", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function deleteInactiveClientStage(
  stageId: string,
): Promise<
  | { success: true; config: InactiveClientConfigDTO }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    const target = await prisma.inactiveClientStage.findFirst({
      where: { id: stageId, tenantId: tenant.id },
      select: { id: true, templateId: true, stageIndex: true },
    });
    if (!target) return { success: false, error: "Stade introuvable." };

    await prisma.$transaction(async (tx) => {
      await tx.inactiveClientStage.delete({ where: { id: stageId } });
      await tx.newsletterTemplate.delete({ where: { id: target.templateId } });
      const remaining = await tx.inactiveClientStage.findMany({
        where: { tenantId: tenant.id },
        orderBy: { stageIndex: "asc" },
        select: { id: true, stageIndex: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        const wanted = i + 1;
        if (remaining[i].stageIndex !== wanted) {
          await tx.inactiveClientStage.update({
            where: { id: remaining[i].id },
            data: { stageIndex: wanted },
          });
        }
      }
    });

    revalidatePath("/admin/marketing/mails");
    revalidatePath("/admin/marketing/mails/inactivite");
    const config = await getInactiveClientConfig();
    return { success: true, config };
  } catch (err) {
    logger.error("[deleteInactiveClientStage]", { stageId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

// ─── Toggle global ─────────────────────────────────────────────────────

export async function setInactiveClientAutomationEnabled(
  enabled: boolean,
): Promise<
  | { success: true; config: InactiveClientConfigDTO }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    if (enabled) {
      const cfg = await getInactiveClientConfig();
      if (!cfg.allTemplatesLegal) {
        const bad = cfg.stages.filter((s) => !s.templateHasUnsubscribeLink);
        const list = bad.map((s) => `Stade ${s.stageIndex}`).join(", ");
        return {
          success: false,
          error: `Impossible d'activer : le lien de désinscription {unsubscribeLink} manque dans le pied de page (${list}). Ouvrez chaque modèle et remettez la variable dans le bloc « Pied de page ».`,
        };
      }
      if (cfg.stages.length === 0) {
        return {
          success: false,
          error: "Ajoutez au moins un stade avant d'activer les relances.",
        };
      }
    }
    await setSiteConfig(AUTOMATION_ENABLED_KEY, enabled ? "true" : "false");
    // Pas de « point 0 » : à l'activation, un client anciennement inactif
    // reçoit directement le stade le plus haut correspondant à son ancienneté
    // d'inactivité (fast-forward), pas un mail en cascade depuis le stade 1.
    revalidatePath("/admin/marketing/mails/inactivite");
    const config = await getInactiveClientConfig();
    return { success: true, config };
  } catch (err) {
    logger.error("[setInactiveClientAutomationEnabled]", {
      enabled,
      error: err as Error,
    });
    return { success: false, error: (err as Error).message };
  }
}

// ─── Vue par client ────────────────────────────────────────────────────

export interface InactiveClientJobInfo {
  /** Date prévisionnelle de la prochaine relance. null = COMPLETED / CANCELLED / rien à envoyer. */
  nextStageAt: Date | null;
  nextStageIndex: number | null;
  lastSent: {
    stageIndex: number;
    at: Date;
    stillExists: boolean;
  } | null;
}

/**
 * Info affichée pour un lot de clients : calcule le prochain envoi
 * prévisionnel à partir du référentiel actuel (lastSeenAt / lastOrderAt /
 * createdAt). Un client sans job n'apparaît pas dans la Map SAUF s'il est
 * éligible pour au moins le Stade 1 (comptdown affiché en avance).
 */
export async function loadInactiveClientJobsFor(
  userIds: string[],
): Promise<Map<string, InactiveClientJobInfo>> {
  const map = new Map<string, InactiveClientJobInfo>();
  if (userIds.length === 0) return map;
  const { tenant } = await requireAdmin();

  // On charge users + stages + dernière commande par user en parallèle.
  // Order.groupBy nous donne le max(createdAt) par userId en une requête —
  // évite un N+1 sur la fiche client (User n'a PAS de champ lastOrderAt
  // matérialisé, contrairement à AdminClientCard).
  const [users, stages, lastOrders, autoCfg] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds }, tenantId: tenant.id },
      select: {
        id: true,
        role: true,
        status: true,
        acceptsNewsletter: true,
        inactiveClientOptOut: true,
        createdAt: true,
        lastSeenAt: true,
        inactiveClientJob: {
          select: {
            currentStage: true,
            status: true,
            stagesFired: true,
            referenceAt: true,
          },
        },
      },
    }),
    prisma.inactiveClientStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      select: { stageIndex: true, delaySeconds: true },
    }),
    prisma.order.groupBy({
      by: ["userId"],
      where: { tenantId: tenant.id, userId: { in: userIds } },
      _max: { createdAt: true },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: AUTOMATION_ENABLED_KEY },
      select: { value: true },
    }),
  ]);
  const automationEnabled = autoCfg?.value === "true";

  const lastOrderByUser = new Map(
    lastOrders.map((row) => [row.userId, row._max.createdAt]),
  );
  const existingStageIndices = new Set(stages.map((s) => s.stageIndex));

  for (const u of users) {
    const job = u.inactiveClientJob;
    const lastSent = extractLastSentFromFired(job?.stagesFired, existingStageIndices);

    const eligible =
      automationEnabled &&
      u.role === "CLIENT" &&
      u.status === "APPROVED" &&
      u.acceptsNewsletter &&
      !u.inactiveClientOptOut &&
      stages.length > 0 &&
      job?.status !== "COMPLETED";

    let nextStageAt: Date | null = null;
    let nextStageIndex: number | null = null;

    // Client en train de naviguer → timer en PAUSE (caché de la vue). On le
    // masque quand même le lastSent pour ne pas afficher un compteur figé
    // pendant qu'il est sur le site.
    const online = isOnline(u.lastSeenAt);

    if (eligible && !online) {
      const lastOrderAt = lastOrderByUser.get(u.id) ?? null;
      // Wipe si commande post-dernier-envoi (même règle que le worker).
      const wipe = lastSent ? shouldWipeCycle(lastOrderAt, lastSent.at) : false;
      const maxFired = wipe ? 0 : (job?.currentStage ?? 0);
      // Point de départ = dernière activité connue (visite / commande / création).
      const referenceAt = computeReferenceAt({
        lastSeenAt: u.lastSeenAt,
        lastOrderAt,
        createdAt: u.createdAt,
      });
      const now = new Date();
      const elapsedSeconds = Math.floor((now.getTime() - referenceAt.getTime()) / 1000);
      // Fast-forward : si plusieurs stades sont déjà dus, la vue affiche
      // celui qui va vraiment partir (le plus haut atteint). Sinon on
      // affiche le compteur du prochain stade non-encore-envoyé.
      const dueStage = pickFastForwardStage(stages, elapsedSeconds, maxFired);
      const upcoming = stages.find((s) => s.stageIndex > maxFired);
      const shown = dueStage ?? upcoming ?? null;
      if (shown) {
        nextStageIndex = shown.stageIndex;
        nextStageAt = new Date(
          referenceAt.getTime() + shown.delaySeconds * 1000,
        );
      }
    }

    if (!nextStageAt && !lastSent) continue;
    map.set(u.id, { nextStageAt, nextStageIndex, lastSent });
  }
  return map;
}

/**
 * Réinitialise les stades d'un client : vide `stagesFired`. Le cycle repart
 * au stade 1 au prochain tick du worker si le client est resté inactif.
 * Si le client est actif (referenceAt récent), le worker ne fera rien tant
 * qu'il ne retombe pas inactif — comportement identique à un nouveau client.
 */
export async function resetInactiveClientStagesForUser(
  userId: string,
): Promise<
  | { success: true; hasStages: boolean }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: tenant.id },
      select: {
        id: true,
        role: true,
        status: true,
        acceptsNewsletter: true,
        inactiveClientOptOut: true,
      },
    });
    if (!user) return { success: false, error: "Client introuvable." };
    if (user.role !== "CLIENT") {
      return { success: false, error: "Cette action ne concerne que les clients." };
    }

    const [stages, existingJob] = await Promise.all([
      prisma.inactiveClientStage.findMany({
        where: { tenantId: tenant.id },
        select: { stageIndex: true },
      }),
      prisma.inactiveClientJob.findFirst({
        where: { userId, tenantId: tenant.id },
        select: { id: true },
      }),
    ]);

    const now = new Date();
    const canReceive =
      stages.length > 0 &&
      user.status === "APPROVED" &&
      user.acceptsNewsletter &&
      !user.inactiveClientOptOut;

    if (existingJob) {
      await prisma.inactiveClientJob.update({
        where: { id: existingJob.id },
        data: {
          currentStage: 0,
          stagesFired: [] as unknown as object,
          status: canReceive ? "PENDING" : "CANCELLED",
          referenceAt: null,
          lastEvaluatedAt: now,
          cancelReason: canReceive ? null : "RESET_ADMIN",
        },
      });
    }
    // Pas de création préventive : le worker créera le job au premier envoi.

    revalidatePath("/admin/marketing");
    revalidatePath("/admin/marketing/mails/inactivite");
    return { success: true, hasStages: stages.length > 0 };
  } catch (err) {
    logger.error("[resetInactiveClientStagesForUser]", { userId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}
