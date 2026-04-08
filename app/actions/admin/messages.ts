"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addMessage, markAsRead } from "@/lib/messaging";
import { emitChatEvent } from "@/lib/chat-events";
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

    emitChatEvent({
      type: "NEW_MESSAGE",
      conversationId,
      userId: conversation.userId,
      targetRole: "CLIENT",
      messageData: {
        id: message.id,
        content: content.trim(),
        senderRole: "ADMIN",
        senderName: session.user.name || "Admin",
        createdAt: message.createdAt.toISOString(),
      },
    });

    revalidateTag("messages", "default");
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

  const conversation = await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "CLOSED" },
    select: { userId: true },
  });

  emitChatEvent({
    type: "CONVERSATION_CLOSED",
    conversationId,
    userId: conversation.userId,
    targetRole: "CLIENT",
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

    const adminName = session.user.name || "Un administrateur";

    // Add system message
    const message = await addMessage({
      conversationId,
      senderId: session.user.id,
      senderRole: "ADMIN",
      content: `${adminName} a rejoint la conversation.`,
    });

    // Notify client via SSE
    emitChatEvent({
      type: "NEW_MESSAGE",
      conversationId,
      userId: conversation.userId,
      targetRole: "CLIENT",
      messageData: {
        id: message.id,
        content: `${adminName} a rejoint la conversation.`,
        senderRole: "ADMIN",
        senderName: adminName,
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
