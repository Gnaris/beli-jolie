"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addMessage, markAsRead } from "@/lib/messaging";
import { notifyClientNewReply } from "@/lib/notifications";
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

export async function sendAdminReply(conversationId: string, content: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Acces non autorise." };
  }

  if (!content.trim()) {
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
      content: content.trim(),
    });

    notifyClientNewReply({
      clientEmail: conversation.user.email,
      clientName: conversation.user.firstName,
      subject: conversation.subject || "Sans sujet",
      messagePreview: content.trim(),
      conversationId,
    }).catch(() => {});

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

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "CLOSED" },
  });

  revalidateTag("messages", "default");
  return { success: true };
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
