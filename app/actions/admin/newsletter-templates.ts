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
import {
  SCENARIO_DEFAULTS,
  SCENARIO_KEYS,
  type ScenarioKey,
} from "@/lib/mail-scenario-defaults";

export interface NewsletterTemplateSummary {
  id: string;
  name: string;
  subject: string;
  blocksCount: number;
  updatedAt: Date;
  createdAt: Date;
  lastSentAt: Date | null;
  scenarioKey: ScenarioKey | null;
}

export interface NewsletterTemplateFull extends NewsletterTemplateSummary {
  blocks: NewsletterBlock[];
}

export async function listNewsletterTemplates(): Promise<NewsletterTemplateSummary[]> {
  const { tenant } = await requireAdmin();
  await ensureDefaultScenarioTemplatesFor(tenant.id);
  // Les templates rattachés à un Stade ≥ 2 de la relance panier abandonné ne
  // s'éditent QUE depuis /admin/marketing/mails/panier-abandonne. On les
  // exclut de cette liste pour éviter que la cliente les supprime par erreur
  // (la suppression du template casserait le stade par cascade FK). Le
  // Stade 1 (scenarioKey=ABANDONED_CART) reste visible dans la section
  // « Mails automatiques » comme les autres scénarios.
  const abandonedStageTemplates = await prisma.abandonedCartStage.findMany({
    where: { tenantId: tenant.id, stageIndex: { gte: 2 } },
    select: { templateId: true },
  });
  const hiddenIds = abandonedStageTemplates.map((s) => s.templateId);
  const rows = await prisma.newsletterTemplate.findMany({
    where: {
      tenantId: tenant.id,
      ...(hiddenIds.length > 0 ? { id: { notIn: hiddenIds } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, name: true, subject: true, blocks: true, updatedAt: true, createdAt: true, lastSentAt: true, scenarioKey: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    subject: r.subject,
    blocksCount: Array.isArray(r.blocks) ? r.blocks.length : 0,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
    lastSentAt: r.lastSentAt,
    scenarioKey: (r.scenarioKey as ScenarioKey | null) ?? null,
  }));
}

export async function getNewsletterTemplate(id: string): Promise<NewsletterTemplateFull | null> {
  const { tenant } = await requireAdmin();
  const row = await prisma.newsletterTemplate.findFirst({
    where: { id, tenantId: tenant.id },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    blocks: Array.isArray(row.blocks) ? (row.blocks as unknown as NewsletterBlock[]) : [],
    blocksCount: Array.isArray(row.blocks) ? row.blocks.length : 0,
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
  const existing = await prisma.newsletterTemplate.findMany({
    where: { tenantId, scenarioKey: { in: [...SCENARIO_KEYS] } },
    select: { scenarioKey: true },
  });
  const already = new Set(existing.map((e) => e.scenarioKey).filter(Boolean) as string[]);
  const missing = SCENARIO_KEYS.filter((k) => !already.has(k));
  if (missing.length === 0) return;
  for (const scenario of missing) {
    const def = SCENARIO_DEFAULTS[scenario];
    try {
      await prisma.newsletterTemplate.create({
        data: {
          tenantId,
          name: def.name,
          subject: def.subject,
          blocks: def.blocks as unknown as object,
          scenarioKey: scenario,
        },
      });
    } catch (err) {
      // Ignore les doublons dûs à une race entre 2 accès parallèles.
      logger.error("[ensureDefaultScenarioTemplates] seed skip", { tenantId, scenario, error: err as Error });
    }
  }
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
    const def = SCENARIO_DEFAULTS[scenario];
    const existing = await prisma.newsletterTemplate.findFirst({
      where: { tenantId: tenant.id, scenarioKey: scenario },
      select: { id: true },
    });
    if (!existing) {
      // Aucun modèle lié : on crée le défaut de zéro.
      await prisma.newsletterTemplate.create({
        data: {
          tenantId: tenant.id,
          name: def.name,
          subject: def.subject,
          blocks: def.blocks as unknown as object,
          scenarioKey: scenario,
        },
      });
    } else {
      await prisma.newsletterTemplate.update({
        where: { id: existing.id },
        data: {
          subject: def.subject,
          blocks: def.blocks as unknown as object,
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
    blocks: Array.isArray(row.blocks) ? (row.blocks as unknown as NewsletterBlock[]) : [],
    blocksCount: Array.isArray(row.blocks) ? row.blocks.length : 0,
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
    const row = await prisma.newsletterTemplate.create({
      data: {
        tenantId: tenant.id,
        name: trimmed,
        subject: "Nouveautés chez nous",
        blocks: [],
      },
    });
    revalidatePath("/admin/marketing/mails");
    return { success: true, id: row.id };
  } catch (err) {
    logger.error("[createNewsletterTemplate]", { error: err as Error });
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
    // Défense en profondeur : les templates rattachés à un Stade ≥ 2 de la
    // relance panier abandonné ne doivent pas être supprimables ici — la
    // cascade FK effacerait le stade en silence. Passage obligatoire par
    // la page dédiée qui supprime stade + template ensemble proprement.
    const linkedStage = await prisma.abandonedCartStage.findFirst({
      where: { templateId: id, tenantId: tenant.id },
      select: { stageIndex: true },
    });
    if (linkedStage) {
      return {
        success: false,
        error: `Ce modèle est le Stade ${linkedStage.stageIndex} de la relance panier abandonné. Pour le retirer, ouvre « Relances panier abandonné » et clique sur la poubelle du Stade ${linkedStage.stageIndex}.`,
      };
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
    const copy = await prisma.newsletterTemplate.create({
      data: {
        tenantId: tenant.id,
        name: `${source.name} (copie)`,
        subject: source.subject,
        blocks: source.blocks as unknown as object,
        // La copie ne reprend PAS le scenarioKey : un scénario ne peut avoir
        // qu'un seul modèle actif (contrainte @@unique), et de toute façon
        // dupliquer sert typiquement à créer une variante à ajuster.
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
    },
    // Cap raisonnable : 200 clients suffisent pour un dropdown, éviter un
    // gros payload si la base contient plusieurs milliers de clients.
    take: 200,
  });
  return rows;
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
