import { z } from "zod";
import { logger } from "@/lib/logger";

/**
 * Environment variable validation using Zod v4.
 *
 * - Required vars throw on startup if missing.
 * - Optional vars (configurable via admin UI) default to undefined.
 * - Import this file from a server component only (never from "use client").
 */

const envSchema = z.object({
  // ── Required ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
  NEXTAUTH_URL: z.url("NEXTAUTH_URL must be a valid URL"),
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY is required"),

  // ── Cloudflare R2 (required) ──────────────────────────────────────────────
  R2_ACCESS_KEY_ID: z.string().min(1, "R2_ACCESS_KEY_ID is required"),
  R2_SECRET_ACCESS_KEY: z.string().min(1, "R2_SECRET_ACCESS_KEY is required"),
  R2_ENDPOINT: z.string().min(1, "R2_ENDPOINT is required"),
  R2_BUCKET_NAME: z.string().min(1, "R2_BUCKET_NAME is required"),
  NEXT_PUBLIC_R2_URL: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),

  // ── Optional — configurable via admin settings UI ─────────────────────────
  STRIPE_PLATFORM_SECRET_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  NOTIFY_EMAIL: z.string().optional(),
  DEEPL_API_KEY: z.string().optional(),
  PFS_EMAIL: z.string().optional(),
  PFS_PASSWORD: z.string().optional(),
  EASY_EXPRESS_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`
    );
    const msg = `Invalid environment variables:\n${missing.join("\n")}`;

    // During build (next build), warn but don't crash
    if (process.env.NEXT_PHASE === "phase-production-build") {
      logger.warn(msg);
      return process.env as unknown as Env;
    }

    logger.error(msg);
    throw new Error("Missing or invalid environment variables");
  }

  return result.data;
}

export const env = validateEnv();
