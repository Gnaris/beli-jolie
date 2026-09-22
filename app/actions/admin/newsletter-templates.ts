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
import { missingRequiredMarketingVariables } from "@/lib/mail-merge-variables";
import { deleteFiles, keyFromDbPath, listFiles, newsletterTemplateImageDir } from "@/lib/storage";
import {
  SCENARIO_KEYS,
  type ScenarioKey,
} from "@/lib/mail-scenario-defaults";
import { MANUAL_HTML_DEFAULT, SCENARIO_HTML_DEFAULTS } from "@/lib/newsletter-html-defaults";

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
 * Seed lazy : crée les 3 modèles par défaut s'ils n'existent pas encore pour
 * le tenant. Idempotent (contrainte @@unique[tenantId, scenarioKey] côté DB).
 */
async function ensureDefaultScenarioTemplatesFor(tenantId: string): Promise<void> {
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
 * Assigne un modèle existant à un scénario transactionnel. Transactionnel :
 * l'éventuel modèle actuellement lié à ce scénario perd son lien (redevient
 * un modèle libre, donc supprimable).
 */
export async function assignTemplateToScenario(
  templateId: string,
  scenario: ScenarioKey,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    if (!SCENARIO_KEYS.includes(scenario)) {
      return { success: false, error: "Scénario inconnu." };
    }
    const target = await prisma.newsletterTemplate.findFirst({
      where: { id: templateId, tenantId: tenant.id },
      select: { id: true, scenarioKey: true },
    });
    if (!target) return { success: false, error: "Modèle introuvable." };
    if (target.scenarioKey === scenario) return { success: true };

    await prisma.$transaction(async (tx) => {
      // Détache l'ancien titulaire du scénario (s'il existe et n'est pas le target).
      await tx.newsletterTemplate.updateMany({
        where: { tenantId: tenant.id, scenarioKey: scenario, id: { not: templateId } },
        data: { scenarioKey: null },
      });
      // Attache le nouveau (peut avoir été lié à un autre scénario avant → on écrase).
      await tx.newsletterTemplate.update({
        where: { id: templateId },
        data: { scenarioKey: scenario },
      });
    });
    revalidatePath("/admin/marketing/mails");
    return { success: true };
  } catch (err) {
    logger.error("[assignTemplateToScenario]", { templateId, scenario, error: err as Error });
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
      select: { id: true, format: true, html: true },
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

    await prisma.newsletterTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() || "Modèle sans titre" } : {}),
        ...(data.subject !== undefined ? { subject: data.subject.trim() || "Nouveautés" } : {}),
        ...(data.html !== undefined ? { html: data.html } : {}),
      },
    });
    revalidatePath("/admin/marketing/mails");
    revalidatePath(`/admin/marketing/mails/newsletter/${id}`);
    return { success: true };
  } catch (err) {
    logger.error("[updateNewsletterTemplateHtml]", { id, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
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
