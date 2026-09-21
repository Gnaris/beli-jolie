"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateClaimReference, CLAIMS_PAGE_SIZE } from "@/lib/claims";
import { createConversation, addMessage } from "@/lib/messaging";
import { notifyAdminNewClaim } from "@/lib/notifications";
import { cancelPendingNotifications } from "@/lib/support-notify";
import { emitChatEvent } from "@/lib/chat-events";
import { logger } from "@/lib/logger";

interface CreateClaimInput {
  subject: string;
  message: string;
  attachments?: { fileName: string; filePath: string; fileSize: number; mimeType: string }[];
}

async function requireApprovedClient() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
    return null;
  }
  return session;
}

export async function createClaim(input: CreateClaimInput) {
  const session = await requireApprovedClient();
  if (!session) return { success: false, error: "Accès non autorisé." };

  const subject = input.subject.trim();
  const message = input.message.trim();
  if (!subject) return { success: false, error: "Le sujet est obligatoire." };
  if (!message) return { success: false, error: "Le message est obligatoire." };
  if (subject.length > 200) return { success: false, error: "Sujet trop long (200 caractères max)." };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { firstName: true, lastName: true, company: true, email: true },
  });
  if (!user) return { success: false, error: "Utilisateur introuvable." };

  try {
    const reference = await generateClaimReference();

    const claim = await prisma.claim.create({
      data: {
        reference,
        subject,
        status: "OPEN",
        userId: session.user.id,
      },
    });

    const conversation = await createConversation({
      type: "CLAIM",
      subject,
      userId: session.user.id,
      claimId: claim.id,
      initialMessage: message,
      senderRole: "CLIENT",
      senderId: session.user.id,
      attachments: input.attachments,
    });

    // Message système : « Un mail a été envoyé à l'administrateur… »
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: session.user.id,
        senderRole: "CLIENT", // pas de rôle SYSTEM en enum — content marqué comme système via convention
        content: "__system__:notification_admin_sent",
        source: "APP",
      },
    });

    notifyAdminNewClaim({
      clientName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
      clientCompany: user.company ?? "",
      claimReference: reference,
      subject,
      messagePreview: message,
      claimId: claim.id,
    }).catch((err) => logger.error("[createClaim] Email admin échoué", { error: err }));

    revalidateTag("claims", "default");
    return { success: true, claimId: claim.id };
  } catch (err) {
    logger.error("[createClaim] Création demande échouée", { error: err });
    return { success: false, error: "Erreur lors de l'envoi de la demande." };
  }
}

/**
 * Client envoie un message dans une conversation existante.
 * Si la conversation était CLOSED, elle est réouverte automatiquement
 * (Claim.status → OPEN, Claim.closedAt = null) + email admin.
 */
export async function sendClientMessage(
  claimId: string,
  content: string,
  attachments?: { fileName: string; filePath: string; fileSize: number; mimeType: string }[],
) {
  const session = await requireApprovedClient();
  if (!session) return { success: false, error: "Accès non autorisé." };

  const body = content.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!body && !hasAttachments) return { success: false, error: "Message vide." };

  const claim = await prisma.claim.findFirst({
    where: { id: claimId, userId: session.user.id },
    include: {
      user: { select: { firstName: true, lastName: true, company: true } },
      conversation: { select: { id: true } },
    },
  });
  if (!claim || !claim.conversation) return { success: false, error: "Demande introuvable." };

  const wasClosed = claim.status === "CLOSED";

  const message = await addMessage({
    conversationId: claim.conversation.id,
    senderId: session.user.id,
    senderRole: "CLIENT",
    content: body || "📎 Pièce jointe",
    attachments,
  });

  if (wasClosed) {
    await prisma.claim.update({
      where: { id: claimId },
      data: { status: "OPEN", closedAt: null },
    });

    // Réouverture = nouvelle notification admin
    notifyAdminNewClaim({
      clientName: `${claim.user.firstName ?? ""} ${claim.user.lastName ?? ""}`.trim(),
      clientCompany: claim.user.company ?? "",
      claimReference: claim.reference,
      subject: `[Réouverture] ${claim.subject}`,
      messagePreview: body || "(pièce jointe)",
      claimId: claim.id,
    }).catch((err) => logger.error("[sendClientMessage] Email réouverture échoué", { error: err }));
  }

  emitChatEvent({
    type: "NEW_MESSAGE",
    conversationId: claim.conversation.id,
    userId: session.user.id,
    targetRole: "ADMIN",
    context: "claim",
    messageData: {
      id: message.id,
      content: message.content,
      senderRole: "CLIENT",
      senderName: message.sender.firstName ?? "Client",
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

  revalidateTag("claims", "default");
  return { success: true };
}

export async function getClientClaims(page = 1) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") {
    return { rows: [], page: 1, pageSize: CLAIMS_PAGE_SIZE, totalPages: 1, filteredTotal: 0 };
  }

  const currentPage = Math.max(1, page | 0);
  const skip = (currentPage - 1) * CLAIMS_PAGE_SIZE;
  const where = { userId: session.user.id };

  const [rows, filteredTotal] = await Promise.all([
    prisma.claim.findMany({
      where,
      include: {
        conversation: {
          select: {
            id: true,
            messages: {
              select: { id: true, content: true, senderRole: true, readAt: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: CLAIMS_PAGE_SIZE,
    }),
    prisma.claim.count({ where }),
  ]);

  return {
    rows,
    page: currentPage,
    pageSize: CLAIMS_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(filteredTotal / CLAIMS_PAGE_SIZE)),
    filteredTotal,
  };
}

export async function getClientClaim(claimId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") return null;

  return prisma.claim.findFirst({
    where: { id: claimId, userId: session.user.id },
    include: {
      conversation: {
        include: {
          messages: {
            include: {
              attachments: true,
              sender: { select: { firstName: true, lastName: true, role: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
}

/** Marque les messages ADMIN comme lus par le client (à l'ouverture de la page). */
export async function markMessagesReadByClient(claimId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") return { success: false };

  const claim = await prisma.claim.findFirst({
    where: { id: claimId, userId: session.user.id },
    select: { conversation: { select: { id: true } } },
  });
  if (!claim?.conversation) return { success: false };

  await prisma.message.updateMany({
    where: {
      conversationId: claim.conversation.id,
      senderRole: "ADMIN",
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  // Le client vient de lire → on annule le mail 5 min si un timer était armé.
  await cancelPendingNotifications(claim.conversation.id);

  emitChatEvent({
    type: "MESSAGE_READ",
    conversationId: claim.conversation.id,
    userId: session.user.id,
    targetRole: "ADMIN",
    context: "claim",
  });

  return { success: true };
}
