"use server";

/**
 * Helper serveur dev-only pour vérifier visuellement le fonctionnement du
 * système « 1 mail par tour » (lib/support-notify.ts).
 *
 * Expose l'état du dernier `PendingSupportEmail` d'une conversation : s'il
 * y a un chronomètre en cours (PENDING + dueAt dans le futur), à combien
 * il est, ou si un mail vient d'être envoyé pour ce tour (SENT).
 *
 * Monté dans les 4 vues conversation (chat admin, chat client, claim admin,
 * claim client) via <SupportTimerBadge /> — composant qui ne s'affiche
 * qu'en NODE_ENV=development.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface ActiveSupportTimer {
  /** PENDING = chronomètre tourne, SENT = mail déjà parti pour ce tour. */
  status: "PENDING" | "SENT";
  /** Rôle du destinataire du mail (celui qui doit répondre). */
  recipientRole: "CLIENT" | "ADMIN";
  /** Instant théorique d'envoi (passé si SENT). */
  dueAtIso: string;
  /** Timestamp d'envoi effectif si SENT, null sinon. */
  sentAtIso: string | null;
}

export async function getActiveSupportTimer(
  conversationId: string,
): Promise<ActiveSupportTimer | null> {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  // Vérifie que l'appelant a bien accès à cette conversation : admin OK pour
  // tout, client uniquement sur ses conversations.
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId },
    select: { userId: true },
  });
  if (!conv) return null;
  if (session.user.role === "CLIENT" && conv.userId !== session.user.id) {
    return null;
  }

  const job = await prisma.pendingSupportEmail.findFirst({
    where: {
      conversationId,
      status: { in: ["PENDING", "SENT"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      recipientRole: true,
      dueAt: true,
      sentAt: true,
    },
  });
  if (!job) return null;

  return {
    status: job.status as "PENDING" | "SENT",
    recipientRole: job.recipientRole,
    dueAtIso: job.dueAt.toISOString(),
    sentAtIso: job.sentAt ? job.sentAt.toISOString() : null,
  };
}
