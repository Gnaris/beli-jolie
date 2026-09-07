/**
 * lib/pfs-audit-scheduler.ts
 *
 * Scheduler d'audit PFS automatique. Tick toutes les 5 minutes :
 *   1. Liste les tenants actifs.
 *   2. Pour chacun :
 *      - Si `pfs_audit_auto_enabled` != "1" → skip.
 *      - Si PFS coupé (kill switch produits) → skip.
 *      - Si l'audit courant est encore RUNNING → skip.
 *      - Si `Date.now() - pfs_audit_auto_last_run_at` < intervalHours × 3600 s → skip.
 *      - Sinon : lance `startPfsAuditInBackground(tenantId, { autoTriggered: true })`
 *        sous ALS.
 *   3. Une fois par 24h, purge les runs d'historique > 90 jours.
 *
 * Le scheduler NE relance JAMAIS un audit tout seul si l'auto est désactivé —
 * la seule façon de le rallumer après une erreur est le toggle dans les
 * paramètres (règle validée cliente le 2026-09-07).
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import {
  startPfsAuditInBackground,
  KEY_AUTO_ENABLED,
  KEY_AUTO_INTERVAL_SECONDS,
  KEY_AUTO_INTERVAL_HOURS,
  KEY_AUTO_LAST_RUN_AT,
  KEY_AUTO_PAUSED_AT,
  resolveIntervalSeconds,
} from "@/lib/pfs-audit-runner";
import { purgeOldPfsAuditRuns } from "@/lib/pfs-audit-history";

// En dev on tique plus rapidement (30 s au lieu de 5 min) mais on RESPECTE
// l'intervalle configuré : sans ça un intervalle « 1 min 30 s » afficherait
// « imminent 00:00 » en boucle. Le tick 30 s = uniquement précision de
// déclenchement, pas de fréquence d'audit.
const IS_DEV = process.env.NODE_ENV !== "production";
// Dev : tick 5 s → l'audit démarre au plus 5 s après le 00:00 côté UI (ou
// tout de suite si la cliente clique « Lancer maintenant »).
// Prod : tick 5 min (charge acceptable, l'UI peut aussi trigger direct).
const TICK_INTERVAL_MS = IS_DEV ? 5_000 : 5 * 60 * 1000;
const START_DELAY_MS = IS_DEV ? 5_000 : 20_000;
const PURGE_INTERVAL_MS = 24 * 3600 * 1000;
const KEY_STATE = "pfs_audit_state";

let started = false;

interface PersistedState {
  status?: string;
}

/**
 * Utilisé par l'UI pour afficher un compte à rebours du prochain audit auto.
 * Exposé dans les mêmes conditions que le scheduler (dev vs prod).
 */
export const PFS_AUDIT_SCHEDULER_TICK_MS = TICK_INTERVAL_MS;

async function tickTenant(tenantId: string): Promise<void> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      tenantId,
      key: {
        in: [
          KEY_AUTO_ENABLED,
          KEY_AUTO_INTERVAL_SECONDS,
          KEY_AUTO_INTERVAL_HOURS,
          KEY_AUTO_LAST_RUN_AT,
          KEY_AUTO_PAUSED_AT,
          KEY_STATE,
          "pfs_products_management_enabled",
        ],
      },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const enabled = map.get(KEY_AUTO_ENABLED) === "1";
  if (!enabled) return;

  // Pause active ? Le scheduler skip complètement — le chrono figé reste
  // affiché côté UI ; à la reprise, `lastRunAt` sera glissé par la server
  // action pour préserver le temps restant.
  const pausedAt = Number(map.get(KEY_AUTO_PAUSED_AT) ?? "0");
  if (Number.isFinite(pausedAt) && pausedAt > 0) return;

  // Kill switch produits PFS : défaut ON (absent = "1"), OFF = "0".
  const pfsProdEnabled = (map.get("pfs_products_management_enabled") ?? "1") !== "0";
  if (!pfsProdEnabled) return;

  // Intervalle libre en secondes (nouveau format), fallback legacy heures.
  const intervalSeconds = resolveIntervalSeconds(rows);

  // Audit déjà en cours ?
  const stateRaw = map.get(KEY_STATE);
  if (stateRaw) {
    try {
      const parsed = JSON.parse(stateRaw) as PersistedState;
      if (parsed.status === "RUNNING") return;
    } catch {
      /* état corrompu — on ignore, on ne relance rien */
      return;
    }
  }

  // Délai écoulé depuis le dernier run ? Respecté en dev ET en prod : sans ça
  // un intervalle « 1 min 30 s » relancerait à chaque tick sans compter.
  const lastRun = Number(map.get(KEY_AUTO_LAST_RUN_AT) ?? "0");
  const elapsedMs = Date.now() - lastRun;
  if (Number.isFinite(lastRun) && elapsedMs < intervalSeconds * 1000) return;

  logger.info("[PFS Audit Scheduler] Lancement audit auto", {
    tenantId,
    intervalSeconds,
    elapsedSeconds: Math.round(elapsedMs / 1000),
  });

  await tenantALS.run(tenantId, async () => {
    try {
      await startPfsAuditInBackground(tenantId, { autoTriggered: true });
    } catch (err) {
      logger.error("[PFS Audit Scheduler] Démarrage audit échoué", {
        tenantId,
        error: err as Error,
      });
    }
  });
}

async function tick(): Promise<void> {
  try {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const t of tenants) {
      try {
        await tickTenant(t.id);
      } catch (err) {
        logger.error("[PFS Audit Scheduler] Erreur tenant", {
          tenantId: t.id,
          error: err as Error,
        });
      }
    }
  } catch (err) {
    logger.error("[PFS Audit Scheduler] Erreur tick", { error: err as Error });
  }
}

let lastPurgeAt = 0;

async function purgeIfDue(): Promise<void> {
  if (Date.now() - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = Date.now();
  await purgeOldPfsAuditRuns();
}

export function startPfsAuditScheduler(): void {
  if (started) return;
  started = true;
  logger.info("[PFS Audit Scheduler] Démarré", {
    tickMs: TICK_INTERVAL_MS,
    dev: IS_DEV,
  });
  setTimeout(() => {
    void tick();
    void purgeIfDue();
    setInterval(() => {
      void tick();
      void purgeIfDue();
    }, TICK_INTERVAL_MS);
  }, START_DELAY_MS);
}
