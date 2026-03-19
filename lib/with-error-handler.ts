"use server";

import { reportCriticalError, reportSuccess } from "@/lib/health";

/**
 * Wraps a server action to automatically report critical errors
 * to the health circuit breaker.
 *
 * Usage:
 *   export const myAction = withErrorHandler("myAction", async (args) => {
 *     // ... your logic
 *     return { success: true };
 *   });
 */
export async function withErrorHandler<T extends { success: boolean; error?: string }>(
  actionName: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const result = await fn();
    if (result.success) {
      reportSuccess();
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isCritical = isCriticalError(err);

    if (isCritical) {
      reportCriticalError(actionName);
    }

    console.error(`[${actionName}] ${isCritical ? "CRITICAL" : "Error"}: ${message}`);

    return { success: false, error: message } as T;
  }
}

/**
 * Determines if an error is critical (should count toward maintenance trigger).
 * Critical errors: DB connection failures, Prisma connection errors, etc.
 * Non-critical: validation errors, auth errors, business logic errors.
 */
function isCriticalError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;

  const message = err.message.toLowerCase();
  const name = err.name || "";

  // Prisma connection/infrastructure errors
  if (name.includes("PrismaClientInitializationError")) return true;
  if (name.includes("PrismaClientKnownRequestError")) {
    // P1xxx = connection errors, P2xxx = query errors (not critical)
    const match = message.match(/p(\d)/);
    if (match && match[1] === "1") return true;
    return false;
  }

  // Common critical patterns
  const criticalPatterns = [
    "econnrefused",
    "econnreset",
    "etimedout",
    "enotfound",
    "can't reach database",
    "connection refused",
    "connection reset",
    "connection timed out",
    "too many connections",
    "server has closed the connection",
    "socket hang up",
    "getaddrinfo",
    "database is not available",
    "prisma client",
  ];

  return criticalPatterns.some((p) => message.includes(p));
}
