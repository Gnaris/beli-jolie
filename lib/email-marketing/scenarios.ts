/**
 * lib/email-marketing/scenarios.ts
 *
 * Helpers pour lire/écrire la configuration des scénarios email par tenant.
 *
 * Chaque scénario a une clé (`EmailScenarioKey`), un flag `enabled`, et un
 * champ `config` JSON dont le contenu dépend du scénario :
 *   ABANDONED_CART : { reminders: [{ afterHours: 24 }, { afterHours: 72 }] }
 *   BACK_IN_STOCK  : {}
 *   WELCOME        : {}
 *   NEWSLETTER     : {}
 */
import { prisma } from "@/lib/prisma";
import type { EmailScenarioKey } from "@prisma/client";

export interface AbandonedCartConfig {
  /** Liste des relances. Ordre = ordre d'envoi. */
  reminders: { afterHours: number }[];
}

export const DEFAULT_ABANDONED_CART_CONFIG: AbandonedCartConfig = {
  reminders: [{ afterHours: 24 }, { afterHours: 72 }],
};

/**
 * Récupère (ou crée à la volée avec valeurs par défaut) le scénario pour ce
 * tenant. Toujours idempotent — jamais d'exception si le scénario n'existait
 * pas encore.
 */
export async function getOrCreateScenario(
  tenantId: string,
  key: EmailScenarioKey,
): Promise<{ enabled: boolean; config: unknown }> {
  const existing = await prisma.emailScenario.findUnique({
    where: { tenantId_key: { tenantId, key } },
    select: { enabled: true, config: true },
  });
  if (existing) return existing;

  const defaultConfig =
    key === "ABANDONED_CART" ? DEFAULT_ABANDONED_CART_CONFIG : {};
  const created = await prisma.emailScenario.create({
    data: {
      tenantId,
      key,
      enabled: false, // par défaut : la cliente doit activer explicitement
      config: defaultConfig as object,
    },
    select: { enabled: true, config: true },
  });
  return created;
}

export async function getAbandonedCartConfig(
  tenantId: string,
): Promise<{ enabled: boolean; config: AbandonedCartConfig }> {
  const row = await getOrCreateScenario(tenantId, "ABANDONED_CART");
  const raw = (row.config ?? {}) as Partial<AbandonedCartConfig>;
  const reminders = Array.isArray(raw.reminders) && raw.reminders.length > 0
    ? raw.reminders
        .filter((r) => typeof r?.afterHours === "number" && r.afterHours > 0)
        .map((r) => ({ afterHours: Math.round(r.afterHours) }))
    : DEFAULT_ABANDONED_CART_CONFIG.reminders;
  return { enabled: row.enabled, config: { reminders } };
}

export async function setScenarioEnabled(
  tenantId: string,
  key: EmailScenarioKey,
  enabled: boolean,
): Promise<void> {
  await prisma.emailScenario.upsert({
    where: { tenantId_key: { tenantId, key } },
    create: { tenantId, key, enabled, config: {} },
    update: { enabled },
  });
}

export async function setAbandonedCartConfig(
  tenantId: string,
  config: AbandonedCartConfig,
): Promise<void> {
  const sanitized: AbandonedCartConfig = {
    reminders: config.reminders
      .filter((r) => typeof r.afterHours === "number" && r.afterHours > 0)
      .map((r) => ({ afterHours: Math.round(r.afterHours) })),
  };
  if (sanitized.reminders.length === 0) {
    sanitized.reminders = DEFAULT_ABANDONED_CART_CONFIG.reminders;
  }
  await prisma.emailScenario.upsert({
    where: { tenantId_key: { tenantId, key: "ABANDONED_CART" } },
    create: {
      tenantId,
      key: "ABANDONED_CART",
      enabled: false,
      config: sanitized as object,
    },
    update: { config: sanitized as object },
  });
}
