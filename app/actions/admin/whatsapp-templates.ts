"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { whatsAppTemplateSchema } from "@/lib/whatsapp-template-schema";
import { translateWhatsAppBodyToEnglish } from "@/lib/whatsapp-translate";
import { containsEmoji, WHATSAPP_NO_EMOJI_ERROR } from "@/lib/whatsapp-message";

const CACHE_TAG = "whatsapp-templates";

export interface WhatsAppTemplateDTO {
  id: string;
  title: string;
  body: string;
  bodyEn: string;
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
    bodyEn: r.bodyEn ?? "",
    updatedAt: r.updatedAt.toISOString(),
    sendCount: r._count.sends,
  }));
}

/**
 * Choisit la valeur à persister dans `bodyEn` :
 *   - si la cliente a saisi/collé une version anglaise → on la garde telle
 *     quelle (sa main est prioritaire) ;
 *   - sinon on tente une auto-traduction serveur.
 *
 * Renvoie `{ bodyEn: string | null, translationFailed: boolean }`. Le flag
 * remonte à l'appelant pour informer via toast (« Français enregistré,
 * traduction anglaise indisponible »).
 */
async function resolveBodyEnForSave(input: {
  bodyFr: string;
  bodyEnEdited: string;
}): Promise<{ bodyEn: string | null; translationFailed: boolean }> {
  const manual = input.bodyEnEdited.trim();
  if (manual.length > 0) {
    return { bodyEn: manual, translationFailed: false };
  }
  const translated = await translateWhatsAppBodyToEnglish(input.bodyFr);
  if (translated === null) {
    return { bodyEn: null, translationFailed: true };
  }
  return { bodyEn: translated, translationFailed: false };
}

export async function createWhatsAppTemplate(
  input: unknown,
): Promise<
  | { success: true; id: string; translationFailed: boolean }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    const parsed = whatsAppTemplateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
    }
    const { bodyEn, translationFailed } = await resolveBodyEnForSave({
      bodyFr: parsed.data.body,
      bodyEnEdited: parsed.data.bodyEn ?? "",
    });
    try {
      const row = await prisma.whatsAppTemplate.create({
        data: {
          tenantId: tenant.id,
          title: parsed.data.title,
          body: parsed.data.body,
          bodyEn,
        },
        select: { id: true },
      });
      revalidateTag(CACHE_TAG, "default");
      revalidatePath("/admin/marketing/whatsapp");
      return { success: true, id: row.id, translationFailed };
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
): Promise<
  | { success: true; translationFailed: boolean }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const parsed = whatsAppTemplateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
    }
    const { bodyEn, translationFailed } = await resolveBodyEnForSave({
      bodyFr: parsed.data.body,
      bodyEnEdited: parsed.data.bodyEn ?? "",
    });
    try {
      await prisma.whatsAppTemplate.update({
        where: { id },
        data: {
          title: parsed.data.title,
          body: parsed.data.body,
          bodyEn,
        },
      });
      revalidateTag(CACHE_TAG, "default");
      revalidatePath("/admin/marketing/whatsapp");
      return { success: true, translationFailed };
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

/**
 * Traduit à la volée le corps FR d'un modèle (bouton « Traduire » du drawer).
 * Ne persiste rien — remplit juste le champ EN dans l'éditeur. La sauvegarde
 * finale passe toujours par create/update.
 */
export async function translateWhatsAppTemplateBody(
  bodyFr: string,
): Promise<
  | { success: true; bodyEn: string }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    if (typeof bodyFr !== "string" || bodyFr.trim().length === 0) {
      return { success: false, error: "Écris d'abord le message en français." };
    }
    // Filet : refuse même en manuel si le FR contient des emojis (WhatsApp
    // casserait l'encodage à l'envoi via `?text=`).
    if (containsEmoji(bodyFr)) {
      return { success: false, error: WHATSAPP_NO_EMOJI_ERROR };
    }
    const translated = await translateWhatsAppBodyToEnglish(bodyFr);
    if (translated === null) {
      return {
        success: false,
        error: "Traduction indisponible pour le moment — réessaye dans un instant, ou écris toi-même la version anglaise.",
      };
    }
    return { success: true, bodyEn: translated };
  } catch (e) {
    logger.error("[translateWhatsAppTemplateBody]", { error: e as Error });
    return { success: false, error: (e as Error).message };
  }
}
