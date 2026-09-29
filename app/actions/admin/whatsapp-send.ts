"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  containsEmoji,
  renderWhatsAppMessage,
  WHATSAPP_NO_EMOJI_ERROR,
} from "@/lib/whatsapp-message";
import { loadWhatsAppMergeContext } from "@/lib/whatsapp-message-server";

interface SendInput {
  /** Modèle sélectionné, ou null pour un simple log de clic sans texte. */
  templateId: string | null;
  /** Client destinataire (compte inscrit). null si envoi à un contact hors compte. */
  userId: string | null;
  /** Numéro de téléphone brut (tel qu'affiché) — sert seulement à l'historique. */
  phone: string;
}

interface SendResult {
  success: true;
  /** Body après substitution des variables. "" si templateId null. */
  renderedBody: string;
}

interface SendError {
  success: false;
  error: string;
}

/**
 * Rend le body d'un modèle avec les variables client/boutique/admin, log
 * l'envoi dans WhatsAppSend, et retourne le body au client pour qu'il ouvre
 * wa.me?text=… lui-même.
 *
 * Le log est best-effort — un échec de persistance ne doit pas bloquer
 * l'ouverture WhatsApp côté client (on privilégie l'usage). On retourne
 * quand même success:true avec un renderedBody rendu à la volée pour que
 * la cliente puisse envoyer, et on logue l'erreur côté serveur.
 */
export async function sendWhatsAppTemplate(input: SendInput): Promise<SendResult | SendError> {
  try {
    const { session, tenant } = await requireAdmin();
    const adminId = session.user.id;

    const ctx = await loadWhatsAppMergeContext({ userId: input.userId, adminId });

    let renderedBody = "";
    let templateExists = false;
    if (input.templateId) {
      const template = await prisma.whatsAppTemplate.findUnique({
        where: { id: input.templateId },
        select: { title: true, body: true },
      });
      if (template) {
        // Filet arrière : même si un modèle historique contient encore des
        // emojis (BDD antérieure à la règle), on refuse l'envoi. Le rendu
        // WhatsApp casserait leur encodage via `?text=`.
        if (containsEmoji(template.title) || containsEmoji(template.body)) {
          return { success: false, error: WHATSAPP_NO_EMOJI_ERROR };
        }
        templateExists = true;
        renderedBody = renderWhatsAppMessage(template.body, ctx);
      }
    }

    try {
      await prisma.whatsAppSend.create({
        data: {
          tenantId: tenant.id,
          templateId: templateExists ? input.templateId : null,
          userId: input.userId,
          adminId,
          phoneNumber: input.phone.slice(0, 30),
          renderedBody,
        },
      });
    } catch (logErr) {
      // Best effort : on ne bloque pas l'ouverture WhatsApp si le log échoue.
      logger.warn("[sendWhatsAppTemplate] log échoué mais rendu OK", { error: logErr as Error });
    }

    return { success: true, renderedBody };
  } catch (e) {
    logger.error("[sendWhatsAppTemplate]", { error: e as Error });
    return { success: false, error: (e as Error).message };
  }
}
