"use server";

/**
 * CRUD des stades de relance panier abandonné + toggle global.
 *
 * Pilote la page `/admin/marketing/mails/panier-abandonne` :
 * chaque stade a son propre NewsletterTemplate (Stage 1 = template historique
 * `scenarioKey = ABANDONED_CART`, Stages 2+ = templates avec scenarioKey null
 * mais protégés par FK). La cliente édite chaque template via l'éditeur
 * newsletter classique `newsletters/[id]` — ces server actions ne pilotent
 * que la structure (stades, délais, activation).
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { NewsletterBlock } from "@/lib/newsletter-blocks";
import {
  abandonedCartStageDefault,
  SCENARIO_DEFAULTS,
} from "@/lib/mail-scenario-defaults";
import {
  extractLastSentFromFired,
  MAX_STAGES,
  MIN_DELAY_SECONDS,
  MAX_DELAY_SECONDS,
  templateHasUnsubscribeLink,
  validateStages,
} from "@/lib/abandoned-cart-config";
import {
  pickNextStage,
  seedAbandonedCartJobsForTenant,
} from "@/lib/abandoned-cart-trigger";
import { setSiteConfig } from "@/lib/site-config-write";

const AUTOMATION_ENABLED_KEY = "abandoned_cart_automation_enabled";

export interface AbandonedCartStageDTO {
  id: string;
  stageIndex: number;
  delaySeconds: number;
  templateId: string;
  templateName: string;
  templateSubject: string;
  templateHasUnsubscribeLink: boolean;
  templateUpdatedAt: Date;
}

export interface AbandonedCartConfigDTO {
  automationEnabled: boolean;
  stages: AbandonedCartStageDTO[];
  /** true si tous les templates de stade ont le lien de désinscription. */
  allTemplatesLegal: boolean;
}

/**
 * Charge la config complète pour l'affichage. Migration lazy incluse : si
 * aucun stade n'existe encore pour le tenant, crée automatiquement le Stage 1
 * rattaché au template historique ABANDONED_CART (délai par défaut 1 jour).
 * La cliente peut ensuite ajouter/retirer des stades librement.
 */
export async function getAbandonedCartConfig(): Promise<AbandonedCartConfigDTO> {
  const { tenant } = await requireAdmin();

  await ensureStage1ExistsFor(tenant.id);

  const [stages, cfg] = await Promise.all([
    prisma.abandonedCartStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      include: {
        template: {
          select: { id: true, name: true, subject: true, blocks: true, updatedAt: true },
        },
      },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: AUTOMATION_ENABLED_KEY },
      select: { value: true },
    }),
  ]);

  const dtos: AbandonedCartStageDTO[] = stages.map((s) => {
    const blocks = Array.isArray(s.template.blocks)
      ? (s.template.blocks as unknown as NewsletterBlock[])
      : [];
    return {
      id: s.id,
      stageIndex: s.stageIndex,
      delaySeconds: s.delaySeconds,
      templateId: s.template.id,
      templateName: s.template.name,
      templateSubject: s.template.subject,
      templateHasUnsubscribeLink: templateHasUnsubscribeLink(blocks),
      templateUpdatedAt: s.template.updatedAt,
    };
  });

  const allTemplatesLegal =
    dtos.length > 0 && dtos.every((s) => s.templateHasUnsubscribeLink);

  return {
    automationEnabled: cfg?.value === "true",
    stages: dtos,
    allTemplatesLegal,
  };
}

// ─── Migration lazy Stage 1 ────────────────────────────────────────────

/**
 * Crée le Stage 1 lié au template ABANDONED_CART existant, avec délai par
 * défaut de 24 h. Idempotent : si un Stage 1 existe déjà pour ce tenant,
 * rien ne se passe.
 */
async function ensureStage1ExistsFor(tenantId: string): Promise<void> {
  const already = await prisma.abandonedCartStage.findFirst({
    where: { tenantId, stageIndex: 1 },
    select: { id: true },
  });
  if (already) return;

  // Trouve le template historique ABANDONED_CART (posé par
  // ensureDefaultScenarioTemplatesFor). Fallback : on le crée si absent.
  let template = await prisma.newsletterTemplate.findFirst({
    where: { tenantId, scenarioKey: "ABANDONED_CART" },
    select: { id: true },
  });
  if (!template) {
    const def = SCENARIO_DEFAULTS.ABANDONED_CART;
    template = await prisma.newsletterTemplate.create({
      data: {
        tenantId,
        name: def.name,
        subject: def.subject,
        blocks: def.blocks as unknown as object,
        scenarioKey: "ABANDONED_CART",
      },
      select: { id: true },
    });
  }

  try {
    await prisma.abandonedCartStage.create({
      data: {
        tenantId,
        stageIndex: 1,
        delaySeconds: 86400, // 24 h par défaut
        templateId: template.id,
      },
    });
  } catch (err) {
    // Race possible entre 2 loads parallèles — on ignore.
    logger.error("[abandonedCart] ensureStage1 skip", { tenantId, error: err as Error });
  }
}

// ─── CRUD stades ───────────────────────────────────────────────────────

export async function addAbandonedCartStage(): Promise<
  | { success: true; stageId: string; config: AbandonedCartConfigDTO }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();

    const existing = await prisma.abandonedCartStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      include: {
        template: { select: { blocks: true, subject: true } },
      },
    });
    if (existing.length >= MAX_STAGES) {
      return {
        success: false,
        error: `Maximum ${MAX_STAGES} stades — retirez-en un avant d'en ajouter.`,
      };
    }

    const lastStage = existing[existing.length - 1];
    const newStageIndex = (lastStage?.stageIndex ?? 0) + 1;
    // Délai par défaut : double du dernier, borné entre MIN et MAX.
    const defaultDelay = lastStage
      ? Math.min(
          MAX_DELAY_SECONDS,
          Math.max(MIN_DELAY_SECONDS, lastStage.delaySeconds * 2),
        )
      : 86400;

    // Stades 2 et 3 : on utilise le design par défaut différencié (rappel
    // rassurant / dernière chance). Stades 4+ : on clone le dernier stade —
    // la cliente n'a pas à tout recopier. `scenarioKey=null` sur tous les
    // stades >1 : le Stage 1 garde le rôle de template « officiel » du scénario.
    let seedBlocks: unknown;
    let seedSubject: string;
    if (newStageIndex === 2 || newStageIndex === 3) {
      const def = abandonedCartStageDefault(newStageIndex);
      seedBlocks = def.blocks;
      seedSubject = def.subject;
    } else if (lastStage) {
      seedBlocks = Array.isArray(lastStage.template.blocks)
        ? lastStage.template.blocks
        : SCENARIO_DEFAULTS.ABANDONED_CART.blocks;
      seedSubject = lastStage.template.subject;
    } else {
      seedBlocks = SCENARIO_DEFAULTS.ABANDONED_CART.blocks;
      seedSubject = SCENARIO_DEFAULTS.ABANDONED_CART.subject;
    }

    const created = await prisma.$transaction(async (tx) => {
      const tpl = await tx.newsletterTemplate.create({
        data: {
          tenantId: tenant.id,
          name: `Panier abandonné — Stade ${newStageIndex}`,
          subject: seedSubject,
          blocks: seedBlocks as unknown as object,
          scenarioKey: null,
        },
      });
      return tx.abandonedCartStage.create({
        data: {
          tenantId: tenant.id,
          stageIndex: newStageIndex,
          delaySeconds: defaultDelay,
          templateId: tpl.id,
        },
      });
    });

    revalidatePath("/admin/marketing/mails");
    revalidatePath("/admin/marketing/mails/panier-abandonne");
    const config = await getAbandonedCartConfig();
    return { success: true, stageId: created.id, config };
  } catch (err) {
    logger.error("[addAbandonedCartStage]", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function updateAbandonedCartStageDelay(
  stageId: string,
  delaySeconds: number,
): Promise<
  | { success: true; config: AbandonedCartConfigDTO }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    if (!Number.isFinite(delaySeconds) || delaySeconds < MIN_DELAY_SECONDS) {
      return {
        success: false,
        error: `Le délai doit être d'au moins ${MIN_DELAY_SECONDS} secondes.`,
      };
    }
    if (delaySeconds > MAX_DELAY_SECONDS) {
      return { success: false, error: "Le délai est trop grand." };
    }

    const target = await prisma.abandonedCartStage.findFirst({
      where: { id: stageId, tenantId: tenant.id },
    });
    if (!target) return { success: false, error: "Stade introuvable." };

    // Vérifie que le nouveau délai respecte l'ordre croissant.
    const siblings = await prisma.abandonedCartStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      select: { id: true, stageIndex: true, delaySeconds: true },
    });
    const projected = siblings.map((s) =>
      s.id === stageId ? { ...s, delaySeconds } : s,
    );
    const errors = validateStages(projected);
    if (errors.length > 0) {
      return { success: false, error: errors[0].message };
    }

    const newDelay = Math.floor(delaySeconds);
    await prisma.abandonedCartStage.update({
      where: { id: stageId },
      data: { delaySeconds: newDelay },
    });

    // Reset le chronomètre de tous les clients qui étaient en attente de CE
    // stade précisément. Règle validée : ne pas toucher au stade du client
    // (celui déjà envoyé), mais recaler le timer du prochain envoi sur le
    // nouveau délai. Filtre : currentStage = target.stageIndex - 1 → « je
    // n'ai reçu que les stades précédents, j'attends celui qui vient de
    // changer ».
    const now = new Date();
    await prisma.abandonedCartJob.updateMany({
      where: {
        tenantId: tenant.id,
        status: "PENDING",
        currentStage: target.stageIndex - 1,
      },
      data: {
        nextStageAt: new Date(now.getTime() + newDelay * 1000),
        lastEvaluatedAt: now,
      },
    });

    revalidatePath("/admin/marketing/mails/panier-abandonne");
    const config = await getAbandonedCartConfig();
    return { success: true, config };
  } catch (err) {
    logger.error("[updateAbandonedCartStageDelay]", { stageId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Supprime un stade + son template lié (validé par la cliente : « supprime
 * avec pour être plus propre »). Puis renumérote les stades restants pour
 * garder 1, 2, 3… sans trou. Le Stage 1 (`stageIndex=1`, scenarioKey historique
 * ABANDONED_CART) est traité comme les autres — la cliente peut décider de
 * repartir de zéro si elle veut.
 */
export async function deleteAbandonedCartStage(
  stageId: string,
): Promise<
  | { success: true; config: AbandonedCartConfigDTO }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    const target = await prisma.abandonedCartStage.findFirst({
      where: { id: stageId, tenantId: tenant.id },
      select: { id: true, templateId: true, stageIndex: true },
    });
    if (!target) return { success: false, error: "Stade introuvable." };

    await prisma.$transaction(async (tx) => {
      await tx.abandonedCartStage.delete({ where: { id: stageId } });
      // Cascade sur FK cascade côté template supprime aussi le stage — ici on a
      // fait l'inverse (supprimer stage d'abord), donc on supprime explicitement
      // le template ensuite.
      await tx.newsletterTemplate.delete({ where: { id: target.templateId } });
      // Renumérote proprement les stades restants.
      const remaining = await tx.abandonedCartStage.findMany({
        where: { tenantId: tenant.id },
        orderBy: { stageIndex: "asc" },
        select: { id: true, stageIndex: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        const wanted = i + 1;
        if (remaining[i].stageIndex !== wanted) {
          await tx.abandonedCartStage.update({
            where: { id: remaining[i].id },
            data: { stageIndex: wanted },
          });
        }
      }
    });

    // Recalcule les timers de tous les jobs pending. Règle validée :
    // - Client dont le prochain stade était celui supprimé (ou un stade
    //   au-dessus renuméroté) → timer reset au délai du nouveau prochain
    //   stade dans la config renumérotée.
    // - Si plus aucun stade à envoyer → status COMPLETED.
    const newStages = await prisma.abandonedCartStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      select: { stageIndex: true, delaySeconds: true },
    });
    const pending = await prisma.abandonedCartJob.findMany({
      where: { tenantId: tenant.id, status: "PENDING" },
      select: { id: true, currentStage: true },
    });
    const now = new Date();
    for (const job of pending) {
      const next = pickNextStage(newStages, job.currentStage);
      if (next) {
        await prisma.abandonedCartJob.update({
          where: { id: job.id },
          data: {
            nextStageAt: new Date(now.getTime() + next.delaySeconds * 1000),
            lastEvaluatedAt: now,
          },
        });
      } else {
        await prisma.abandonedCartJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            nextStageAt: null,
            lastEvaluatedAt: now,
          },
        });
      }
    }

    revalidatePath("/admin/marketing/mails");
    revalidatePath("/admin/marketing/mails/panier-abandonne");
    const config = await getAbandonedCartConfig();
    return { success: true, config };
  } catch (err) {
    logger.error("[deleteAbandonedCartStage]", { stageId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

// ─── Toggle global ─────────────────────────────────────────────────────

export async function setAbandonedCartAutomationEnabled(
  enabled: boolean,
): Promise<
  | { success: true; config: AbandonedCartConfigDTO }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    if (enabled) {
      // Filet dur : on refuse d'activer si un template manque le lien de
      // désinscription — impossible d'envoyer un mail marketing sans lui.
      const cfg = await getAbandonedCartConfig();
      if (!cfg.allTemplatesLegal) {
        const bad = cfg.stages.filter((s) => !s.templateHasUnsubscribeLink);
        const list = bad.map((s) => `Stade ${s.stageIndex}`).join(", ");
        return {
          success: false,
          error: `Impossible d'activer : le lien de désinscription {unsubscribeLink} manque dans le pied de page (${list}). Ouvrez chaque modèle et remettez la variable dans le bloc « Pied de page ».`,
        };
      }
      if (cfg.stages.length === 0) {
        return {
          success: false,
          error: "Ajoutez au moins un stade avant d'activer les relances.",
        };
      }
    }
    await setSiteConfig(AUTOMATION_ENABLED_KEY, enabled ? "true" : "false");
    if (enabled) {
      // À l'activation : amorce un timer pour tous les paniers non-vides déjà
      // en cours. Sans ça, un client dont le panier date d'avant l'activation
      // ne recevrait aucune relance (le trigger ne se déclenche que sur une
      // mutation panier). Reprend proprement les jobs annulés en préservant
      // les stades déjà envoyés (jamais 2 fois le même mail).
      const stats = await seedAbandonedCartJobsForTenant(tenant.id);
      logger.info?.("[abandonedCart] activation seed", {
        tenantId: tenant.id,
        ...stats,
      });
    }
    revalidatePath("/admin/marketing/mails/panier-abandonne");
    const config = await getAbandonedCartConfig();
    return { success: true, config };
  } catch (err) {
    logger.error("[setAbandonedCartAutomationEnabled]", {
      enabled,
      error: err as Error,
    });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Info affichée par ligne client dans la vue Mails + Panier abandonné.
 * - `nextStageAt` / `nextStageIndex` : la prochaine relance à envoyer
 *   (null si le job est COMPLETED / CANCELLED).
 * - `lastSent` : le dernier stade effectivement envoyé, avec sa date et
 *   `stillExists` = true si ce stade fait toujours partie de la config
 *   actuelle. Sinon = false (stade supprimé entre-temps par l'admin) → la
 *   vue affiche « (supprimé) ».
 */
export interface AbandonedCartJobInfo {
  nextStageAt: Date | null;
  nextStageIndex: number | null;
  lastSent: {
    stageIndex: number;
    at: Date;
    stillExists: boolean;
  } | null;
}

/**
 * Utilitaire pour les vues qui affichent le compte à rebours par client.
 * Renvoie une Map userId → info. Un client qui n'a jamais eu de job ni
 * envoi n'apparaît pas dans la Map.
 */
export async function loadAbandonedCartJobsFor(
  userIds: string[],
): Promise<Map<string, AbandonedCartJobInfo>> {
  const map = new Map<string, AbandonedCartJobInfo>();
  if (userIds.length === 0) return map;
  const { tenant } = await requireAdmin();

  const [jobs, stages] = await Promise.all([
    prisma.abandonedCartJob.findMany({
      where: {
        tenantId: tenant.id,
        userId: { in: userIds },
      },
      select: {
        userId: true,
        currentStage: true,
        nextStageAt: true,
        status: true,
        stagesFired: true,
      },
    }),
    prisma.abandonedCartStage.findMany({
      where: { tenantId: tenant.id },
      select: { stageIndex: true },
    }),
  ]);

  const existingStageIndices = new Set(stages.map((s) => s.stageIndex));

  for (const j of jobs) {
    const isPending = j.status === "PENDING" && j.nextStageAt !== null;
    const lastSent = extractLastSentFromFired(
      j.stagesFired,
      existingStageIndices,
    );
    if (!isPending && !lastSent) continue; // rien à afficher pour ce client
    map.set(j.userId, {
      nextStageAt: isPending ? j.nextStageAt : null,
      // currentStage = dernier stade envoyé (0 = aucun) — la prochaine
      // relance porte donc l'index currentStage + 1 dans la config.
      nextStageIndex: isPending ? j.currentStage + 1 : null,
      lastSent,
    });
  }
  return map;
}

/**
 * Réinitialise les stades d'un client : vide `stagesFired`, remet
 * `currentStage=0`. Si le panier contient au moins un article, le cycle
 * repart au stade 1 (status PENDING, timer stade 1 armé). Sinon, le job est
 * mis en CANCELLED — dès que la cliente rajoute un article, le trigger
 * relancera proprement depuis le stade 1.
 *
 * Filet dur `requireAdmin()` : cette action mute des données côté client
 * final (elle recevra un mail dans quelques minutes si le panier est plein).
 */
export async function resetAbandonedCartStagesForUser(
  userId: string,
): Promise<
  | { success: true; cartWasEmpty: boolean; timerStarted: boolean }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: tenant.id },
      select: { id: true, role: true, status: true, abandonedCartOptOut: true, acceptsNewsletter: true },
    });
    if (!user) return { success: false, error: "Client introuvable." };
    if (user.role !== "CLIENT") {
      return { success: false, error: "Cette action ne concerne que les clients." };
    }

    const [cartItemCount, stages, existingJob] = await Promise.all([
      prisma.cartItem.count({
        where: { cart: { userId }, tenantId: tenant.id },
      }),
      prisma.abandonedCartStage.findMany({
        where: { tenantId: tenant.id },
        orderBy: { stageIndex: "asc" },
        select: { stageIndex: true, delaySeconds: true },
      }),
      prisma.abandonedCartJob.findFirst({
        where: { userId, tenantId: tenant.id },
        select: { id: true },
      }),
    ]);

    const now = new Date();
    const cartWasEmpty = cartItemCount === 0;
    const canStartTimer =
      !cartWasEmpty &&
      stages.length > 0 &&
      user.status === "APPROVED" &&
      user.acceptsNewsletter &&
      !user.abandonedCartOptOut;

    if (existingJob) {
      if (canStartTimer) {
        await prisma.abandonedCartJob.update({
          where: { id: existingJob.id },
          data: {
            currentStage: 0,
            stagesFired: [] as unknown as object,
            status: "PENDING",
            nextStageAt: new Date(now.getTime() + stages[0].delaySeconds * 1000),
            lastCartUpdateAt: now,
            cancelReason: null,
            lastEvaluatedAt: now,
          },
        });
      } else {
        await prisma.abandonedCartJob.update({
          where: { id: existingJob.id },
          data: {
            currentStage: 0,
            stagesFired: [] as unknown as object,
            status: "CANCELLED",
            nextStageAt: null,
            lastCartUpdateAt: now,
            cancelReason: "RESET_ADMIN",
            lastEvaluatedAt: now,
          },
        });
      }
    } else if (canStartTimer) {
      // Pas de job encore : on n'en crée un que si le timer doit démarrer.
      await prisma.abandonedCartJob.create({
        data: {
          tenantId: tenant.id,
          userId,
          currentStage: 0,
          stagesFired: [] as unknown as object,
          nextStageAt: new Date(now.getTime() + stages[0].delaySeconds * 1000),
          status: "PENDING",
          lastCartUpdateAt: now,
          cancelReason: null,
        },
      });
    }

    revalidatePath("/admin/marketing");
    revalidatePath("/admin/marketing/mails/panier-abandonne");
    return {
      success: true,
      cartWasEmpty,
      timerStarted: canStartTimer,
    };
  } catch (err) {
    logger.error("[resetAbandonedCartStagesForUser]", { userId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

// Note : les fichiers "use server" ne peuvent PAS re-exporter de types
// (Next.js traite tout export comme une server action). Les composants qui
// ont besoin de `ScenarioKey` importent directement depuis
// `@/lib/mail-scenario-defaults`.
