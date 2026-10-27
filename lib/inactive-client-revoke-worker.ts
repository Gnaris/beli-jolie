/**
 * Worker de désactivation automatique des clients inactifs.
 *
 * Règle métier (décidée avec la cliente 2026-10-27) :
 *  - On regarde UNIQUEMENT la date de la dernière commande (lastOrderAt).
 *    Jamais commandé → compteur depuis createdAt.
 *  - Après `warningDays` jours → mail d'avertissement envoyé une seule fois.
 *  - `graceDays` jours plus tard sans nouvelle commande → bascule
 *    APPROVED → DEACTIVATED + mail de confirmation. Le client peut toujours
 *    se connecter mais ne voit plus les prix.
 *  - Réactivation 100 % MANUELLE (admin). À la réactivation, admin pose une
 *    période de probation : si pas de commande d'ici probationUntil, le
 *    worker re-désactive directement (sans ré-avertir). Si commande passée
 *    pendant la probation, le worker clear probationUntil et le client
 *    repart dans le cycle normal.
 *
 * Tick 1h. Scoping tenant via tenantALS.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import {
  notifyClientInactivityWarning,
  notifyClientInactivityRevoked,
} from "@/lib/notifications";
import {
  INACTIVE_REVOKE_ENABLED_KEY,
  INACTIVE_REVOKE_WARNING_DAYS_KEY,
  INACTIVE_REVOKE_GRACE_DAYS_KEY,
  INACTIVE_REVOKE_PROBATION_DAYS_KEY,
  INACTIVE_REVOKE_POLL_INTERVAL_MS,
  parseWarningDays,
  parseGraceDays,
  parseProbationDays,
  computeInactivityReferenceAt,
  computeRevokePhase,
  daysBetween,
  isRevocationActive,
} from "@/lib/inactive-client-revoke-config";

let started = false;

export function startInactiveClientRevokeWorker(): void {
  if (started) return;
  started = true;
  logger.info?.("[inactiveRevoke] worker démarré", {
    pollMs: INACTIVE_REVOKE_POLL_INTERVAL_MS,
  });
  setTimeout(() => {
    void tick()
      .catch((err) =>
        logger.error("[inactiveRevoke] tick failed", { error: err as Error }),
      )
      .finally(() => scheduleNextTick());
  }, 15_000);
}

function scheduleNextTick(): void {
  setTimeout(async () => {
    try {
      await tick();
    } catch (err) {
      logger.error("[inactiveRevoke] tick failed", { error: err as Error });
    } finally {
      scheduleNextTick();
    }
  }, INACTIVE_REVOKE_POLL_INTERVAL_MS);
}

async function tick(): Promise<void> {
  const enabledTenants = await prisma.siteConfig.findMany({
    where: { key: INACTIVE_REVOKE_ENABLED_KEY, value: "true" },
    select: { tenantId: true },
  });
  if (enabledTenants.length === 0) return;

  for (const { tenantId } of enabledTenants) {
    if (!tenantId) continue;
    await tenantALS.run(tenantId, async () => {
      try {
        await processTenant(tenantId);
      } catch (err) {
        logger.error("[inactiveRevoke] tenant tick failed", {
          tenantId,
          error: err as Error,
        });
      }
    });
  }
}

/** Exposé pour tests Vitest : exécute la logique d'un tenant une seule fois. */
export async function processTenantForTests(tenantId: string): Promise<void> {
  return processTenant(tenantId);
}

async function processTenant(tenantId: string): Promise<void> {
  const configRows = await prisma.siteConfig.findMany({
    where: {
      tenantId,
      key: {
        in: [
          INACTIVE_REVOKE_WARNING_DAYS_KEY,
          INACTIVE_REVOKE_GRACE_DAYS_KEY,
          INACTIVE_REVOKE_PROBATION_DAYS_KEY,
        ],
      },
    },
    select: { key: true, value: true },
  });
  const configMap = new Map(configRows.map((r) => [r.key, r.value]));
  const warningDays = parseWarningDays(
    configMap.get(INACTIVE_REVOKE_WARNING_DAYS_KEY),
  );
  const graceDays = parseGraceDays(
    configMap.get(INACTIVE_REVOKE_GRACE_DAYS_KEY),
  );
  // probationDays peut être absent — on utilise 30 par défaut dans le worker
  // uniquement pour l'estimation de la date de pose. L'UI empêche de
  // réactiver sans probationDays configuré, donc en pratique il sera là.
  const probationDays =
    parseProbationDays(configMap.get(INACTIVE_REVOKE_PROBATION_DAYS_KEY)) ?? 30;

  if (!isRevocationActive({ enabled: true, warningDays, graceDays, probationDays })) {
    logger.info?.("[inactiveRevoke] skip tenant: délais non configurés", {
      tenantId,
      warningDays,
      graceDays,
    });
    return;
  }

  const now = new Date();
  // Pré-filtre BDD : clients APPROVED (candidats avertissement/désactivation
  // OU en probation) qui ne sont pas opt-out.
  const warningCutoff = new Date(now.getTime() - warningDays! * 86_400_000);

  const candidates = await prisma.user.findMany({
    where: {
      tenantId,
      role: "CLIENT",
      status: "APPROVED",
      inactiveClientOptOut: false,
      // On garde les clients éligibles au cycle normal (inactivité >
      // warningDays) OU ceux en probation (quelle que soit leur createdAt).
      OR: [
        { createdAt: { lte: warningCutoff } },
        { probationUntil: { not: null } },
      ],
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      inactivityWarningAt: true,
      deactivatedForInactivityAt: true,
      probationUntil: true,
    },
    take: 500,
  });
  if (candidates.length === 0) return;

  const lastOrders = await prisma.order.groupBy({
    by: ["userId"],
    where: {
      tenantId,
      userId: { in: candidates.map((u) => u.id) },
    },
    _max: { createdAt: true },
  });
  const lastOrderByUser = new Map(
    lastOrders.map((row) => [row.userId, row._max.createdAt]),
  );

  for (const user of candidates) {
    try {
      await processUser({
        tenantId,
        user,
        lastOrderAt: lastOrderByUser.get(user.id) ?? null,
        warningDays: warningDays!,
        graceDays: graceDays!,
        probationDays,
        now,
      });
    } catch (err) {
      logger.error("[inactiveRevoke] user failed", {
        tenantId,
        userId: user.id,
        error: err as Error,
      });
    }
  }
}

interface ProcessUserParams {
  tenantId: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    createdAt: Date;
    inactivityWarningAt: Date | null;
    deactivatedForInactivityAt: Date | null;
    probationUntil: Date | null;
  };
  lastOrderAt: Date | null;
  warningDays: number;
  graceDays: number;
  probationDays: number;
  now: Date;
}

async function processUser(params: ProcessUserParams): Promise<void> {
  const { tenantId, user, lastOrderAt, warningDays, graceDays, probationDays, now } =
    params;

  const referenceAt = computeInactivityReferenceAt({
    lastOrderAt,
    createdAt: user.createdAt,
  });
  const phase = computeRevokePhase({
    now,
    referenceAt,
    inactivityWarningAt: user.inactivityWarningAt,
    probationUntil: user.probationUntil,
    warningDays,
    graceDays,
    probationDays,
  });

  // ─── Probation : commande passée pendant la fenêtre → clear + retour cycle normal
  if (phase === "ACTIVE" && user.probationUntil !== null) {
    await prisma.user.updateMany({
      where: { id: user.id, tenantId },
      data: {
        probationUntil: null,
        inactivityWarningAt: null,
        deactivatedForInactivityAt: null,
      },
    });
    logger.info?.("[inactiveRevoke] probation levée (commande)", {
      tenantId,
      userId: user.id,
    });
    return;
  }

  // ─── Probation en cours : rien à faire
  if (phase === "PROBATION_ACTIVE") return;

  // ─── Probation expirée sans commande : re-désactivation DIRECTE (pas de
  //      nouvel avertissement — le client a été prévenu lors de la réactivation).
  if (phase === "PROBATION_EXPIRED") {
    const upd = await prisma.user.updateMany({
      where: {
        id: user.id,
        tenantId,
        status: "APPROVED",
        probationUntil: { not: null },
      },
      data: {
        status: "DEACTIVATED",
        deactivatedForInactivityAt: now,
        probationUntil: null,
      },
    });
    if (upd.count === 0) return;

    const daysInactive = daysBetween(now, referenceAt);
    await notifyClientInactivityRevoked({
      email: user.email,
      firstName: user.firstName,
      daysInactive,
    });
    logger.info?.("[inactiveRevoke] client re-désactivé (probation expirée)", {
      tenantId,
      userId: user.id,
    });
    return;
  }

  // ─── Cycle normal (hors probation)

  if (phase === "ACTIVE") {
    // Wipe inactivityWarningAt si une commande est passée après l'avertissement.
    if (
      user.inactivityWarningAt !== null &&
      referenceAt.getTime() > user.inactivityWarningAt.getTime()
    ) {
      await prisma.user.updateMany({
        where: { id: user.id, tenantId },
        data: { inactivityWarningAt: null },
      });
      logger.info?.("[inactiveRevoke] wipe avertissement après commande", {
        tenantId,
        userId: user.id,
      });
    }
    return;
  }

  if (phase === "GRACE") return;

  const daysInactive = daysBetween(now, referenceAt);

  if (phase === "WARNING_DUE") {
    // Lock optimiste : on pose la date d'avertissement AVANT l'envoi mail.
    const upd = await prisma.user.updateMany({
      where: {
        id: user.id,
        tenantId,
        OR: [
          { inactivityWarningAt: null },
          { inactivityWarningAt: { lt: referenceAt } },
        ],
      },
      data: { inactivityWarningAt: now },
    });
    if (upd.count === 0) return;

    await notifyClientInactivityWarning({
      email: user.email,
      firstName: user.firstName,
      daysInactive,
      graceDays,
    });
    logger.info?.("[inactiveRevoke] avertissement envoyé", {
      tenantId,
      userId: user.id,
      daysInactive,
    });
    return;
  }

  if (phase === "REVOKE_DUE") {
    const upd = await prisma.user.updateMany({
      where: {
        id: user.id,
        tenantId,
        status: "APPROVED",
        deactivatedForInactivityAt: null,
      },
      data: {
        status: "DEACTIVATED",
        deactivatedForInactivityAt: now,
      },
    });
    if (upd.count === 0) return;

    await notifyClientInactivityRevoked({
      email: user.email,
      firstName: user.firstName,
      daysInactive,
    });
    logger.info?.("[inactiveRevoke] client désactivé", {
      tenantId,
      userId: user.id,
      daysInactive,
    });
    return;
  }
}
