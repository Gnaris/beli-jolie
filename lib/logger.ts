/**
 * lib/logger.ts
 *
 * Structured logger for the application.
 * - Production (NODE_ENV=production): JSON output with timestamp, level, message, metadata
 * - Development: colored readable console output
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("Server started", { port: 3000 });
 *   logger.error("DB connection failed", { error: err.message });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

const isProduction = process.env.NODE_ENV === "production";

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",   // gray
  info:  "\x1b[36m",   // cyan
  warn:  "\x1b[33m",   // yellow
  error: "\x1b[31m",   // red
};
const RESET = "\x1b[0m";

function formatDev(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const color = LEVEL_COLORS[level];
  const tag = `${color}[${level.toUpperCase()}]${RESET}`;
  const metaStr = meta && Object.keys(meta).length > 0
    ? ` ${JSON.stringify(meta)}`
    : "";
  return `${tag} ${message}${metaStr}`;
}

function formatJson(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const output = isProduction
    ? formatJson(level, message, meta)
    : formatDev(level, message, meta);

  switch (level) {
    case "debug":
      console.debug(output);
      break;
    case "info":
      console.log(output);
      break;
    case "warn":
      console.warn(output);
      break;
    case "error":
      console.error(output);
      break;
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
  info:  (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn:  (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};
