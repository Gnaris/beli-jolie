"use server";

/**
 * Configuration de la notification « retour en stock ».
 *
 * Contrairement à `abandoned-cart` et `inactive-client` qui gèrent plusieurs
 * stades, le retour en stock est un envoi unique : un compteur global (24 h
 * par défaut) s'arme dès qu'un produit revient en stock et empile les retours
 * suivants pour un même client, puis part en un seul mail récap.
 *
 * Cette action pilote :
 *   - le kill switch global `restock_automation_enabled`,
 *   - le délai du compteur `restock_delay_seconds` (minutes/heures/jours),
 *   - l'assurance qu'un NewsletterTemplate avec scenarioKey=RESTOCK existe
 *     (migration lazy — créé au 1ᵉʳ affichage de la page avec le HTML par
 *     défaut).
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { SCENARIO_HTML_DEFAULTS } from "@/lib/newsletter-html-defaults";
import { setSiteConfig } from "@/lib/site-config-write";
import {
  RESTOCK_AUTOMATION_ENABLED_SITE_CONFIG_KEY,
  RESTOCK_DELAY_SITE_CONFIG_KEY,
  RESTOCK_DEFAULT_DELAY_SECONDS,
  RESTOCK_MIN_DELAY_SECONDS,
  RESTOCK_MAX_DELAY_SECONDS,
} from "@/lib/restock-trigger";

/** Info affichée dans la colonne « Retour en stock » de /admin/marketing. */
export interface RestockJobInfo {
  /** Nombre de produits accumulés dans la file en attente d'envoi. */
  entriesCount: number;
  /** Date d'envoi planifiée (null = pas de job PENDING). */
  scheduledSendAt: Date | null;
  /** Dernier envoi réussi (null = jamais envoyé). */
  lastSentAt: Date | null;
  /** Statut brut pour le composant d'affichage. */
  status: "PENDING" | "COMPLETED" | "CANCELLED";
}

/**
 * Charge les jobs retour en stock pour un lot d'utilisateurs. Retourne une
 * map `userId → info`. Un utilisateur sans job n'apparaît pas dans la map.
 */
export async function loadRestockJobsFor(
  userIds: string[],
): Promise<Map<string, RestockJobInfo>> {
  const map = new Map<string, RestockJobInfo>();
  if (userIds.length === 0) return map;
  const { tenant } = await requireAdmin();
  const jobs = await prisma.restockNotificationJob.findMany({
    where: { userId: { in: userIds }, tenantId: tenant.id },
    select: {
      userId: true,
      status: true,
      entries: true,
      scheduledSendAt: true,
      lastSentAt: true,
    },
  });
  for (const j of jobs) {
    const entries = Array.isArray(j.entries) ? j.entries : [];
    map.set(j.userId, {
      entriesCount: entries.length,
      scheduledSendAt: j.scheduledSendAt,
      lastSentAt: j.lastSentAt,
      status: j.status as "PENDING" | "COMPLETED" | "CANCELLED",
    });
  }
  return map;
}

export interface RestockConfigDTO {
  automationEnabled: boolean;
  /** Délai en secondes avant envoi du mail (défaut 24 h). */
  delaySeconds: number;
  template: {
    id: string;
    name: string;
    subject: string;
    hasUnsubscribeLink: boolean;
    hasAnyLoop: boolean;
    updatedAt: Date;
  } | null;
}

/**
 * Charge la config complète + crée le template RESTOCK par défaut si absent.
 * Idempotent — safe à appeler plusieurs fois.
 */
export async function getRestockConfig(): Promise<RestockConfigDTO> {
  const { tenant } = await requireAdmin();

  await ensureTemplateExistsFor(tenant.id);

  const [template, enabledCfg, delayCfg] = await Promise.all([
    prisma.newsletterTemplate.findFirst({
      where: { tenantId: tenant.id, scenarioKey: "RESTOCK" },
      select: {
        id: true,
        name: true,
        subject: true,
        html: true,
        updatedAt: true,
      },
    }),
    prisma.siteConfig.findFirst({
      where: {
        tenantId: tenant.id,
        key: RESTOCK_AUTOMATION_ENABLED_SITE_CONFIG_KEY,
      },
      select: { value: true },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: RESTOCK_DELAY_SITE_CONFIG_KEY },
      select: { value: true },
    }),
  ]);

  const parsed = Number(delayCfg?.value);
  const delaySeconds =
    Number.isFinite(parsed) && parsed >= RESTOCK_MIN_DELAY_SECONDS
      ? Math.min(RESTOCK_MAX_DELAY_SECONDS, Math.floor(parsed))
      : RESTOCK_DEFAULT_DELAY_SECONDS;

  return {
    automationEnabled: enabledCfg?.value === "true",
    delaySeconds,
    template: template
      ? {
          id: template.id,
          name: template.name,
          subject: template.subject,
          hasUnsubscribeLink: (template.html ?? "").includes("{unsubscribeLink}"),
          hasAnyLoop:
            (template.html ?? "").includes("{{#each favorites}}") ||
            (template.html ?? "").includes("{{#each ordered}}"),
          updatedAt: template.updatedAt,
        }
      : null,
  };
}

/**
 * Bascule le kill switch. Désactiver NE supprime PAS les jobs PENDING existants
 * (ils reprennent dès réactivation) — on arrête juste les nouveaux envois.
 */
export async function setRestockAutomationEnabled(
  enabled: boolean,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();

    if (enabled) {
      // Pré-check : template existe + lien de désinscription présent, sinon
      // refus (c'est obligatoire pour l'envoi — ne pas laisser la cliente
      // activer sans savoir que les mails ne partiraient pas).
      const tpl = await prisma.newsletterTemplate.findFirst({
        where: { tenantId: tenant.id, scenarioKey: "RESTOCK" },
        select: { html: true },
      });
      if (!tpl || !tpl.html?.includes("{unsubscribeLink}")) {
        return {
          success: false,
          error:
            "Le modèle « Retour en stock » doit contenir le lien de désinscription ({unsubscribeLink}) avant d'activer l'automatisation.",
        };
      }
    }

    await setSiteConfig(
      RESTOCK_AUTOMATION_ENABLED_SITE_CONFIG_KEY,
      enabled ? "true" : "false",
    );

    revalidatePath("/admin/marketing/mails/retour-en-stock");
    revalidatePath("/admin/marketing");
    return { success: true };
  } catch (err) {
    logger.error("[restock] setAutomationEnabled failed", {
      error: err as Error,
    });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Change le délai du compteur. Validation stricte entre `RESTOCK_MIN_DELAY_SECONDS`
 * et `RESTOCK_MAX_DELAY_SECONDS` — l'UI doit déjà clamper, mais on protège
 * contre les appels directs.
 *
 * Important : tous les jobs PENDING du tenant voient leur `scheduledSendAt`
 * recalculé = `createdAt + newDelay`. Un job dont le nouveau `scheduledSendAt`
 * est dans le passé sera envoyé au prochain tick du worker. C'est voulu : la
 * cliente doit pouvoir baisser le délai à 1 min et déclencher les envois en
 * cours tout de suite (par ex. pour tester).
 */
export async function setRestockDelaySeconds(
  seconds: number,
): Promise<{ success: true; rescheduledCount: number } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    if (!Number.isFinite(seconds)) {
      return { success: false, error: "Délai invalide." };
    }
    const clamped = Math.min(
      RESTOCK_MAX_DELAY_SECONDS,
      Math.max(RESTOCK_MIN_DELAY_SECONDS, Math.floor(seconds)),
    );
    await setSiteConfig(RESTOCK_DELAY_SITE_CONFIG_KEY, String(clamped));

    // Reset du compteur pour tous les jobs PENDING : `scheduledSendAt = now +
    // nouveauDélai`. On repart de maintenant plutôt que de recalculer depuis
    // `createdAt` — sinon la cliente qui augmente le délai (ex. 1 min → 1 h)
    // sur un job vieux de 10 min obtiendrait un délai déjà dépassé (« Envoi
    // imminent ») au lieu de voir le vrai compteur d'1 h reparti à zéro.
    // Conséquence : un ajustement du délai « étend » le temps disponible
    // pour accumuler d'autres produits — c'est voulu, c'est le levier
    // principal de l'écran.
    const now = new Date();
    const nextSendAt = new Date(now.getTime() + clamped * 1000);
    const res = await prisma.restockNotificationJob.updateMany({
      where: { tenantId: tenant.id, status: "PENDING" },
      data: {
        scheduledSendAt: nextSendAt,
        lastEvaluatedAt: now,
      },
    });
    const rescheduled = res.count;

    revalidatePath("/admin/marketing/mails/retour-en-stock");
    revalidatePath("/admin/marketing");
    return { success: true, rescheduledCount: rescheduled };
  } catch (err) {
    logger.error("[restock] setDelaySeconds failed", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Crée le template par défaut RESTOCK si absent pour ce tenant.
 * Idempotent + safe en concurrence (unique composite [tenantId, scenarioKey]).
 */
async function ensureTemplateExistsFor(tenantId: string): Promise<void> {
  const existing = await prisma.newsletterTemplate.findFirst({
    where: { tenantId, scenarioKey: "RESTOCK" },
    select: { id: true },
  });
  if (existing) return;

  const def = SCENARIO_HTML_DEFAULTS.RESTOCK;
  try {
    await prisma.newsletterTemplate.create({
      data: {
        tenantId,
        name: def.name,
        subject: def.subject,
        format: "html",
        blocks: [],
        html: def.html,
        scenarioKey: "RESTOCK",
      },
    });
  } catch (err) {
    // Course probable avec un autre load — on ignore.
    logger.error("[restock] ensureTemplate skip", {
      tenantId,
      error: err as Error,
    });
  }
}
