/**
 * Circuit Breaker — Auto-maintenance system
 *
 * Tracks consecutive critical errors (DB failures, API errors).
 * After ERROR_THRESHOLD consecutive errors, triggers auto-maintenance.
 * Auto-recovers when DB becomes reachable again (only for auto-triggered maintenance).
 */

import { logger } from "@/lib/logger";

const ERROR_THRESHOLD = 3;
const RECOVERY_CHECK_INTERVAL_MS = 60_000; // Check recovery every 60s
const ERROR_WINDOW_MS = 120_000; // Errors older than 2 minutes are forgotten
const BOOT_GRACE_PERIOD_SEC = 90; // Ignore errors during the first 90s after process start (MySQL warm-up)

interface HealthState {
  errors: number[];          // timestamps of recent errors
  autoMaintenance: boolean;  // true if maintenance was auto-triggered (not manual)
  lastRecoveryCheck: number;
}

const globalForHealth = globalThis as unknown as {
  __healthState: HealthState | undefined;
};

function getState(): HealthState {
  if (!globalForHealth.__healthState) {
    globalForHealth.__healthState = {
      errors: [],
      autoMaintenance: false,
      lastRecoveryCheck: 0,
    };
  }
  return globalForHealth.__healthState;
}

/** Prune errors older than the window */
function pruneErrors(state: HealthState) {
  const cutoff = Date.now() - ERROR_WINDOW_MS;
  state.errors = state.errors.filter((t) => t > cutoff);
}

/**
 * True pendant les premières secondes après le démarrage du process Node.
 * Pendant ce laps de temps, on suppose que MySQL est peut-être encore en train
 * de redémarrer (cas du reboot serveur) — les erreurs DB ne doivent pas
 * déclencher la maintenance automatique.
 */
export function isBootGracePeriod(): boolean {
  return process.uptime() < BOOT_GRACE_PERIOD_SEC;
}

/**
 * Report a critical error (DB connection failure, unhandled API error, etc.)
 * Returns true if auto-maintenance was just triggered.
 */
export function reportCriticalError(source?: string): boolean {
  // Boot grace period : on ignore les erreurs des 90 premières secondes pour
  // laisser à MySQL le temps de redémarrer après un reboot serveur sans
  // basculer le site en maintenance.
  if (isBootGracePeriod()) {
    if (process.env.NODE_ENV === "development") {
      logger.warn("[health] Critical error during boot grace period — ignored", {
        source,
        uptime: process.uptime(),
      });
    }
    return false;
  }

  const state = getState();
  state.errors.push(Date.now());
  pruneErrors(state);

  if (process.env.NODE_ENV === "development") {
    logger.error("[health] Critical error reported", { source, count: state.errors.length, threshold: ERROR_THRESHOLD });
  }

  if (state.errors.length >= ERROR_THRESHOLD && !state.autoMaintenance) {
    state.autoMaintenance = true;
    logger.error("[health] AUTO-MAINTENANCE TRIGGERED", { consecutiveErrors: state.errors.length });
    // Try to persist to DB (best effort — DB might be down)
    triggerAutoMaintenanceInDB().catch(() => {
      // DB is down, maintenance will be served from in-memory flag
    });
    return true;
  }
  return false;
}

/**
 * Clear an error (call on successful operations to reset the counter).
 */
export function reportSuccess() {
  const state = getState();
  if (state.errors.length > 0) {
    state.errors = [];
  }
}

/**
 * Check if auto-maintenance is currently active (in-memory flag).
 */
export function isAutoMaintenanceActive(): boolean {
  return getState().autoMaintenance;
}

/**
 * Clear auto-maintenance flag (called when admin manually disables maintenance).
 */
export function clearAutoMaintenance() {
  const state = getState();
  state.autoMaintenance = false;
  state.errors = [];
}

/**
 * Attempt auto-recovery: if DB is reachable and maintenance was auto-triggered,
 * disable it. Returns true if recovery happened.
 */
export async function attemptAutoRecovery(): Promise<boolean> {
  const state = getState();

  // Only recover auto-triggered maintenance
  if (!state.autoMaintenance) return false;

  // Throttle recovery checks
  const now = Date.now();
  if (now - state.lastRecoveryCheck < RECOVERY_CHECK_INTERVAL_MS) return false;
  state.lastRecoveryCheck = now;

  try {
    // Dynamic import to avoid circular dependencies
    const { prisma } = await import("@/lib/prisma");

    // Test DB connectivity with a simple query
    await prisma.$queryRaw`SELECT 1`;

    // DB is back! Check if maintenance was auto-triggered (not manual)
    const config = await prisma.siteConfig.findFirst({
      where: { key: "maintenance_mode" },
    });

    // Only auto-recover if the value is "auto" (we set it to "auto" when auto-triggered)
    if (config?.value === "auto") {
      await prisma.siteConfig.updateMany({
        where: { key: "maintenance_mode" },
        data: { value: "false" },
      });
      state.autoMaintenance = false;
      state.errors = [];
      logger.info("[health] AUTO-RECOVERY: DB is back online, maintenance disabled");
      return true;
    }

    // If value is "true" (manually set), don't auto-recover
    // But clear the auto flag so we stop checking
    if (config?.value === "true") {
      state.autoMaintenance = false;
    }

    return false;
  } catch {
    // DB still down
    return false;
  }
}

/**
 * Persist auto-maintenance to DB (sets value to "auto" to distinguish from manual)
 */
async function triggerAutoMaintenanceInDB() {
  const { setSiteConfig } = await import("@/lib/site-config-write");
  await setSiteConfig("maintenance_mode", "auto");
}
