import { PrismaClient } from "@prisma/client";
import { reportCriticalError, reportSuccess } from "@/lib/health";

/**
 * Singleton Prisma Client with health monitoring.
 * Uses $extends to automatically detect DB connection failures
 * and report them to the circuit breaker for auto-maintenance.
 */

/** Prisma error messages that are expected during concurrent upsert/delete operations */
const SUPPRESSED_ERROR_PATTERNS = [
  "Unique constraint failed",
  "Record to delete does not exist",
  "Record to update not found",
];

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createMonitoredClient> | undefined;
};

function createMonitoredClient() {
  const base = new PrismaClient({
    log: [
      { level: "error", emit: "event" },
      ...(process.env.NODE_ENV === "development" ? [{ level: "warn" as const, emit: "stdout" as const }] : []),
    ],
    // Connection pool: handle 100k visitors with efficient DB connections
    datasourceUrl: process.env.DATABASE_URL,
  });

  // Filter out known race-condition errors from Prisma's internal logging
  base.$on("error", (e: { message: string }) => {
    if (SUPPRESSED_ERROR_PATTERNS.some((p) => e.message.includes(p))) return;
    console.error("prisma:error", e.message);
  });

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          try {
            const result = await query(args);
            reportSuccess();
            return result;
          } catch (err) {
            if (isCriticalPrismaError(err)) {
              reportCriticalError(`prisma.$allOperations`);
            }
            throw err;
          }
        },
      },
    },
  });
}

/**
 * Detect critical Prisma errors (connection failures, not query/validation errors).
 */
function isCriticalPrismaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const name = (err as { name?: string }).name || "";
  const code = (err as { code?: string }).code || "";
  const message = ((err as { message?: string }).message || "").toLowerCase();

  // PrismaClientInitializationError — can't connect at all
  if (name === "PrismaClientInitializationError") return true;

  // P1xxx errors = connection/server errors (P1001 = can't reach, P1002 = timeout, etc.)
  if (code.startsWith("P1")) return true;

  // Common network error patterns
  const criticalPatterns = [
    "econnrefused",
    "econnreset",
    "etimedout",
    "can't reach database",
    "connection refused",
    "too many connections",
    "server has closed the connection",
    "socket hang up",
  ];

  return criticalPatterns.some((p) => message.includes(p));
}

export const prisma = globalForPrisma.prisma ?? createMonitoredClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
