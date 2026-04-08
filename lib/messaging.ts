import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ConversationType, Role, MessageSource } from "@prisma/client";

/**
 * Create a new conversation with an initial message.
 */
export async function createConversation(params: {
  type: ConversationType;
  subject?: string;
  userId: string;
  claimId?: string;
  initialMessage: string;
  senderRole: Role;
  senderId: string;
  source?: MessageSource;
  attachments?: { fileName: string; filePath: string; fileSize: number; mimeType: string }[];
}) {
  const { type, subject, userId, claimId, initialMessage, senderRole, senderId, source, attachments } = params;

  const conversation = await prisma.conversation.create({
    data: {
      type,
      subject,
      userId,
      claimId,
      messages: {
        create: {
          senderId,
          senderRole,
          content: initialMessage,
          source: source || "APP",
          attachments: attachments
            ? { create: attachments }
            : undefined,
        },
      },
    },
    include: {
      messages: { include: { attachments: true } },
    },
  });

  logger.info(`[Messaging] Created ${type} conversation ${conversation.id} for user ${userId}`);
  return conversation;
}

/**
 * Add a message to an existing conversation.
 */
export async function addMessage(params: {
  conversationId: string;
  senderId: string;
  senderRole: Role;
  content: string;
  source?: MessageSource;
  attachments?: { fileName: string; filePath: string; fileSize: number; mimeType: string }[];
}) {
  const { conversationId, senderId, senderRole, content, source, attachments } = params;

  // Reopen conversation if closed
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "OPEN", updatedAt: new Date() },
  });

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId,
      senderRole,
      content,
      source: source || "APP",
      attachments: attachments
        ? { create: attachments }
        : undefined,
    },
    include: { attachments: true, sender: { select: { firstName: true, lastName: true, company: true } } },
  });

  logger.info(`[Messaging] Message added to conversation ${conversationId} by ${senderRole}`);
  return message;
}

/**
 * Mark all messages in a conversation as read for a given role.
 */
export async function markAsRead(conversationId: string, readerRole: Role) {
  const otherRole = readerRole === "ADMIN" ? "CLIENT" : "ADMIN";

  await prisma.message.updateMany({
    where: {
      conversationId,
      senderRole: otherRole,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
}

/**
 * Get unread message count for admin (all conversations) or for a specific client.
 */
export async function getUnreadCount(role: Role, userId?: string) {
  const where: Record<string, unknown> = {
    readAt: null,
    senderRole: role === "ADMIN" ? "CLIENT" : "ADMIN",
  };

  if (role === "CLIENT" && userId) {
    where.conversation = { userId };
  }

  return prisma.message.count({ where });
}

