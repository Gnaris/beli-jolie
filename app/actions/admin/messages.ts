"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addMessage, markAsRead } from "@/lib/messaging";
import { emitChatEvent } from "@/lib/chat-events";
import { scheduleReplyNotification } from "@/lib/support-notify";
import { deleteFiles } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { getCurrentTenantId } from "@/lib/tenant";
import { revalidateTag } from "next/cache";

export async function getAdminConversations(filter?: "all" | "unread" | "open" | "closed") {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return [];

  const where: Record<string, unknown> = { type: "SUPPORT" };
  if (filter === "open") where.status = "OPEN";
  if (filter === "closed") where.status = "CLOSED";

  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, company: true, email: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true, senderRole: true, readAt: true },
      },
      _count: {
        select: {
          messages: { where: { senderRole: "CLIENT", readAt: null } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (filter === "unread") {
    return conversations.filter((c) => c._count.messages > 0);
  }

  return conversations;
}

export async function getAdminConversation(conversationId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return null;

  await markAsRead(conversationId, "ADMIN");
  // Lecture admin : on ne touche pas aux chronomètres ici. La règle « 1 mail
  // par tour » est pilotée par les RÉPONSES (sendAdminReply), pas par la
  // simple consultation. Lire sans répondre laisse le compteur courir.

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userId: true, type: true },
  });
  if (conv && conv.type === "SUPPORT") {
    const tid = await getCurrentTenantId().catch(() => null);
    emitChatEvent({
      type: "MESSAGE_READ",
      conversationId,
      userId: conv.userId,
      targetRole: "CLIENT",
      tenantId: tid ?? undefined,
    });
  }

  return prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, company: true, email: true } },
      messages: {
        include: {
          attachments: true,
          sender: { select: { firstName: true, lastName: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function sendAdminReply(
  conversationId: string,
  content: string,
  attachments?: { fileName: string; filePath: string; fileSize: number; mimeType: string }[],
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Acces non autorise." };
  }

  if (!content.trim() && (!attachments || attachments.length === 0)) {
    return { success: false, error: "Le message ne peut pas etre vide." };
  }

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
    });

    if (!conversation) return { success: false, error: "Conversation introuvable." };

    const message = await addMessage({
      conversationId,
      senderId: session.user.id,
      senderRole: "ADMIN",
      content: content.trim() || "📎 Pièce jointe",
      attachments,
    });

    // tenantId posé explicitement — garantit que le stream SSE côté client
    // ne filtre pas l'event (fail-closed si event.tenantId !== requestTenantId).
    // Sans ça, en cas d'ALS non bindée, le client ne verrait pas le message
    // en temps réel et devrait fermer/rouvrir le chat pour le découvrir.
    const tidForEvent = await getCurrentTenantId().catch(() => null);
    emitChatEvent({
      type: "NEW_MESSAGE",
      conversationId,
      userId: conversation.userId,
      targetRole: "CLIENT",
      tenantId: tidForEvent ?? undefined,
      messageData: {
        id: message.id,
        content: content.trim(),
        senderRole: "ADMIN",
        senderName: "Admin",
        createdAt: message.createdAt.toISOString(),
        attachments: message.attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          filePath: a.filePath,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
        })),
      },
    });

    revalidateTag("messages", "default");

    // Règle « 1 mail par tour » : fin du tour admin + démarrage chronomètre
    // client s'il n'y en a pas déjà un. Fire-and-forget.
    void scheduleReplyNotification({
      conversationId: conversation.id,
      messageId: message.id,
      senderRole: "ADMIN",
      context: "chat",
    });

    return { success: true, message };
  } catch {
    return { success: false, error: "Erreur lors de l'envoi du message." };
  }
}

export async function closeConversation(conversationId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Acces non autorise." };
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      userId: true,
      messages: {
        select: {
          attachments: { select: { filePath: true } },
        },
      },
    },
  });

  if (!conversation) return { success: false, error: "Conversation introuvable." };

  const filePaths = conversation.messages
    .flatMap((m) => m.attachments)
    .map((a) => a.filePath);

  // Delete conversation + all messages + attachments (cascade Prisma).
  // Nettoyage des fichiers physiques après le delete BDD — les MessageAttachment
  // partent en cascade mais les fichiers sur disque resteraient orphelins.
  await prisma.conversation.delete({
    where: { id: conversationId },
  });

  if (filePaths.length > 0) {
    deleteFiles(filePaths).catch((err) =>
      logger.error("[closeConversation] Suppression fichiers chat échouée", {
        error: err,
        conversationId,
        count: filePaths.length,
      }),
    );
  }

  const tidClose = await getCurrentTenantId().catch(() => null);
  emitChatEvent({
    type: "CONVERSATION_CLOSED",
    conversationId,
    userId: conversation.userId,
    targetRole: "CLIENT",
    tenantId: tidClose ?? undefined,
  });

  revalidateTag("messages", "default");
  return { success: true };
}

export async function joinConversation(conversationId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Acces non autorise." };
  }

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, status: true },
    });

    if (!conversation) return { success: false, error: "Conversation introuvable." };

    // Add system message
    const message = await addMessage({
      conversationId,
      senderId: session.user.id,
      senderRole: "ADMIN",
      content: `Un administrateur a rejoint la conversation.`,
    });

    // Notify client via SSE
    const tidJoin = await getCurrentTenantId().catch(() => null);
    emitChatEvent({
      type: "NEW_MESSAGE",
      conversationId,
      userId: conversation.userId,
      targetRole: "CLIENT",
      tenantId: tidJoin ?? undefined,
      messageData: {
        id: message.id,
        content: `Un administrateur a rejoint la conversation.`,
        senderRole: "ADMIN",
        senderName: "Admin",
        createdAt: message.createdAt.toISOString(),
      },
    });

    revalidateTag("messages", "default");
    return { success: true, message };
  } catch {
    return { success: false, error: "Erreur lors de la prise en charge." };
  }
}

export async function getAdminUnreadCount() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return 0;

  return prisma.message.count({
    where: {
      senderRole: "CLIENT",
      readAt: null,
      conversation: { type: "SUPPORT" },
    },
  });
}

/**
 * Marque les messages CLIENT de cette conv comme lus par l'admin et prévient
 * le client via SSE. Appelé quand un NEW_MESSAGE arrive via stream sur la
 * conv déjà ouverte côté admin — sinon la BDD garde `readAt: null` et au
 * retour liste la conv réapparaît faussement non-lue.
 */
export async function markAdminMessagesRead(conversationId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Acces non autorise." };
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userId: true, type: true },
  });
  if (!conversation || conversation.type !== "SUPPORT") {
    return { success: false, error: "Conversation introuvable." };
  }

  await markAsRead(conversationId, "ADMIN");

  const tid = await getCurrentTenantId().catch(() => null);
  emitChatEvent({
    type: "MESSAGE_READ",
    conversationId,
    userId: conversation.userId,
    targetRole: "CLIENT",
    tenantId: tid ?? undefined,
  });

  return { success: true };
}
