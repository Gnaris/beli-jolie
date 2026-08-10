"use server";

/**
 * CRUD des modèles de newsletter réutilisables.
 * La cliente compose plusieurs modèles à l'avance, puis choisit lequel
 * envoyer au moment de l'envoi groupé (voir sendNewsletterToUsers).
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { NewsletterBlock } from "@/lib/newsletter-blocks";

export interface NewsletterTemplateSummary {
  id: string;
  name: string;
  subject: string;
  blocksCount: number;
  updatedAt: Date;
  createdAt: Date;
  lastSentAt: Date | null;
}

export interface NewsletterTemplateFull extends NewsletterTemplateSummary {
  blocks: NewsletterBlock[];
}

export async function listNewsletterTemplates(): Promise<NewsletterTemplateSummary[]> {
  const { tenant } = await requireAdmin();
  const rows = await prisma.newsletterTemplate.findMany({
    where: { tenantId: tenant.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, name: true, subject: true, blocks: true, updatedAt: true, createdAt: true, lastSentAt: true,
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
    revalidatePath("/admin/utilisateurs/newsletters");
    return { success: true, id: row.id };
  } catch (err) {
    logger.error("[createNewsletterTemplate]", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function updateNewsletterTemplate(
  id: string,
  data: { name?: string; subject?: string; blocks?: NewsletterBlock[] },
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const existing = await prisma.newsletterTemplate.findFirst({
      where: { id, tenantId: tenant.id },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Modèle introuvable." };

    await prisma.newsletterTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() || "Modèle sans titre" } : {}),
        ...(data.subject !== undefined ? { subject: data.subject.trim() || "Nouveautés" } : {}),
        ...(data.blocks !== undefined ? { blocks: data.blocks as unknown as object } : {}),
      },
    });
    revalidatePath("/admin/utilisateurs/newsletters");
    revalidatePath(`/admin/utilisateurs/newsletters/${id}`);
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
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Modèle introuvable." };
    await prisma.newsletterTemplate.delete({ where: { id } });
    revalidatePath("/admin/utilisateurs/newsletters");
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
      },
    });
    revalidatePath("/admin/utilisateurs/newsletters");
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
