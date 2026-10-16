/**
 * lib/support-email-worker.ts
 *
 * Worker « chronomètre 2 min » du système de notification Service Client.
 *
 * Voir `lib/support-notify.ts` pour la logique de décision. Ici on scanne
 * périodiquement les `PendingSupportEmail` dont `dueAt` est passé, on envoie
 * le mail générique (dans le bon sens selon `recipientRole`) et on marque
 * le job SENT (on NE SUPPRIME PAS : le SENT sert de marqueur anti-doublon
 * pour le reste du tour).
 *
 * Multi-tenant : chaque job porte un tenantId — wrap dans `tenantALS.run()`
 * pour que Prisma + les caches SiteConfig + `getCurrentTenantBaseUrl` etc.
 * pointent sur la bonne boutique.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import {
  sendGenericSupportReplyEmail,
  sendGenericAdminReplyEmail,
  type SupportReplyContext,
} from "@/lib/notifications";

const TICK_INTERVAL_MS = 30_000; // 30 s
const START_DELAY_MS = 5_000;
const BATCH_SIZE = 50;

async function processDueJob(jobId: string): Promise<void> {
  // Verrou optimiste : on marque SENT AVANT d'envoyer. Si count === 0, un
  // autre tick (ou un reset de tour) est passé entre-temps → on skip.
  const claim = await prisma.pendingSupportEmail.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "SENT", sentAt: new Date() },
  });
  if (claim.count === 0) return;

  const job = await prisma.pendingSupportEmail.findFirst({
    where: { id: jobId },
    select: {
      conversationId: true,
      userId: true,
      recipientRole: true,
      claimId: true,
    },
  });
  if (!job) return;

  const context: SupportReplyContext = job.claimId ? "claim" : "chat";

  try {
    if (job.recipientRole === "CLIENT") {
      const user = await prisma.user.findFirst({
        where: { id: job.userId },
        select: { email: true, firstName: true },
      });
      if (!user?.email) {
        logger.warn("[support-email-worker] Client sans email — mail non envoyé", {
          jobId,
          userId: job.userId,
        });
        return;
      }
      await sendGenericSupportReplyEmail({
        clientEmail: user.email,
        clientName: user.firstName ?? "",
        conversationId: job.conversationId,
        context,
        claimId: job.claimId ?? undefined,
      });
    } else {
      // Direction client → admin : on récupère le vrai expéditeur (le client
      // qui a parlé en dernier dans la conv) pour nommer qui a répondu.
      const conv = await prisma.conversation.findFirst({
        where: { id: job.conversationId },
        select: {
          user: {
            select: { firstName: true, lastName: true, company: true },
          },
        },
      });
      const first = conv?.user?.firstName?.trim() ?? "";
      const last = conv?.user?.lastName?.trim() ?? "";
      const clientName = `${first} ${last}`.trim() || "Un client";
      await sendGenericAdminReplyEmail({
        clientName,
        clientCompany: conv?.user?.company ?? "",
        conversationId: job.conversationId,
        context,
        claimId: job.claimId ?? undefined,
      });
    }
  } catch (err) {
    // On garde le job en SENT malgré l'échec : la prochaine réponse de
    // l'autre partie resetera le tour. Éviter de rejouer indéfiniment un
    // mail qui échouerait toujours (adresse invalide, SMTP HS, etc.).
    logger.error("[support-email-worker] Envoi mail échoué", {
      error: err,
      jobId,
    });
  }
}

async function tick(): Promise<void> {
  try {
    const now = new Date();
    const dueJobs = await prisma.pendingSupportEmail.findMany({
      where: { status: "PENDING", dueAt: { lte: now } },
      select: { id: true, tenantId: true },
      take: BATCH_SIZE,
      orderBy: { dueAt: "asc" },
    });

    for (const { id, tenantId } of dueJobs) {
      if (!tenantId) {
        await prisma.pendingSupportEmail.updateMany({
          where: { id, status: "PENDING" },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
        logger.warn("[support-email-worker] Job sans tenantId — annulé", { id });
        continue;
      }
      await tenantALS.run(tenantId, () => processDueJob(id));
    }
  } catch (err) {
    logger.error("[support-email-worker] Tick global échoué", {
      error: err as Error,
    });
  }
}

let started = false;
export function startSupportEmailWorker(): void {
  if (started) return;
  started = true;
  logger.info("[support-email-worker] Worker démarré (tick 30s)");
  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, TICK_INTERVAL_MS);
  }, START_DELAY_MS);
}
