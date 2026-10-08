"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { whatsAppTemplateSchema } from "@/lib/whatsapp-template-schema";
import {
  translateWhatsAppBody,
  type WhatsAppTargetLocale,
} from "@/lib/whatsapp-translate";
import { containsEmoji, WHATSAPP_NO_EMOJI_ERROR } from "@/lib/whatsapp-message";

const CACHE_TAG = "whatsapp-templates";

export interface WhatsAppTemplateDTO {
  id: string;
  title: string;
  body: string;
  bodyEn: string;
  bodyDe: string;
  bodyIt: string;
  bodyEs: string;
  updatedAt: string;
  sendCount: number;
}

/** Rapport de save : liste des locales dont l'auto-trad a échoué. */
export interface SaveTranslationReport {
  translationFailedLocales: WhatsAppTargetLocale[];
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
    bodyDe: r.bodyDe ?? "",
    bodyIt: r.bodyIt ?? "",
    bodyEs: r.bodyEs ?? "",
    updatedAt: r.updatedAt.toISOString(),
    sendCount: r._count.sends,
  }));
}

const TARGET_LOCALES: WhatsAppTargetLocale[] = ["en", "de", "it", "es"];

/**
 * Résout la valeur à persister pour chaque locale cible :
 *   - si la cliente a saisi/collé une version → on la garde telle quelle
 *     (sa main est prioritaire) ;
 *   - sinon on tente une auto-traduction serveur ;
 *   - échec de trad → on garde `null` et on signale la locale dans le rapport
 *     pour que l'UI affiche un toast.
 *
 * Les 4 traductions se lancent en parallèle (indépendantes).
 */
async function resolveLocalizedBodiesForSave(input: {
  bodyFr: string;
  edited: Record<WhatsAppTargetLocale, string>;
}): Promise<{
  bodies: Record<WhatsAppTargetLocale, string | null>;
  report: SaveTranslationReport;
}> {
  const bodies: Record<WhatsAppTargetLocale, string | null> = {
    en: null,
    de: null,
    it: null,
    es: null,
  };
  const failed: WhatsAppTargetLocale[] = [];

  await Promise.all(
    TARGET_LOCALES.map(async (locale) => {
      const manual = input.edited[locale]?.trim() ?? "";
      if (manual.length > 0) {
        bodies[locale] = manual;
        return;
      }
      const translated = await translateWhatsAppBody(input.bodyFr, locale);
      if (translated === null) {
        bodies[locale] = null;
        failed.push(locale);
      } else {
        bodies[locale] = translated;
      }
    }),
  );

  return { bodies, report: { translationFailedLocales: failed } };
}

export async function createWhatsAppTemplate(
  input: unknown,
): Promise<
  | { success: true; id: string; report: SaveTranslationReport }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    const parsed = whatsAppTemplateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
    }
    const { bodies, report } = await resolveLocalizedBodiesForSave({
      bodyFr: parsed.data.body,
      edited: {
        en: parsed.data.bodyEn ?? "",
        de: parsed.data.bodyDe ?? "",
        it: parsed.data.bodyIt ?? "",
        es: parsed.data.bodyEs ?? "",
      },
    });
    try {
      const row = await prisma.whatsAppTemplate.create({
        data: {
          tenantId: tenant.id,
          title: parsed.data.title,
          body: parsed.data.body,
          bodyEn: bodies.en,
          bodyDe: bodies.de,
          bodyIt: bodies.it,
          bodyEs: bodies.es,
        },
        select: { id: true },
      });
      revalidateTag(CACHE_TAG, "default");
      revalidatePath("/admin/marketing/whatsapp");
      return { success: true, id: row.id, report };
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
  | { success: true; report: SaveTranslationReport }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const parsed = whatsAppTemplateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
    }
    const { bodies, report } = await resolveLocalizedBodiesForSave({
      bodyFr: parsed.data.body,
      edited: {
        en: parsed.data.bodyEn ?? "",
        de: parsed.data.bodyDe ?? "",
        it: parsed.data.bodyIt ?? "",
        es: parsed.data.bodyEs ?? "",
      },
    });
    try {
      await prisma.whatsAppTemplate.update({
        where: { id },
        data: {
          title: parsed.data.title,
          body: parsed.data.body,
          bodyEn: bodies.en,
          bodyDe: bodies.de,
          bodyIt: bodies.it,
          bodyEs: bodies.es,
        },
      });
      revalidateTag(CACHE_TAG, "default");
      revalidatePath("/admin/marketing/whatsapp");
      return { success: true, report };
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
 * Traduit à la volée le corps FR d'un modèle vers une langue cible (bouton
 * « Traduire » du drawer). Ne persiste rien — remplit juste le champ cible
 * dans l'éditeur. La sauvegarde finale passe toujours par create/update.
 */
export async function translateWhatsAppTemplateBody(
  bodyFr: string,
  targetLocale: WhatsAppTargetLocale = "en",
): Promise<
  | { success: true; body: string; targetLocale: WhatsAppTargetLocale }
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
    const translated = await translateWhatsAppBody(bodyFr, targetLocale);
    if (translated === null) {
      return {
        success: false,
        error: "Traduction indisponible pour le moment — réessaye dans un instant, ou écris toi-même cette version.",
      };
    }
    return { success: true, body: translated, targetLocale };
  } catch (e) {
    logger.error("[translateWhatsAppTemplateBody]", { error: e as Error });
    return { success: false, error: (e as Error).message };
  }
}
