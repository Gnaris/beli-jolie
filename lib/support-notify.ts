/**
 * Système de notification différée Service Client (chat flottant + réclamations).
 *
 * Règles métier (décidées avec la cliente 2026-09-21) :
 *   - Le bouton manuel « Notifier le client » est supprimé.
 *   - Chaque réponse admin décide seule si un mail part au client :
 *       • client hors ligne (heartbeat > 60 s)         → mail IMMÉDIAT
 *       • client en ligne mais pas sur cette conv      → mail DIFFÉRÉ à + 5 min
 *       • client en ligne ET en train de lire la conv  → PAS de mail (il voit)
 *   - Chaque nouveau message admin dans la même conv RESET le timer :
 *     on annule tous les jobs PENDING précédents et on repose un nouveau
 *     dueAt = now + 5 min.
 *   - **Anti-spam 20 min** : un mail immédiat n'est envoyé que si le
 *     précédent mail sur cette conv date de plus de 20 min OU si le client
 *     a lu le/les messages admin entre temps. Sinon on considère qu'un
 *     mail suffit et on skip (l'admin peut envoyer 10 messages en 3 min,
 *     le client ne reçoit qu'un seul mail). Dès que le client a lu et
 *     re-quitté, un nouveau mail est autorisé immédiatement (il est à jour).
 *   - Quand le client lit → cancelPendingNotifications() (à câbler dans
 *     markAsRead / markMessagesReadByClient).
 *   - Le contenu du mail est volontairement générique (« Un admin vous a
 *     répondu à votre demande… ») pour forcer le client à revenir sur le site.
 *
 * Worker : `lib/support-email-worker.ts` scanne toutes les 30 s.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isOnline } from "@/lib/online-status";
import {
  sendGenericSupportReplyEmail,
  type SupportReplyContext,
} from "@/lib/notifications";

/** Fenêtre du chronomètre : 5 min entre la réponse admin et l'envoi du mail. */
export const SUPPORT_NOTIFY_DELAY_MS = 5 * 60 * 1000;

/**
 * Cooldown anti-spam entre 2 mails « nouvelle réponse » sur une même
 * conversation. Passé ce délai, ou si le client a lu entre temps,
 * un nouveau mail est autorisé.
 */
export const SUPPORT_IMMEDIATE_COOLDOWN_MS = 20 * 60 * 1000;

export interface ScheduleReplyNotificationInput {
  conversationId: string;
  messageId: string;
  /** id du destinataire (client). */
  userId: string;
  context: SupportReplyContext;
  /** Si context === "claim", id de la réclamation liée. */
  claimId?: string;
}

/**
 * True si on est autorisé à envoyer un mail « nouvelle réponse » MAINTENANT
 * sur cette conversation. False = un mail récent a déjà été envoyé et le
 * client ne l'a toujours pas lu → skip.
 *
 * La règle regarde le champ `Conversation.lastSupportEmailAt` :
 *   - Absent OU > 20 min ago → OK
 *   - < 20 min ago mais un message admin a été lu (readAt) depuis → OK
 *     (le client est à jour, un nouveau mail est légitime)
 *   - < 20 min ago sans lecture → SKIP
 */
export async function canSendImmediateSupportEmail(
  conversationId: string,
): Promise<boolean> {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId },
    select: { lastSupportEmailAt: true },
  });
  if (!conv?.lastSupportEmailAt) return true;

  const elapsed = Date.now() - conv.lastSupportEmailAt.getTime();
  if (elapsed >= SUPPORT_IMMEDIATE_COOLDOWN_MS) return true;

  const readSince = await prisma.message.findFirst({
    where: {
      conversationId,
      senderRole: "ADMIN",
      readAt: { gt: conv.lastSupportEmailAt },
    },
    select: { id: true },
  });
  return Boolean(readSince);
}

/**
 * Envoie le mail « nouvelle réponse » côté client + poste le timestamp
 * `lastSupportEmailAt` sur la conversation pour armer le cooldown 20 min.
 * Ne fait rien (retourne false) si le cooldown est actif ET que le client
 * n'a pas lu depuis le dernier envoi.
 *
 * Utilisé à la fois par la branche « hors ligne » de `scheduleReplyNotification`
 * et par le worker qui traite les jobs `PendingSupportEmail`.
 */
export async function sendSupportReplyEmailNow(params: {
  conversationId: string;
  clientEmail: string;
  clientName: string;
  context: SupportReplyContext;
  claimId?: string;
}): Promise<boolean> {
  const { conversationId, clientEmail, clientName, context, claimId } = params;

  const allowed = await canSendImmediateSupportEmail(conversationId);
  if (!allowed) {
    logger.info(
      `[support-notify] Mail skip (anti-spam 20 min actif) conv=${conversationId}`,
    );
    return false;
  }

  await sendGenericSupportReplyEmail({
    clientEmail,
    clientName,
    conversationId,
    context,
    claimId,
  });

  // Toujours poser lastSupportEmailAt APRÈS envoi effectif — sinon un échec
  // bloquerait toute future notif via le cooldown.
  await prisma.conversation.updateMany({
    where: { id: conversationId },
    data: { lastSupportEmailAt: new Date() },
  });
  return true;
}

/**
 * Décide quoi faire du message admin fraîchement envoyé et agit :
 *  - annule les jobs PENDING précédents de la conversation ;
 *  - envoie le mail tout de suite, planifie un job différé, ou rien.
 *
 * Fire-and-forget côté caller (server action) : cette fonction ne throw
 * pas, tout échec est loggé.
 */
export async function scheduleReplyNotification(
  input: ScheduleReplyNotificationInput,
): Promise<void> {
  const { conversationId, messageId, userId, context, claimId } = input;

  try {
    // 1) Reset : annuler tout job PENDING encore en attente sur cette conv.
    //    Chaque nouveau message admin repart d'un timer neuf.
    await prisma.pendingSupportEmail.updateMany({
      where: { conversationId, status: "PENDING" },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    // 2) Décision basée sur la présence.
    const user = await prisma.user.findFirst({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastSeenAt: true,
        activeConversationId: true,
      },
    });
    if (!user || !user.email) {
      logger.warn("[support-notify] User introuvable ou sans email", { userId });
      return;
    }

    const online = isOnline(user.lastSeenAt);
    const onThisConversation = online && user.activeConversationId === conversationId;

    if (onThisConversation) {
      // Il est en train de lire → rien à faire, le SSE lui montre le message.
      return;
    }

    if (!online) {
      // Hors ligne → mail tout de suite (avec anti-spam 20 min).
      await sendSupportReplyEmailNow({
        conversationId,
        clientEmail: user.email,
        clientName: user.firstName ?? "",
        context,
        claimId,
      }).catch((err) =>
        logger.error("[support-notify] Envoi immédiat échoué", { error: err }),
      );
      return;
    }

    // En ligne mais sur une autre page → job différé à + 5 min.
    await prisma.pendingSupportEmail.create({
      data: {
        conversationId,
        messageId,
        userId,
        claimId: claimId ?? null,
        dueAt: new Date(Date.now() + SUPPORT_NOTIFY_DELAY_MS),
        status: "PENDING",
      },
    });
  } catch (err) {
    logger.error("[support-notify] scheduleReplyNotification échoué", {
      error: err,
      conversationId,
      messageId,
    });
  }
}

/**
 * Annule tous les jobs PENDING d'une conversation. Appelée quand le client
 * lit les messages (markAsRead / markMessagesReadByClient) : plus besoin
 * de le prévenir, il est déjà au courant.
 */
export async function cancelPendingNotifications(
  conversationId: string,
): Promise<void> {
  try {
    await prisma.pendingSupportEmail.updateMany({
      where: { conversationId, status: "PENDING" },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
  } catch (err) {
    logger.error("[support-notify] cancelPendingNotifications échoué", {
      error: err,
      conversationId,
    });
  }
}
