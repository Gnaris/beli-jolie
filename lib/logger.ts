/**
 * lib/logger.ts
 *
 * Structured logger for the application.
 * - Production (NODE_ENV=production):
 *     - error/warn  → multi-line FR block (lib/log-events.ts)
 *     - info        → compact 1-line FR
 *     - debug       → filtré
 * - Development : format coloré historique (inchangé).
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("Server started", { port: 3000 });
 *   logger.error("[PFS] publish failed", { error: err, productRef: "ROBE-1" });
 */
import { formatErrorBlock, formatInfoLine } from "@/lib/log-events";

type LogLevel = "debug" | "info" | "warn" | "error";

const isProduction = process.env.NODE_ENV === "production";

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info:  "\x1b[36m",
  warn:  "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

function formatDev(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const color = LEVEL_COLORS[level];
  const tag = `${color}[${level.toUpperCase()}]${RESET}`;
  const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `${tag} ${message}${metaStr}`;
}

function formatProd(level: LogLevel, message: string, meta?: Record<string, unknown>): string | null {
  const safeMeta = meta ?? {};
  if (level === "error" || level === "warn") {
    return formatErrorBlock({ level, message, meta: safeMeta });
  }
  if (level === "info") {
    return formatInfoLine({ message, meta: safeMeta });
  }
  return null; // debug filtré
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const output = isProduction ? formatProd(level, message, meta) : formatDev(level, message, meta);
  if (output === null) return;

  switch (level) {
    case "debug": console.debug(output); break;
    case "info":  console.log(output); break;
    case "warn":  console.warn(output); break;
    case "error": console.error(output); break;
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
  info:  (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn:  (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};
