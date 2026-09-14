/**
 * Trigger de mise à jour du job de relance panier abandonné.
 *
 * Appelé depuis chaque server action qui mute le panier (add/remove/qty/size/
 * color). Idempotent + non-bloquant : n'impacte pas la latence de la mutation
 * panier utilisateur — les erreurs internes sont loggées et avalées.
 *
 * Logique :
 *   1. Si l'utilisateur n'est pas CLIENT APPROVED : ne rien faire
 *      (les autres rôles ne reçoivent pas de mails marketing).
 *   2. Si `abandonedCartOptOut = true` : annule le job existant s'il y en a
 *      un, et n'en crée jamais.
 *   3. Si aucune config active (0 stade) : annule + n'en crée pas.
 *   4. Sinon : upsert le job → currentStage = maxSent, nextStageAt = now +
 *      delay(currentStage + 1). Si tous les stades disponibles ont été
 *      envoyés → status = COMPLETED.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/** Cause du CANCELLED : utilisé pour le debug côté admin. */
export type CancelReason =
  | "CART_EMPTY"
  | "OPT_OUT"
  | "ORDER_CREATED"
  | "NO_STAGES"
  | "USER_NOT_APPROVED";

interface StageRow {
  stageIndex: number;
  delaySeconds: number;
}

interface FiredEntry {
  stageIndex: number;
  sentAt: string;
  emailSendId?: string;
}

/**
 * Point d'entrée principal : à appeler APRÈS chaque mutation panier réussie.
 * Sûr à appeler même si le panier vient d'être vidé (le worker skippera).
 *
 * `userId` : id du User qui a fait la mutation.
 * `tenantId` : ID du tenant courant (capturé côté handler).
 */
export async function bumpAbandonedCartTimer(
  userId: string,
  tenantId: string,
): Promise<void> {
  try {
    // 1. User doit être CLIENT APPROVED (admins et rôles autres ignorés).
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        role: true,
        status: true,
        abandonedCartOptOut: true,
        acceptsNewsletter: true,
      },
    });
    if (!user) return;
    if (user.role !== "CLIENT" || user.status !== "APPROVED") {
      await cancelJobIfExists(userId, tenantId, "USER_NOT_APPROVED");
      return;
    }
    // Désinscrit newsletter = désinscrit relances panier (case unique côté
    // client & admin). Le flag `abandonedCartOptOut` est synchronisé mais on
    // vérifie les deux en défense (import legacy, backfill, script CLI…).
    if (user.abandonedCartOptOut || !user.acceptsNewsletter) {
      await cancelJobIfExists(userId, tenantId, "OPT_OUT");
      return;
    }

    // 2. Panier vide → annule le job éventuel.
    const cartCount = await prisma.cartItem.count({
      where: { cart: { userId }, tenantId },
    });
    if (cartCount === 0) {
      await cancelJobIfExists(userId, tenantId, "CART_EMPTY");
      return;
    }

    // 3. Charge les stades configurés (triés par stageIndex).
    const stages = await prisma.abandonedCartStage.findMany({
      where: { tenantId },
      orderBy: { stageIndex: "asc" },
      select: { stageIndex: true, delaySeconds: true },
    });
    if (stages.length === 0) {
      await cancelJobIfExists(userId, tenantId, "NO_STAGES");
      return;
    }

    // 4. Upsert du job avec reset du timer sur le prochain stade non-envoyé.
    const now = new Date();
    const existing = await prisma.abandonedCartJob.findFirst({
      where: { userId, tenantId },
    });
    const stagesFired: FiredEntry[] = existing
      ? parseStagesFired(existing.stagesFired)
      : [];
    const maxFired = stagesFired.reduce(
      (max, e) => (e.stageIndex > max ? e.stageIndex : max),
      0,
    );

    const next = pickNextStage(stages, maxFired);
    if (!next) {
      // Tous les stades disponibles ont déjà été envoyés → COMPLETED.
      if (existing) {
        await prisma.abandonedCartJob.update({
          where: { id: existing.id },
          data: {
            status: "COMPLETED",
            nextStageAt: null,
            lastCartUpdateAt: now,
            cancelReason: null,
          },
        });
      }
      return;
    }

    const nextStageAt = new Date(now.getTime() + next.delaySeconds * 1000);

    if (existing) {
      await prisma.abandonedCartJob.update({
        where: { id: existing.id },
        data: {
          currentStage: maxFired,
          status: "PENDING",
          nextStageAt,
          lastCartUpdateAt: now,
          cancelReason: null,
        },
      });
    } else {
      await prisma.abandonedCartJob.create({
        data: {
          tenantId,
          userId,
          currentStage: 0,
          stagesFired: [] as unknown as object,
          nextStageAt,
          status: "PENDING",
          lastCartUpdateAt: now,
        },
      });
    }
  } catch (err) {
    // Fire-and-forget : on log mais on ne casse pas le flow panier utilisateur.
    logger.error("[abandonedCart] bump timer failed", {
      userId,
      tenantId,
      error: err as Error,
    });
  }
}

/**
 * Annule le job (s'il existe) : appelé sur commande créée, opt-out, etc.
 * Ne crée pas de job si absent. Idempotent.
 */
export async function cancelAbandonedCartJob(
  userId: string,
  tenantId: string,
  reason: CancelReason,
): Promise<void> {
  try {
    await prisma.abandonedCartJob.updateMany({
      where: {
        userId,
        tenantId,
        status: "PENDING",
      },
      data: {
        status: "CANCELLED",
        nextStageAt: null,
        cancelReason: reason,
      },
    });
  } catch (err) {
    logger.error("[abandonedCart] cancel job failed", {
      userId,
      tenantId,
      reason,
      error: err as Error,
    });
  }
}

async function cancelJobIfExists(
  userId: string,
  tenantId: string,
  reason: CancelReason,
): Promise<void> {
  await prisma.abandonedCartJob.updateMany({
    where: { userId, tenantId, status: "PENDING" },
    data: { status: "CANCELLED", nextStageAt: null, cancelReason: reason },
  });
}

/**
 * Décision d'amorçage pour un client donné au moment où la cliente active
 * l'automation panier abandonné. Extrait comme fonction pure pour être
 * testable sans BDD.
 *
 * Règles :
 * - Aucun job → CREATE avec timer = délai du stade 1.
 * - Job PENDING ou COMPLETED → LAISSE tel quel (le worker prend le relais).
 * - Job CANCELLED → RESUME au prochain stade non-envoyé (préserve les
 *   stades déjà envoyés, timer = délai du prochain stade). Si tous les
 *   stades configurés ont déjà été envoyés → COMPLETE_NOW.
 */
export type ResumeAction = "CREATE" | "RESUME" | "COMPLETE_NOW" | "LEAVE_UNCHANGED";

export interface ResumeDecision {
  action: ResumeAction;
  /** Stade déjà envoyé le plus haut. 0 = aucun envoyé. */
  currentStage: number;
  /** Délai (secondes) avant le prochain envoi. Défini si CREATE ou RESUME. */
  nextStageDelaySeconds?: number;
}

export function decideResumeAction(
  existingJob: {
    status: string;
    stagesFired: unknown;
  } | null,
  stages: StageRow[],
): ResumeDecision {
  if (stages.length === 0) {
    return { action: "LEAVE_UNCHANGED", currentStage: 0 };
  }

  if (!existingJob) {
    return {
      action: "CREATE",
      currentStage: 0,
      nextStageDelaySeconds: stages[0].delaySeconds,
    };
  }

  if (existingJob.status === "PENDING" || existingJob.status === "COMPLETED") {
    return { action: "LEAVE_UNCHANGED", currentStage: 0 };
  }

  // CANCELLED → reprend en préservant les stades déjà envoyés.
  const fired = parseStagesFired(existingJob.stagesFired);
  const maxFired = fired.reduce((m, e) => (e.stageIndex > m ? e.stageIndex : m), 0);
  const next = pickNextStage(stages, maxFired);
  if (!next) {
    return { action: "COMPLETE_NOW", currentStage: maxFired };
  }
  return {
    action: "RESUME",
    currentStage: maxFired,
    nextStageDelaySeconds: next.delaySeconds,
  };
}

/**
 * Amorce ou reprend les timers de relance panier abandonné pour tous les
 * clients APPROVED du tenant qui ont un panier non-vide au moment de
 * l'activation de l'automation. Idempotent : peut être ré-appelé plusieurs
 * fois sans effet de bord (les jobs actifs sont laissés intacts).
 */
export async function seedAbandonedCartJobsForTenant(
  tenantId: string,
): Promise<{ created: number; resumed: number; completed: number }> {
  const stages = await prisma.abandonedCartStage.findMany({
    where: { tenantId },
    orderBy: { stageIndex: "asc" },
    select: { stageIndex: true, delaySeconds: true },
  });
  if (stages.length === 0) {
    return { created: 0, resumed: 0, completed: 0 };
  }

  const users = await prisma.user.findMany({
    where: {
      tenantId,
      role: "CLIENT",
      status: "APPROVED",
      abandonedCartOptOut: false,
      acceptsNewsletter: true,
      cart: { items: { some: {} } },
    },
    select: {
      id: true,
      abandonedCartJob: {
        select: { id: true, status: true, stagesFired: true },
      },
    },
  });

  let created = 0;
  let resumed = 0;
  let completed = 0;
  const now = new Date();

  for (const user of users) {
    const decision = decideResumeAction(user.abandonedCartJob ?? null, stages);
    try {
      if (decision.action === "CREATE") {
        const delayMs = (decision.nextStageDelaySeconds ?? 0) * 1000;
        await prisma.abandonedCartJob.create({
          data: {
            tenantId,
            userId: user.id,
            currentStage: 0,
            stagesFired: [] as unknown as object,
            nextStageAt: new Date(now.getTime() + delayMs),
            status: "PENDING",
            lastCartUpdateAt: now,
            cancelReason: null,
          },
        });
        created++;
      } else if (decision.action === "RESUME" && user.abandonedCartJob) {
        const delayMs = (decision.nextStageDelaySeconds ?? 0) * 1000;
        await prisma.abandonedCartJob.update({
          where: { id: user.abandonedCartJob.id },
          data: {
            currentStage: decision.currentStage,
            status: "PENDING",
            nextStageAt: new Date(now.getTime() + delayMs),
            lastCartUpdateAt: now,
            cancelReason: null,
            lastEvaluatedAt: now,
          },
        });
        resumed++;
      } else if (decision.action === "COMPLETE_NOW" && user.abandonedCartJob) {
        await prisma.abandonedCartJob.update({
          where: { id: user.abandonedCartJob.id },
          data: {
            currentStage: decision.currentStage,
            status: "COMPLETED",
            nextStageAt: null,
            lastCartUpdateAt: now,
            cancelReason: null,
            lastEvaluatedAt: now,
          },
        });
        completed++;
      }
    } catch (err) {
      logger.error("[abandonedCart] seed job failed", {
        tenantId,
        userId: user.id,
        error: err as Error,
      });
    }
  }

  return { created, resumed, completed };
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
        emailSendId: typeof rec.emailSendId === "string" ? rec.emailSendId : undefined,
      };
    })
    .filter((x): x is FiredEntry => x !== null);
}

/**
 * Trouve le prochain stade à envoyer sachant qu'on a déjà envoyé
 * `maxFiredStageIndex`. Renvoie undefined si tous les stades disponibles ont
 * déjà été joués (ex : `maxFired = 3` avec seulement 3 stades configurés).
 */
export function pickNextStage(
  stages: StageRow[],
  maxFiredStageIndex: number,
): StageRow | undefined {
  const sorted = [...stages].sort((a, b) => a.stageIndex - b.stageIndex);
  return sorted.find((s) => s.stageIndex > maxFiredStageIndex);
}
