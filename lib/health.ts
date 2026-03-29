/**
 * Circuit Breaker — Auto-maintenance system
 *
 * Tracks consecutive critical errors (DB failures, API errors).
 * After ERROR_THRESHOLD consecutive errors, triggers auto-maintenance.
 * Auto-recovers when DB becomes reachable again (only for auto-triggered maintenance).
 */

const ERROR_THRESHOLD = 3;
const RECOVERY_CHECK_INTERVAL_MS = 60_000; // Check recovery every 60s
const ERROR_WINDOW_MS = 120_000; // Errors older than 2 minutes are forgotten

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
 * Report a critical error (DB connection failure, unhandled API error, etc.)
 * Returns true if auto-maintenance was just triggered.
 */
export function reportCriticalError(source?: string): boolean {
  const state = getState();
  state.errors.push(Date.now());
  pruneErrors(state);

  if (process.env.NODE_ENV === "development") {
    console.error(`[health] Critical error reported${source ? ` from ${source}` : ""}. Count: ${state.errors.length}/${ERROR_THRESHOLD}`);
  }

  if (state.errors.length >= ERROR_THRESHOLD && !state.autoMaintenance) {
    state.autoMaintenance = true;
    console.error(`[health] AUTO-MAINTENANCE TRIGGERED after ${state.errors.length} consecutive errors`);
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
    const config = await prisma.siteConfig.findUnique({
      where: { key: "maintenance_mode" },
    });

    // Only auto-recover if the value is "auto" (we set it to "auto" when auto-triggered)
    if (config?.value === "auto") {
      await prisma.siteConfig.update({
        where: { key: "maintenance_mode" },
        data: { value: "false" },
      });
      state.autoMaintenance = false;
      state.errors = [];
      console.error("[health] AUTO-RECOVERY: DB is back online, maintenance disabled");
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
  const { prisma } = await import("@/lib/prisma");
  await prisma.siteConfig.upsert({
    where: { key: "maintenance_mode" },
    update: { value: "auto" },
    create: { key: "maintenance_mode", value: "auto" },
  });
}
