"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { whatsAppTemplateSchema } from "@/lib/whatsapp-template-schema";

const CACHE_TAG = "whatsapp-templates";

export interface WhatsAppTemplateDTO {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  sendCount: number;
}

/**
 * Liste tous les modèles du tenant courant + leur nombre d'envois. Non cachée
 * pour rester ultra-fraîche (une création/édition doit apparaître tout de
 * suite dans la liste et dans le dropdown au clic WhatsApp).
 */
export async function listWhatsAppTemplates(): Promise<WhatsAppTemplateDTO[]> {
  await requireAdmin();
  const rows = await prisma.whatsAppTemplate.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { sends: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    updatedAt: r.updatedAt.toISOString(),
    sendCount: r._count.sends,
  }));
}

export async function createWhatsAppTemplate(
  input: unknown,
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const parsed = whatsAppTemplateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
    }
    try {
      const row = await prisma.whatsAppTemplate.create({
        data: { tenantId: tenant.id, title: parsed.data.title, body: parsed.data.body },
        select: { id: true },
      });
      revalidateTag(CACHE_TAG, "default");
      revalidatePath("/admin/marketing/whatsapp");
      return { success: true, id: row.id };
    } catch (dbErr) {
      // P2002 : violation du @@unique([tenantId, title])
      if ((dbErr as { code?: string }).code === "P2002") {
        return { success: false, error: "Un modèle porte déjà ce titre — choisissez-en un autre." };
      }
      throw dbErr;
    }
  } catch (e) {
    logger.error("[createWhatsAppTemplate]", { error: e as Error });
    return { success: false, error: (e as Error).message };
  }
}

export async function updateWhatsAppTemplate(
  id: string,
  input: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const parsed = whatsAppTemplateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
    }
    try {
      await prisma.whatsAppTemplate.update({
        where: { id },
        data: { title: parsed.data.title, body: parsed.data.body },
      });
      revalidateTag(CACHE_TAG, "default");
      revalidatePath("/admin/marketing/whatsapp");
      return { success: true };
    } catch (dbErr) {
      if ((dbErr as { code?: string }).code === "P2002") {
        return { success: false, error: "Un modèle porte déjà ce titre — choisissez-en un autre." };
      }
      if ((dbErr as { code?: string }).code === "P2025") {
        return { success: false, error: "Ce modèle n'existe plus." };
      }
      throw dbErr;
    }
  } catch (e) {
    logger.error("[updateWhatsAppTemplate]", { error: e as Error });
    return { success: false, error: (e as Error).message };
  }
}

export async function deleteWhatsAppTemplate(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    // Note : les WhatsAppSend liés gardent leur ligne (templateId → null via
    // onDelete: SetNull). L'historique reste consultable même après suppression.
    await prisma.whatsAppTemplate.delete({ where: { id } });
    revalidateTag(CACHE_TAG, "default");
    revalidatePath("/admin/marketing/whatsapp");
    return { success: true };
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") {
      return { success: false, error: "Ce modèle n'existe plus." };
    }
    logger.error("[deleteWhatsAppTemplate]", { error: e as Error });
    return { success: false, error: (e as Error).message };
  }
}
