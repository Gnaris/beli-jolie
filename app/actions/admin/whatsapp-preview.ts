"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import type { WhatsAppMergeContext } from "@/lib/whatsapp-message";
import { loadWhatsAppMergeContext } from "@/lib/whatsapp-message-server";

/**
 * Charge le contexte de rendu pour un client donné — utilisé par l'aperçu
 * en direct dans le drawer d'édition d'un modèle WhatsApp. Wrapper minimal
 * autour de `loadWhatsAppMergeContext` qui expose la fonction server-only à
 * un client component via server action.
 */
export async function getWhatsAppPreviewContext(
  userId: string | null,
): Promise<{ success: true; context: WhatsAppMergeContext } | { success: false; error: string }> {
  try {
    const { session } = await requireAdmin();
    const context = await loadWhatsAppMergeContext({ userId, adminId: session.user.id });
    return { success: true, context };
  } catch (e) {
    logger.error("[getWhatsAppPreviewContext]", { error: e as Error });
    return { success: false, error: (e as Error).message };
  }
}
