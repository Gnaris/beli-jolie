/**
 * Système de notification Service Client — règle « 1 mail par tour »
 * (décidée avec la cliente 2026-10-15, remplace l'ancienne logique
 * présence + anti-spam 20 min).
 *
 * Règle :
 *   - Chaque message dans une conversation démarre un chronomètre de 2 min
 *     côté destinataire… SAUF si un chronomètre tourne déjà pour lui, ou
 *     si un mail lui a déjà été envoyé pendant ce tour. Un seul mail par
 *     tour, peu importe le nombre de messages envoyés.
 *   - Si le destinataire répond avant la fin, on efface toutes ses lignes
 *     (PENDING + SENT) pour ce tour : le prochain message du correspondant
 *     recrée un chronomètre neuf. C'est « chacun son tour ».
 *   - La présence (page ouverte ou pas) n'intervient plus : seule la
 *     réponse arrête le mail.
 *
 * Fonctionne symétriquement pour les 2 directions via le champ
 * `PendingSupportEmail.recipientRole` :
 *   - message client → recipientRole = ADMIN
 *   - message admin  → recipientRole = CLIENT
 *
 * Worker : `lib/support-email-worker.ts` scanne toutes les 30 s.
 */

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { SupportReplyContext } from "@/lib/notifications";

/** Fenêtre du chronomètre : 2 min entre la réponse et l'envoi du mail. */
export const SUPPORT_NOTIFY_DELAY_MS = 2 * 60 * 1000;

export interface ScheduleReplyNotificationInput {
  conversationId: string;
  messageId: string;
  /** Rôle de l'expéditeur du message qu'on vient d'ajouter. */
  senderRole: Role;
  context: SupportReplyContext;
  /** Si context === "claim", id de la réclamation liée. */
  claimId?: string;
}

/**
 * Résout l'id utilisateur du destinataire du mail. Côté CLIENT c'est le
 * propriétaire de la conversation ; côté ADMIN c'est le premier admin
 * actif de la boutique (le tenant courant est scopé par Prisma via l'ALS).
 * Retourne null si aucun destinataire ne peut être résolu.
 */
async function resolveRecipientUserId(
  conversationId: string,
  recipientRole: Role,
): Promise<string | null> {
  if (recipientRole === "CLIENT") {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId },
      select: { userId: true },
    });
    return conv?.userId ?? null;
  }
  // Côté ADMIN : premier compte ADMIN du tenant (l'ALS scope déjà).
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return admin?.id ?? null;
}

/**
 * Appelée après chaque nouveau message. Fait 2 choses :
 *   1. « L'expéditeur vient de parler » → efface ses propres lignes (PENDING
 *      ou SENT) : il n'est plus en attente d'une réponse de sa part. Le
 *      prochain message du correspondant repartira d'un tour neuf.
 *   2. « Le destinataire doit répondre » → crée un job PENDING à + 2 min,
 *      UNIQUEMENT s'il n'existe pas déjà de ligne (PENDING ou SENT) pour ce
 *      destinataire sur ce tour. Garantit « 1 seul mail par tour ».
 *
 * Fire-and-forget côté caller — cette fonction ne throw pas.
 */
export async function scheduleReplyNotification(
  input: ScheduleReplyNotificationInput,
): Promise<void> {
  const { conversationId, messageId, senderRole, context, claimId } = input;
  const recipientRole: Role = senderRole === "ADMIN" ? "CLIENT" : "ADMIN";

  try {
    // 1) L'expéditeur vient de parler : fin de son tour (côté « on attend
    //    sa réponse »). On efface les lignes où lui est destinataire, afin
    //    que le prochain message de l'autre partie puisse créer un nouveau
    //    chronomètre proprement.
    await prisma.pendingSupportEmail.deleteMany({
      where: { conversationId, recipientRole: senderRole },
    });

    // 2) Si un job (PENDING ou SENT) existe déjà pour ce destinataire, on
    //    reste sur le même tour : pas de double mail.
    const existing = await prisma.pendingSupportEmail.findFirst({
      where: {
        conversationId,
        recipientRole,
        status: { in: ["PENDING", "SENT"] },
      },
      select: { id: true },
    });
    if (existing) return;

    const recipientUserId = await resolveRecipientUserId(conversationId, recipientRole);
    if (!recipientUserId) {
      logger.warn("[support-notify] Destinataire introuvable", {
        conversationId,
        recipientRole,
      });
      return;
    }

    await prisma.pendingSupportEmail.create({
      data: {
        conversationId,
        messageId,
        userId: recipientUserId,
        recipientRole,
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
      recipientRole,
    });
  }
}

/**
 * Marque la conversation comme « admin déjà notifié pour ce tour », sans
 * créer de chronomètre. Utilisé après l'envoi du mail « nouveau ticket » :
 * on vient de prévenir l'admin, inutile d'empiler un second mail à + 2 min
 * si le client envoie un 2ᵉ message dans la foulée. Une ligne SENT à now
 * fait office de marqueur de tour (sera supprimée dès que l'admin répond).
 */
export async function markAdminAlreadyNotifiedThisTurn(params: {
  conversationId: string;
  messageId: string;
  claimId?: string;
}): Promise<void> {
  const { conversationId, messageId, claimId } = params;
  try {
    const adminId = await resolveRecipientUserId(conversationId, "ADMIN");
    if (!adminId) return;
    await prisma.pendingSupportEmail.deleteMany({
      where: { conversationId, recipientRole: "ADMIN" },
    });
    const now = new Date();
    await prisma.pendingSupportEmail.create({
      data: {
        conversationId,
        messageId,
        userId: adminId,
        recipientRole: "ADMIN",
        claimId: claimId ?? null,
        dueAt: now,
        status: "SENT",
        sentAt: now,
      },
    });
  } catch (err) {
    logger.error("[support-notify] markAdminAlreadyNotifiedThisTurn échoué", {
      error: err,
      conversationId,
    });
  }
}
