"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createConversation, addMessage, markAsRead } from "@/lib/messaging";
import { notifyAdminNewMessage } from "@/lib/notifications";
import { revalidateTag } from "next/cache";

export async function createSupportConversation(subject: string, message: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
    return { success: false, error: "Acces non autorise." };
  }

  if (!subject.trim() || !message.trim()) {
    return { success: false, error: "Le sujet et le message sont obligatoires." };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { firstName: true, lastName: true, company: true },
    });

    const conversation = await createConversation({
      type: "SUPPORT",
      subject: subject.trim(),
      userId: session.user.id,
      initialMessage: message.trim(),
      senderRole: "CLIENT",
      senderId: session.user.id,
    });

    notifyAdminNewMessage({
      clientName: `${user?.firstName} ${user?.lastName}`,
      clientCompany: user?.company || "",
      subject: subject.trim(),
      messagePreview: message.trim(),
      conversationId: conversation.id,
    }).catch(() => {});

    revalidateTag("messages", "default");
    return { success: true, conversationId: conversation.id };
  } catch {
    return { success: false, error: "Erreur lors de la creation de la conversation." };
  }
}

export async function sendClientMessage(conversationId: string, content: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") {
    return { success: false, error: "Acces non autorise." };
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: session.user.id },
    select: { id: true, subject: true },
  });

  if (!conversation) {
    return { success: false, error: "Conversation introuvable." };
  }

  if (!content.trim()) {
    return { success: false, error: "Le message ne peut pas etre vide." };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { firstName: true, lastName: true, company: true },
    });

    const message = await addMessage({
      conversationId,
      senderId: session.user.id,
      senderRole: "CLIENT",
      content: content.trim(),
    });

    notifyAdminNewMessage({
      clientName: `${user?.firstName} ${user?.lastName}`,
      clientCompany: user?.company || "",
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

export async function getClientConversations() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") return [];

  return prisma.conversation.findMany({
    where: { userId: session.user.id, type: "SUPPORT" },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true, senderRole: true, readAt: true },
      },
      _count: {
        select: {
          messages: { where: { senderRole: "ADMIN", readAt: null } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getClientConversation(conversationId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") return null;

  await markAsRead(conversationId, "CLIENT");

  return prisma.conversation.findFirst({
    where: { id: conversationId, userId: session.user.id },
    include: {
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
