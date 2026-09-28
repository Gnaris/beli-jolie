"use server";

/**
 * CRUD des modèles de newsletter réutilisables.
 * La cliente compose plusieurs modèles à l'avance, puis choisit lequel
 * envoyer au moment de l'envoi groupé (voir sendNewsletterToUsers).
 *
 * Un modèle peut aussi être *lié à un scénario transactionnel*
 * (ABANDONED_CART / INACTIVE_CLIENT / RESTOCK) — dans ce cas il est utilisé
 * automatiquement à l'envoi du mail correspondant. Voir `mail-scenario-defaults.ts`.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getFooterContent, type NewsletterBlock } from "@/lib/newsletter-blocks";
import {
  missingRequiredMarketingVariables,
  missingScenarioTokens,
} from "@/lib/mail-merge-variables";
import {
  copyFile,
  deleteFile,
  deleteFiles,
  keyFromDbPath,
  listFiles,
  newsletterTemplateImageDir,
} from "@/lib/storage";
import {
  SCENARIO_KEYS,
  SCENARIO_LABELS,
  type ScenarioKey,
} from "@/lib/mail-scenario-defaults";
import { formatDurationShort } from "@/lib/abandoned-cart-config";
import { MANUAL_HTML_DEFAULT, SCENARIO_HTML_DEFAULTS } from "@/lib/newsletter-html-defaults";
import { findOrphanedTemplateImages } from "@/lib/newsletter-html-render";

export type NewsletterTemplateFormat = "blocks" | "html";

export interface NewsletterTemplateSummary {
  id: string;
  name: string;
  subject: string;
  format: NewsletterTemplateFormat;
  blocksCount: number;
  updatedAt: Date;
  createdAt: Date;
  lastSentAt: Date | null;
  scenarioKey: ScenarioKey | null;
}

export interface NewsletterTemplateImageLite {
  id: string;
  name: string;
  path: string;
  alt: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface NewsletterTemplateFull extends NewsletterTemplateSummary {
  blocks: NewsletterBlock[];
  html: string | null;
  images: NewsletterTemplateImageLite[];
}

export async function listNewsletterTemplates(): Promise<NewsletterTemplateSummary[]> {
  const { tenant } = await requireAdmin();
  await ensureDefaultScenarioTemplatesFor(tenant.id);
  // Les templates rattachés à un Stade ≥ 2 (panier abandonné OU inactivité)
  // ne s'éditent QUE depuis leur page dédiée. On les exclut de cette liste
  // pour éviter que la cliente les supprime par erreur (la suppression du
  // template casserait le stade par cascade FK). Le Stade 1 de chaque
  // scénario reste visible via sa tuile dans « Mails automatiques ».
  const [abandonedStageTemplates, inactiveStageTemplates] = await Promise.all([
    prisma.abandonedCartStage.findMany({
      where: { tenantId: tenant.id, stageIndex: { gte: 2 } },
      select: { templateId: true },
    }),
    prisma.inactiveClientStage.findMany({
      where: { tenantId: tenant.id, stageIndex: { gte: 2 } },
      select: { templateId: true },
    }),
  ]);
  const hiddenIds = [
    ...abandonedStageTemplates.map((s) => s.templateId),
    ...inactiveStageTemplates.map((s) => s.templateId),
  ];
  const rows = await prisma.newsletterTemplate.findMany({
    where: {
      tenantId: tenant.id,
      ...(hiddenIds.length > 0 ? { id: { notIn: hiddenIds } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, name: true, subject: true, format: true, blocks: true, updatedAt: true, createdAt: true, lastSentAt: true, scenarioKey: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    subject: r.subject,
    format: (r.format === "html" ? "html" : "blocks") as NewsletterTemplateFormat,
    blocksCount: Array.isArray(r.blocks) ? r.blocks.length : 0,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
    lastSentAt: r.lastSentAt,
    scenarioKey: (r.scenarioKey as ScenarioKey | null) ?? null,
  }));
}

export async function getNewsletterTemplate(id: string): Promise<NewsletterTemplateFull | null> {
  const { tenant } = await requireAdmin();
  let row = await prisma.newsletterTemplate.findFirst({
    where: { id, tenantId: tenant.id },
    include: {
      images: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, path: true, alt: true, sizeBytes: true, width: true, height: true },
      },
    },
  });
  if (!row) return null;

  // Auto-migration inline pour TOUT template encore en format blocks — la
  // politique produit ne conserve plus que l'éditeur HTML depuis 2026-09-22.
  // Scénarios : on charge le HTML par défaut adapté (cart / days / favorites).
  // Templates libres (newsletters manuelles anciennes) + stages 2+ orphelins :
  // on charge le HTML manuel de base pour que la cliente ne perde pas l'accès
  // au modèle (contenu bloc perdu mais elle peut recomposer ou reset).
  // Idempotent : dès que format="html", cette branche est skip.
  if (row.format !== "html") {
    let seedHtml: string;
    let seedSubject: string;
    if (row.scenarioKey && SCENARIO_KEYS.includes(row.scenarioKey as ScenarioKey)) {
      const scenario = row.scenarioKey as ScenarioKey;
      const def = SCENARIO_HTML_DEFAULTS[scenario];
      seedHtml = def.html;
      seedSubject = def.subject;
    } else {
      // Détecter si le template est un stage 2+ d'un scénario auto pour
      // appliquer le bon HTML (cart / days / favorites) selon le stage lié.
      const [ac, ic] = await Promise.all([
        prisma.abandonedCartStage.findFirst({ where: { templateId: id }, select: { stageIndex: true } }),
        prisma.inactiveClientStage.findFirst({ where: { templateId: id }, select: { stageIndex: true } }),
      ]);
      if (ac) {
        seedHtml = SCENARIO_HTML_DEFAULTS.ABANDONED_CART.html;
        seedSubject = SCENARIO_HTML_DEFAULTS.ABANDONED_CART.subject;
      } else if (ic) {
        seedHtml = SCENARIO_HTML_DEFAULTS.INACTIVE_CLIENT.html;
        seedSubject = SCENARIO_HTML_DEFAULTS.INACTIVE_CLIENT.subject;
      } else {
        // Newsletter manuelle héritée format blocks — HTML manuel neutre.
        seedHtml = MANUAL_HTML_DEFAULT;
        seedSubject = row.subject;
      }
    }
    try {
      row = await prisma.newsletterTemplate.update({
        where: { id },
        data: { format: "html", html: seedHtml, subject: seedSubject },
        include: {
          images: {
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true, path: true, alt: true, sizeBytes: true, width: true, height: true },
          },
        },
      });
      logger.info("[getNewsletterTemplate] auto-migrated blocks→html", { id, scenarioKey: row.scenarioKey });
    } catch (err) {
      logger.error("[getNewsletterTemplate] migration failed", { id, error: err as Error });
    }
  }

  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    format: (row.format === "html" ? "html" : "blocks") as NewsletterTemplateFormat,
    blocks: Array.isArray(row.blocks) ? (row.blocks as unknown as NewsletterBlock[]) : [],
    html: row.html ?? null,
    blocksCount: Array.isArray(row.blocks) ? row.blocks.length : 0,
    images: row.images,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    lastSentAt: row.lastSentAt,
    scenarioKey: (row.scenarioKey as ScenarioKey | null) ?? null,
  };
}

/**
 * Défensif (incident 2026-09-28) : garantit que le tag `scenarioKey` des mails
 * auto multi-stades (ABANDONED_CART / INACTIVE_CLIENT) reste posé sur le
 * template réellement lié au Stage 1 par FK. L'ancienne `assignTemplateToScenario`
 * pouvait déplacer ce tag sur un template libre, laissant la tuile afficher un
 * mauvais nom. Idempotent — sans effet si tout est déjà cohérent.
 */
async function repairScenarioKeyDriftFor(tenantId: string): Promise<void> {
  const [acStage1, icStage1] = await Promise.all([
    prisma.abandonedCartStage.findFirst({
      where: { tenantId, stageIndex: 1 },
      select: { templateId: true },
    }),
    prisma.inactiveClientStage.findFirst({
      where: { tenantId, stageIndex: 1 },
      select: { templateId: true },
    }),
  ]);

  for (const [scenario, stage1TemplateId] of [
    ["ABANDONED_CART" as const, acStage1?.templateId ?? null],
    ["INACTIVE_CLIENT" as const, icStage1?.templateId ?? null],
  ]) {
    if (!stage1TemplateId) continue;
    const holder = await prisma.newsletterTemplate.findFirst({
      where: { tenantId, scenarioKey: scenario },
      select: { id: true },
    });
    if (holder && holder.id === stage1TemplateId) continue;
    try {
      await prisma.$transaction(async (tx) => {
        if (holder && holder.id !== stage1TemplateId) {
          await tx.newsletterTemplate.update({
            where: { id: holder.id },
            data: { scenarioKey: null },
          });
        }
        await tx.newsletterTemplate.update({
          where: { id: stage1TemplateId },
          data: { scenarioKey: scenario },
        });
      });
      logger.info("[repairScenarioKeyDrift] resynced", {
        tenantId,
        scenario,
        previousHolder: holder?.id ?? null,
        stage1TemplateId,
      });
    } catch (err) {
      logger.error("[repairScenarioKeyDrift]", { tenantId, scenario, error: err as Error });
    }
  }
}

/**
 * Seed lazy : crée les 3 modèles par défaut s'ils n'existent pas encore pour
 * le tenant. Idempotent (contrainte @@unique[tenantId, scenarioKey] côté DB).
 */
async function ensureDefaultScenarioTemplatesFor(tenantId: string): Promise<void> {
  // 0) Répare un éventuel drift scenarioKey (voir commentaire ci-dessus).
  await repairScenarioKeyDriftFor(tenantId);
  // 1) Seed des scénarios manquants — nouveau format HTML par défaut.
  const existing = await prisma.newsletterTemplate.findMany({
    where: { tenantId, scenarioKey: { in: [...SCENARIO_KEYS] } },
    select: { id: true, scenarioKey: true, format: true },
  });
  const already = new Set(existing.map((e) => e.scenarioKey).filter(Boolean) as string[]);
  const missing = SCENARIO_KEYS.filter((k) => !already.has(k));
  for (const scenario of missing) {
    const html = SCENARIO_HTML_DEFAULTS[scenario];
    try {
      await prisma.newsletterTemplate.create({
        data: {
          tenantId,
          name: html.name,
          subject: html.subject,
          format: "html",
          blocks: [],
          html: html.html,
          scenarioKey: scenario,
        },
      });
    } catch (err) {
      logger.error("[ensureDefaultScenarioTemplates] seed skip", { tenantId, scenario, error: err as Error });
    }
  }

  // 2) Auto-migration blocks→html en batch pour ce tenant. Politique produit
  //    (2026-09-22) : plus aucun template n'est éditable en blocks. On migre :
  //     - les 3 templates scénario (scenarioKey posé) → défaut HTML du scénario
  //     - les stages 2+ (scenarioKey=null mais liés via FK AbandonedCartStage /
  //       InactiveClientStage) → défaut HTML du scénario correspondant
  //    Migration silencieuse : la cliente n'a rien à faire, ses modèles restent
  //    accessibles. Le HTML par défaut est propre et fonctionnel.
  const stillBlocks = await prisma.newsletterTemplate.findMany({
    where: { tenantId, format: { not: "html" } },
    select: { id: true, scenarioKey: true, subject: true },
  });
  if (stillBlocks.length === 0) return;
  const [acStages, icStages] = await Promise.all([
    prisma.abandonedCartStage.findMany({
      where: { tenantId, templateId: { in: stillBlocks.map((t) => t.id) } },
      select: { templateId: true },
    }),
    prisma.inactiveClientStage.findMany({
      where: { tenantId, templateId: { in: stillBlocks.map((t) => t.id) } },
      select: { templateId: true },
    }),
  ]);
  const acStageTemplateIds = new Set(acStages.map((s) => s.templateId));
  const icStageTemplateIds = new Set(icStages.map((s) => s.templateId));

  for (const t of stillBlocks) {
    let seedHtml: string;
    let seedSubject: string;
    if (t.scenarioKey && SCENARIO_KEYS.includes(t.scenarioKey as ScenarioKey)) {
      const def = SCENARIO_HTML_DEFAULTS[t.scenarioKey as ScenarioKey];
      seedHtml = def.html;
      seedSubject = def.subject;
    } else if (acStageTemplateIds.has(t.id)) {
      seedHtml = SCENARIO_HTML_DEFAULTS.ABANDONED_CART.html;
      seedSubject = SCENARIO_HTML_DEFAULTS.ABANDONED_CART.subject;
    } else if (icStageTemplateIds.has(t.id)) {
      seedHtml = SCENARIO_HTML_DEFAULTS.INACTIVE_CLIENT.html;
      seedSubject = SCENARIO_HTML_DEFAULTS.INACTIVE_CLIENT.subject;
    } else {
      seedHtml = MANUAL_HTML_DEFAULT;
      seedSubject = t.subject;
    }
    try {
      await prisma.newsletterTemplate.update({
        where: { id: t.id },
        data: { format: "html", html: seedHtml, subject: seedSubject },
      });
    } catch (err) {
      logger.error("[ensureDefaultScenarioTemplates] batch migrate", { tenantId, templateId: t.id, error: err as Error });
    }
  }
  logger.info("[ensureDefaultScenarioTemplates] batch blocks→html done", { tenantId, count: stillBlocks.length });
}

/**
 * Cible d'assignation possible pour un scénario transactionnel.
 * RESTOCK n'a qu'une cible (le mail unique). ABANDONED_CART et INACTIVE_CLIENT
 * ont N cibles (une par stade configuré) — la cliente choisit laquelle recevoir
 * le contenu du modèle libre.
 */
export interface ScenarioAssignTarget {
  key: string; // "restock" | "abandoned:<stageId>" | "inactive:<stageId>"
  scenario: ScenarioKey;
  stageId: string | null;
  stageIndex: number | null;
  templateId: string;
  templateName: string;
  delaySeconds: number | null;
  /** Libellé prêt à afficher dans la modale de sélection. */
  label: string;
  /** Sous-titre optionnel (délai formaté, etc.). */
  sublabel: string | null;
}

/**
 * Liste les cibles possibles pour appliquer un modèle libre à un scénario
 * transactionnel. Utilisé par `NewslettersListClient` :
 *   - Si 1 seule cible (RESTOCK)          → confirm direct puis `assignTemplateToScenario`.
 *   - Si N cibles (ABANDONED_CART / …)    → modale de sélection puis assign.
 */
export async function getScenarioAssignTargets(
  scenario: ScenarioKey,
): Promise<
  | { success: true; targets: ScenarioAssignTarget[] }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    if (!SCENARIO_KEYS.includes(scenario)) {
      return { success: false, error: "Scénario inconnu." };
    }

    if (scenario === "RESTOCK") {
      const tpl = await prisma.newsletterTemplate.findFirst({
        where: { tenantId: tenant.id, scenarioKey: "RESTOCK" },
        select: { id: true, name: true },
      });
      if (!tpl) {
        return { success: false, error: "Modèle « Retour en stock » introuvable." };
      }
      return {
        success: true,
        targets: [
          {
            key: "restock",
            scenario,
            stageId: null,
            stageIndex: null,
            templateId: tpl.id,
            templateName: tpl.name,
            delaySeconds: null,
            label: SCENARIO_LABELS.RESTOCK,
            sublabel: null,
          },
        ],
      };
    }

    if (scenario === "ABANDONED_CART") {
      const stages = await prisma.abandonedCartStage.findMany({
        where: { tenantId: tenant.id },
        orderBy: { stageIndex: "asc" },
        select: {
          id: true,
          stageIndex: true,
          delaySeconds: true,
          template: { select: { id: true, name: true } },
        },
      });
      return {
        success: true,
        targets: stages.map((s) => ({
          key: `abandoned:${s.id}`,
          scenario,
          stageId: s.id,
          stageIndex: s.stageIndex,
          templateId: s.template.id,
          templateName: s.template.name,
          delaySeconds: s.delaySeconds,
          label: `Stade ${s.stageIndex}`,
          sublabel: `${formatDurationShort(s.delaySeconds)} après le dernier changement de panier`,
        })),
      };
    }

    // INACTIVE_CLIENT
    const stages = await prisma.inactiveClientStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      select: {
        id: true,
        stageIndex: true,
        delaySeconds: true,
        template: { select: { id: true, name: true } },
      },
    });
    return {
      success: true,
      targets: stages.map((s) => ({
        key: `inactive:${s.id}`,
        scenario,
        stageId: s.id,
        stageIndex: s.stageIndex,
        templateId: s.template.id,
        templateName: s.template.name,
        delaySeconds: s.delaySeconds,
        label: `Stade ${s.stageIndex}`,
        sublabel: `${formatDurationShort(s.delaySeconds)} sans activité`,
      })),
    };
  } catch (err) {
    logger.error("[getScenarioAssignTargets]", { scenario, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Applique le contenu (HTML + sujet + bibliothèque d'images) d'un modèle libre
 * à un mail automatique cible.
 *
 * Depuis 2026-09-28 : cette action ne swap plus le tag `scenarioKey` (ancien
 * comportement qui changeait le titre de la tuile et pouvait laisser un état
 * incohérent avec `AbandonedCartStage.templateId`). Elle **copie** :
 *   - le HTML source
 *   - le sujet
 *   - la bibliothèque d'images (fichiers + rows)
 * dans le template déjà lié au scénario / au stade cible. Le nom du mail auto
 * est **préservé** — la cliente garde ses libellés « Panier abandonné — Stade 2 ».
 *
 * Validation stricte du HTML source avant copie :
 *   - variables marketing obligatoires ({shopName}, {shopAddress}, {unsubscribeLink}, {privacyLink})
 *   - tokens spécifiques au scénario ({{#each cart}} pour ABANDONED_CART, etc.)
 * → refuse la copie si un token manque, la cliente est renvoyée à son éditeur.
 *
 * Le modèle source reste intact dans « Mes modèles » — la cliente peut le
 * réutiliser, le modifier, ou l'appliquer à un autre stade.
 */
export async function assignTemplateToScenario(
  sourceTemplateId: string,
  target:
    | { scenario: "RESTOCK" }
    | { scenario: "ABANDONED_CART"; stageId: string }
    | { scenario: "INACTIVE_CLIENT"; stageId: string },
): Promise<
  | { success: true; targetTemplateId: string }
  | { success: false; error: string; missingVariables?: string[] }
> {
  try {
    const { tenant } = await requireAdmin();
    if (!SCENARIO_KEYS.includes(target.scenario)) {
      return { success: false, error: "Scénario inconnu." };
    }

    const source = await prisma.newsletterTemplate.findFirst({
      where: { id: sourceTemplateId, tenantId: tenant.id },
      include: {
        images: {
          select: { name: true, path: true, alt: true, sizeBytes: true, width: true, height: true },
        },
      },
    });
    if (!source) return { success: false, error: "Modèle source introuvable." };

    // ── Résolution de la cible : template du scénario ou du stade. ──
    let targetTemplateId: string;
    let targetLabel: string;
    if (target.scenario === "RESTOCK") {
      const tpl = await prisma.newsletterTemplate.findFirst({
        where: { tenantId: tenant.id, scenarioKey: "RESTOCK" },
        select: { id: true },
      });
      if (!tpl) return { success: false, error: "Mail « Retour en stock » introuvable." };
      targetTemplateId = tpl.id;
      targetLabel = SCENARIO_LABELS.RESTOCK;
    } else if (target.scenario === "ABANDONED_CART") {
      const stage = await prisma.abandonedCartStage.findFirst({
        where: { id: target.stageId, tenantId: tenant.id },
        select: { templateId: true, stageIndex: true },
      });
      if (!stage) return { success: false, error: "Stade panier abandonné introuvable." };
      targetTemplateId = stage.templateId;
      targetLabel = `Panier abandonné — Stade ${stage.stageIndex}`;
    } else {
      const stage = await prisma.inactiveClientStage.findFirst({
        where: { id: target.stageId, tenantId: tenant.id },
        select: { templateId: true, stageIndex: true },
      });
      if (!stage) return { success: false, error: "Stade relance inactivité introuvable." };
      targetTemplateId = stage.templateId;
      targetLabel = `Relance inactivité — Stade ${stage.stageIndex}`;
    }

    if (targetTemplateId === sourceTemplateId) {
      return {
        success: false,
        error: "Ce modèle est déjà celui du mail auto — rien à copier.",
      };
    }

    const sourceHtml = source.html ?? "";
    if (!sourceHtml.trim()) {
      return { success: false, error: "Le modèle source n'a pas de contenu HTML." };
    }

    // ── Validation du contenu avant copie (mentions légales + tokens scénario) ──
    const missingMarketing = missingRequiredMarketingVariables(sourceHtml);
    if (missingMarketing.length > 0) {
      return {
        success: false,
        error: `Ton modèle « ${source.name} » n'est pas prêt pour être utilisé comme mail auto « ${targetLabel} » : il manque ces variables obligatoires : ${missingMarketing.map((v) => `{${v.token}}`).join(", ")}. Ajoute-les dans le pied de page puis réessaie.`,
        missingVariables: missingMarketing.map((v) => v.token),
      };
    }
    const missingScenario = missingScenarioTokens(sourceHtml, target.scenario);
    if (missingScenario.length > 0) {
      return {
        success: false,
        error: `Ton modèle « ${source.name} » n'a pas les éléments nécessaires pour un mail « ${targetLabel} » — il manque : ${missingScenario.map((s) => s.label).join(" · ")}. Ces tokens sont indispensables pour que le mail affiche les vraies données du client.`,
        missingVariables: missingScenario.map((s) => s.token),
      };
    }

    // ── Copie fichiers : chaque image source vers le dossier du template cible. ──
    // Fait AVANT la transaction BDD pour que la BDD reste cohérente si le FS
    // échoue partiellement (au pire on aura des fichiers orphelins nettoyés
    // plus tard par gcOrphanedTemplateImages sur update du HTML cible).
    const targetDir = newsletterTemplateImageDir(targetTemplateId, tenant.slug);
    // 1) Nettoie les fichiers existants du dossier cible (les nouveaux vont les
    //    remplacer, et l'ancien contenu HTML ne les référencera plus).
    try {
      const oldFiles = await listFiles(targetDir);
      if (oldFiles.length > 0) await deleteFiles(oldFiles);
    } catch (err) {
      logger.error("[assignTemplateToScenario] cleanup target dir", {
        targetTemplateId,
        error: err as Error,
      });
    }
    // 2) Copie chaque image source vers le dossier cible.
    const copiedImages: Array<{
      name: string;
      path: string;
      alt: string;
      sizeBytes: number;
      width: number | null;
      height: number | null;
    }> = [];
    for (const img of source.images) {
      const srcKey = keyFromDbPath(img.path);
      const dstKey = `${targetDir}/${img.name}.webp`;
      const dstDbPath = `/${dstKey}`;
      try {
        await copyFile(srcKey, dstKey);
        copiedImages.push({
          name: img.name,
          path: dstDbPath,
          alt: img.alt,
          sizeBytes: img.sizeBytes,
          width: img.width,
          height: img.height,
        });
      } catch (err) {
        logger.error("[assignTemplateToScenario] copy image", {
          sourceTemplateId,
          targetTemplateId,
          imageName: img.name,
          error: err as Error,
        });
      }
    }

    // ── Transaction : purge images BDD cibles + écrit le nouveau contenu + insère nouvelles images. ──
    await prisma.$transaction(async (tx) => {
      await tx.newsletterTemplateImage.deleteMany({ where: { templateId: targetTemplateId } });
      await tx.newsletterTemplate.update({
        where: { id: targetTemplateId },
        data: {
          format: "html",
          html: sourceHtml,
          subject: source.subject,
        },
      });
      if (copiedImages.length > 0) {
        await tx.newsletterTemplateImage.createMany({
          data: copiedImages.map((img) => ({
            tenantId: tenant.id,
            templateId: targetTemplateId,
            name: img.name,
            path: img.path,
            alt: img.alt,
            sizeBytes: img.sizeBytes,
            width: img.width,
            height: img.height,
          })),
        });
      }
    });

    logger.info("[assignTemplateToScenario] applied", {
      sourceTemplateId,
      targetTemplateId,
      scenario: target.scenario,
      imagesCopied: copiedImages.length,
    });

    revalidatePath("/admin/marketing/mails");
    revalidatePath(`/admin/marketing/mails/newsletter/${targetTemplateId}`);
    if (target.scenario === "ABANDONED_CART") {
      revalidatePath("/admin/marketing/mails/panier-abandonne");
    } else if (target.scenario === "INACTIVE_CLIENT") {
      revalidatePath("/admin/marketing/mails/inactivite");
    }
    return { success: true, targetTemplateId };
  } catch (err) {
    logger.error("[assignTemplateToScenario]", {
      sourceTemplateId,
      target,
      error: err as Error,
    });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Remet le modèle actif d'un scénario à son design par défaut (blocs + sujet).
 * Le nom du modèle n'est PAS modifié — la cliente peut avoir renommé son
 * modèle sans vouloir perdre ce nom.
 */
export async function resetScenarioTemplateToDefault(
  scenario: ScenarioKey,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    if (!SCENARIO_KEYS.includes(scenario)) {
      return { success: false, error: "Scénario inconnu." };
    }
    // Depuis 2026-09-22 : les scénarios ne s'éditent plus qu'en HTML. Le
    // reset applique le défaut HTML — la référence blocs (SCENARIO_DEFAULTS)
    // n'est plus consultée pour les scénarios auto.
    const def = SCENARIO_HTML_DEFAULTS[scenario];
    const existing = await prisma.newsletterTemplate.findFirst({
      where: { tenantId: tenant.id, scenarioKey: scenario },
      select: { id: true },
    });
    if (!existing) {
      await prisma.newsletterTemplate.create({
        data: {
          tenantId: tenant.id,
          name: def.name,
          subject: def.subject,
          format: "html",
          blocks: [],
          html: def.html,
          scenarioKey: scenario,
        },
      });
    } else {
      await prisma.newsletterTemplate.update({
        where: { id: existing.id },
        data: {
          format: "html",
          subject: def.subject,
          html: def.html,
        },
      });
      revalidatePath(`/admin/marketing/mails/${existing.id}`);
    }
    revalidatePath("/admin/marketing/mails");
    return { success: true };
  } catch (err) {
    logger.error("[resetScenarioTemplateToDefault]", { scenario, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Récupère le modèle actif pour un scénario donné (utilisé par l'envoi
 * transactionnel). Crée le défaut si absent (fallback dur — normalement
 * couvert par `ensureDefaultScenarioTemplatesFor`).
 */
export async function getScenarioTemplate(
  tenantId: string,
  scenario: ScenarioKey,
): Promise<NewsletterTemplateFull> {
  await ensureDefaultScenarioTemplatesFor(tenantId);
  const row = await prisma.newsletterTemplate.findFirst({
    where: { tenantId, scenarioKey: scenario },
  });
  if (!row) {
    throw new Error(`Aucun modèle actif pour le scénario ${scenario}.`);
  }
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    format: (row.format === "html" ? "html" : "blocks") as NewsletterTemplateFormat,
    blocks: Array.isArray(row.blocks) ? (row.blocks as unknown as NewsletterBlock[]) : [],
    html: row.html ?? null,
    blocksCount: Array.isArray(row.blocks) ? row.blocks.length : 0,
    images: [],
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    lastSentAt: row.lastSentAt,
    scenarioKey: (row.scenarioKey as ScenarioKey | null) ?? null,
  };
}

export async function createNewsletterTemplate(
  name: string,
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const trimmed = name.trim() || "Modèle sans titre";
    // Depuis 2026-09-22 : tous les nouveaux modèles sont créés en HTML.
    // MANUAL_HTML_DEFAULT contient les 4 tokens marketing obligatoires — la
    // validation passe donc dès la 1ʳᵉ ouverture, la cliente peut enregistrer
    // sans toucher au source.
    const row = await prisma.newsletterTemplate.create({
      data: {
        tenantId: tenant.id,
        name: trimmed,
        subject: "Nouveautés chez nous",
        format: "html",
        blocks: [],
        html: MANUAL_HTML_DEFAULT,
      },
    });
    revalidatePath("/admin/marketing/mails");
    return { success: true, id: row.id };
  } catch (err) {
    logger.error("[createNewsletterTemplate]", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Sauvegarde d'un modèle en format="html" : nom, sujet, source HTML brut.
 * Ne touche PAS au champ `blocks` (rétrocompat si on bascule le format
 * plus tard). Ne touche PAS à la bibliothèque d'images (voir server actions
 * `uploadNewsletterTemplateImage` / `deleteNewsletterTemplateImage`).
 *
 * Validation « mentions légales » : les 4 tokens marketing obligatoires
 * (`{shopName}`, `{shopAddress}`, `{unsubscribeLink}`, `{privacyLink}`)
 * doivent être présents QUELQUE PART dans le HTML — pas de bloc « footer »
 * en HTML libre, on scanne tout le source. Sans ça, le mail viole le RGPD/LCEN.
 */
export async function updateNewsletterTemplateHtml(
  id: string,
  data: { name?: string; subject?: string; html?: string },
): Promise<{ success: true } | { success: false; error: string; missingVariables?: string[] }> {
  try {
    const { tenant } = await requireAdmin();
    const existing = await prisma.newsletterTemplate.findFirst({
      where: { id, tenantId: tenant.id },
      select: { id: true, format: true, html: true, scenarioKey: true },
    });
    if (!existing) return { success: false, error: "Modèle introuvable." };
    if (existing.format !== "html") {
      return { success: false, error: "Ce modèle n'est pas en format HTML." };
    }

    const finalHtml = data.html ?? existing.html ?? "";
    const missing = missingRequiredMarketingVariables(finalHtml);
    if (missing.length > 0) {
      return {
        success: false,
        error: `Ces variables obligatoires manquent dans le HTML : ${missing.map((v) => `{${v.token}}`).join(", ")}. Elles doivent apparaître quelque part dans le mail (typiquement en pied de page) — elles seront remplacées à l'envoi par la vraie info.`,
        missingVariables: missing.map((v) => v.token),
      };
    }

    // Garde-fou scénario : un mail « Panier abandonné » DOIT contenir la
    // boucle `{{#each cart}}` avec {name}, {image}, {qty}, {total} — sinon
    // le client reçoit un mail sans la liste de ses articles oubliés, aucun
    // sens. Idem RESTOCK avec {{#each favorites}} + {name}, {image}, {price},
    // et INACTIVE_CLIENT avec {days}.
    const scenarioKey = existing.scenarioKey as ScenarioKey | null;
    const scenarioMissing = missingScenarioTokens(finalHtml, scenarioKey);
    if (scenarioMissing.length > 0) {
      const labelForScenario: Record<ScenarioKey, string> = {
        ABANDONED_CART: "panier abandonné",
        INACTIVE_CLIENT: "relance inactivité",
        RESTOCK: "retour en stock",
      };
      return {
        success: false,
        error: `Ce mail est lié au scénario « ${labelForScenario[scenarioKey!]} » — il manque : ${scenarioMissing.map((s) => s.label).join(" · ")}. Ces tokens sont indispensables pour que le mail affiche les vraies données du client au moment de l'envoi.`,
        missingVariables: scenarioMissing.map((s) => s.token),
      };
    }

    await prisma.newsletterTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() || "Modèle sans titre" } : {}),
        ...(data.subject !== undefined ? { subject: data.subject.trim() || "Nouveautés" } : {}),
        ...(data.html !== undefined ? { html: data.html } : {}),
      },
    });

    // Nettoyage auto des images orphelines : dès qu'une sauvegarde a lieu, on
    // supprime les fichiers de la bibliothèque qui ne sont plus référencés
    // dans le HTML (ni par token `{{img.name}}` ni par path direct). Choix
    // produit 2026-09-25 : la cliente valide qu'une image retirée de l'éditeur
    // n'a plus vocation à rester sur le disque — évite l'accumulation à long
    // terme. La suppression FS est best-effort (BDD prime).
    await gcOrphanedTemplateImages(id, finalHtml).catch((err) => {
      logger.error("[updateNewsletterTemplateHtml] gc orphans", { id, error: err as Error });
    });

    revalidatePath("/admin/marketing/mails");
    revalidatePath(`/admin/marketing/mails/newsletter/${id}`);
    return { success: true };
  } catch (err) {
    logger.error("[updateNewsletterTemplateHtml]", { id, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Supprime de la bibliothèque du template les images qui ne sont plus
 * référencées dans son HTML (fichier disque + entrée BDD).
 *
 * Ne lit pas `requireAdmin()` — appelé depuis un contexte déjà authentifié.
 * Non-transactionnel : chaque image est traitée indépendamment pour qu'un
 * échec (fichier déjà absent, permission denied) n'empêche pas la suppression
 * des autres. Les échecs FS sont loggés mais non-bloquants — l'entrée BDD est
 * quand même supprimée pour éviter un state incohérent (record → fichier
 * manquant qui empêcherait la ré-utilisation du nom).
 */
async function gcOrphanedTemplateImages(templateId: string, html: string): Promise<void> {
  const images = await prisma.newsletterTemplateImage.findMany({
    where: { templateId },
    select: { id: true, name: true, path: true },
  });
  if (images.length === 0) return;
  const orphans = findOrphanedTemplateImages(html, images);
  if (orphans.length === 0) return;
  for (const orphan of orphans) {
    try {
      await deleteFile(keyFromDbPath(orphan.path));
    } catch (err) {
      logger.error("[gcOrphanedTemplateImages] delete FS", { imageId: orphan.id, error: err as Error });
    }
    try {
      await prisma.newsletterTemplateImage.delete({ where: { id: orphan.id } });
    } catch (err) {
      logger.error("[gcOrphanedTemplateImages] delete BDD", { imageId: orphan.id, error: err as Error });
    }
  }
  logger.info("[gcOrphanedTemplateImages] cleaned", { templateId, removed: orphans.length });
}

export async function updateNewsletterTemplate(
  id: string,
  data: { name?: string; subject?: string; blocks?: NewsletterBlock[] },
): Promise<{ success: true } | { success: false; error: string; missingVariables?: string[] }> {
  try {
    const { tenant } = await requireAdmin();
    const existing = await prisma.newsletterTemplate.findFirst({
      where: { id, tenantId: tenant.id },
      select: { id: true, subject: true, blocks: true },
    });
    if (!existing) return { success: false, error: "Modèle introuvable." };

    // Validation « mentions légales » : tous les modèles enregistrés dans cette
    // table sont marketing (les mails système passent par shared.ts direct).
    // Règle : les 4 variables obligatoires DOIVENT figurer dans le bloc
    // « Pied de page » (bloc `footer`). Le mail ne peut pas être enregistré
    // sans ce bloc, ni si son contenu ne contient pas les 4 variables.
    const finalBlocks = (data.blocks ??
      (Array.isArray(existing.blocks) ? (existing.blocks as unknown as NewsletterBlock[]) : []));
    const footerContent = getFooterContent(finalBlocks);
    if (footerContent === null) {
      return {
        success: false,
        error: "Ajoutez un bloc « Pied de page » — il doit contenir les mentions légales (nom + adresse boutique + désinscription + politique de confidentialité).",
      };
    }
    const missing = missingRequiredMarketingVariables(footerContent);
    if (missing.length > 0) {
      return {
        success: false,
        error: `Ces variables obligatoires manquent dans le pied de page : ${missing.map((v) => `{${v.token}}`).join(", ")}. Elles doivent figurer dans le bloc « Pied de page » — elles seront remplacées à l'envoi par la vraie info.`,
        missingVariables: missing.map((v) => v.token),
      };
    }

    await prisma.newsletterTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() || "Modèle sans titre" } : {}),
        ...(data.subject !== undefined ? { subject: data.subject.trim() || "Nouveautés" } : {}),
        ...(data.blocks !== undefined ? { blocks: data.blocks as unknown as object } : {}),
      },
    });
    revalidatePath("/admin/marketing/mails");
    revalidatePath(`/admin/marketing/mails/${id}`);
    return { success: true };
  } catch (err) {
    logger.error("[updateNewsletterTemplate]", { id, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function deleteNewsletterTemplate(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const existing = await prisma.newsletterTemplate.findFirst({
      where: { id, tenantId: tenant.id },
      select: { id: true, scenarioKey: true },
    });
    if (!existing) return { success: false, error: "Modèle introuvable." };
    if (existing.scenarioKey) {
      return {
        success: false,
        error: "Ce modèle est utilisé pour un mail automatique. Assignez d'abord un autre modèle à ce type de mail pour le libérer.",
      };
    }
    // Défense en profondeur : les templates rattachés à un stade de relance
    // (panier abandonné ou inactivité) ne doivent pas être supprimables ici —
    // la cascade FK effacerait le stade en silence. Passage obligatoire par
    // la page dédiée qui supprime stade + template ensemble proprement.
    const [linkedAbandoned, linkedInactive] = await Promise.all([
      prisma.abandonedCartStage.findFirst({
        where: { templateId: id, tenantId: tenant.id },
        select: { stageIndex: true },
      }),
      prisma.inactiveClientStage.findFirst({
        where: { templateId: id, tenantId: tenant.id },
        select: { stageIndex: true },
      }),
    ]);
    if (linkedAbandoned) {
      return {
        success: false,
        error: `Ce modèle est le Stade ${linkedAbandoned.stageIndex} de la relance panier abandonné. Pour le retirer, ouvre « Relances panier abandonné » et clique sur la poubelle du Stade ${linkedAbandoned.stageIndex}.`,
      };
    }
    if (linkedInactive) {
      return {
        success: false,
        error: `Ce modèle est le Stade ${linkedInactive.stageIndex} de la relance inactivité. Pour le retirer, ouvre « Relances inactivité » et clique sur la poubelle du Stade ${linkedInactive.stageIndex}.`,
      };
    }
    // Cleanup filesystem : les images HTML du modèle vivent dans un dossier
    // dédié qui ne sera plus référencé après suppression. La cascade FK sur
    // NewsletterTemplateImage nettoie la BDD, mais pas les fichiers sur disque.
    const imageDirKey = newsletterTemplateImageDir(id, tenant.slug);
    try {
      const files = await listFiles(imageDirKey);
      if (files.length > 0) await deleteFiles(files);
    } catch (err) {
      // Non bloquant : la BDD passe avant, le dossier restera orphelin au pire.
      logger.error("[deleteNewsletterTemplate] cleanup images", { id, error: err as Error });
    }

    await prisma.newsletterTemplate.delete({ where: { id } });
    revalidatePath("/admin/marketing/mails");
    return { success: true };
  } catch (err) {
    logger.error("[deleteNewsletterTemplate]", { id, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function duplicateNewsletterTemplate(
  id: string,
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const source = await prisma.newsletterTemplate.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!source) return { success: false, error: "Modèle introuvable." };
    // La copie ne reprend PAS la bibliothèque d'images (fresh start — la
    // cliente peut re-uploader ce dont elle a besoin dans le nouveau modèle,
    // évite les collisions de path et le vidage silencieux à la suppression
    // de l'original). Même approche pour scenarioKey (contrainte @@unique).
    const copy = await prisma.newsletterTemplate.create({
      data: {
        tenantId: tenant.id,
        name: `${source.name} (copie)`,
        subject: source.subject,
        format: source.format,
        blocks: source.blocks as unknown as object,
        html: source.html,
        scenarioKey: null,
      },
    });
    revalidatePath("/admin/marketing/mails");
    return { success: true, id: copy.id };
  } catch (err) {
    logger.error("[duplicateNewsletterTemplate]", { id, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Recherche de produits pour l'éditeur (bloc « Grille produits »).
 * Retourne les infos minimales : id, nom, référence, image, prix.
 */
export async function searchProductsForNewsletter(
  query: string,
): Promise<Array<{ id: string; name: string; reference: string; imagePath: string | null; priceCents: number | null }>> {
  const { tenant } = await requireAdmin();
  const q = query.trim();
  const rows = await prisma.product.findMany({
    where: {
      tenantId: tenant.id,
      status: "ONLINE",
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { reference: { contains: q } },
            ],
          }
        : {}),
    },
    take: 30,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      reference: true,
      colors: {
        take: 1,
        orderBy: { isPrimary: "desc" },
        select: {
          unitPrice: true,
          images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
        },
      },
    },
  });
  return rows.map((r) => {
    const variant = r.colors[0];
    return {
      id: r.id,
      name: r.name,
      reference: r.reference,
      imagePath: variant?.images[0]?.path ?? null,
      priceCents: variant ? Math.round(Number(variant.unitPrice) * 100) : null,
    };
  });
}

/**
 * Info minimale d'un client pour alimenter l'aperçu newsletter avec de vraies
 * données. Utilisé par le dropdown « Aperçu pour ce client » dans l'éditeur —
 * la substitution des `{firstName}` etc. se fait alors avec les données réelles
 * du client sélectionné (fallback = 1 client au hasard au chargement).
 */
export interface PreviewClientLite {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  /** Jours d'inactivité (dernière visite) — null si jamais visité. */
  daysInactive: number | null;
  phone: string;
  siret: string | null;
  vatNumber: string | null;
  addressStreet: string | null;
  addressZip: string | null;
  addressCity: string | null;
  addressCountry: string | null;
}

export async function listPreviewClients(): Promise<PreviewClientLite[]> {
  const { tenant } = await requireAdmin();
  const rows = await prisma.user.findMany({
    where: {
      tenantId: tenant.id,
      role: "CLIENT",
      status: "APPROVED",
    },
    orderBy: [{ company: "asc" }, { lastName: "asc" }],
    select: {
      id: true, firstName: true, lastName: true, company: true, email: true,
      phone: true, siret: true, vatNumber: true,
      addressStreet: true, addressZip: true, addressCity: true, addressCountry: true,
      lastSeenAt: true,
    },
    // Cap raisonnable : 200 clients suffisent pour un dropdown, éviter un
    // gros payload si la base contient plusieurs milliers de clients.
    take: 200,
  });
  const now = Date.now();
  return rows.map(({ lastSeenAt, ...rest }) => ({
    ...rest,
    daysInactive: lastSeenAt
      ? Math.floor((now - lastSeenAt.getTime()) / 86400_000)
      : null,
  }));
}

/**
 * Contenu du panier en cours d'un client, formaté pour l'aperçu du bloc
 * « Panier du client » dans l'éditeur newsletter. Reflète ce que verra le
 * client dans le mail (filtre stock/statut appliqué comme dans le worker
 * de relance panier abandonné).
 */
export interface PreviewCartItem {
  productName: string;
  colorName: string | null;
  quantity: number;
  totalCents: number;
  imagePath: string | null;
}
export interface PreviewCart {
  items: PreviewCartItem[];
  totalCents: number;
}

export async function getClientCartPreview(userId: string): Promise<PreviewCart> {
  const { tenant } = await requireAdmin();
  const cart = await prisma.cart.findFirst({
    where: { userId, user: { tenantId: tenant.id } },
    select: {
      items: {
        select: {
          quantity: true,
          variant: {
            select: {
              unitPrice: true,
              stock: true,
              saleType: true,
              packQuantity: true,
              color: { select: { name: true } },
              product: { select: { name: true, status: true } },
              images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
            },
          },
        },
      },
    },
  });
  const validItems = (cart?.items ?? []).filter((it) => {
    if (it.variant.product.status !== "ONLINE") return false;
    const effective =
      it.variant.saleType === "PACK" && it.variant.packQuantity
        ? Math.floor(it.variant.stock / it.variant.packQuantity)
        : it.variant.stock;
    return effective > 0;
  });
  const items: PreviewCartItem[] = validItems.map((it) => ({
    productName: it.variant.product.name,
    colorName: it.variant.color?.name ?? null,
    quantity: it.quantity,
    totalCents: Math.round(Number(it.variant.unitPrice) * 100) * it.quantity,
    imagePath: it.variant.images[0]?.path ?? null,
  }));
  const totalCents = items.reduce((s, i) => s + i.totalCents, 0);
  return { items, totalCents };
}
