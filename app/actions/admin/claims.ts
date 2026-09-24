"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CLAIMS_PAGE_SIZE } from "@/lib/claims";
import { addMessage } from "@/lib/messaging";
import { scheduleReplyNotification } from "@/lib/support-notify";
import { emitChatEvent } from "@/lib/chat-events";
import { deleteFiles } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { createCredit, getAvailableCredit } from "@/lib/credits";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
  return session;
}

export async function getAdminClaims(filter?: string, page = 1, typeFilter?: string, search?: string) {
  await requireAdmin();

  const where: Record<string, unknown> = {};
  if (filter === "OPEN" || filter === "CLOSED") where.status = filter;
  if (typeFilter === "ORDER_RELATED" || typeFilter === "OTHER") where.type = typeFilter;

  const q = (search ?? "").trim();
  if (q.length > 0) {
    where.OR = [
      { subject: { contains: q } },
      { reference: { contains: q } },
      { user: { email: { contains: q } } },
      { user: { company: { contains: q } } },
      { user: { firstName: { contains: q } } },
      { user: { lastName: { contains: q } } },
      { order: { orderNumber: { contains: q } } },
    ];
  }

  const currentPage = Math.max(1, page | 0);
  const skip = (currentPage - 1) * CLAIMS_PAGE_SIZE;

  const [claims, filteredTotal] = await Promise.all([
    prisma.claim.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, company: true, email: true } },
        order: { select: { id: true, orderNumber: true } },
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
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      skip,
      take: CLAIMS_PAGE_SIZE,
    }),
    prisma.claim.count({ where }),
  ]);

  const conversationIds = claims
    .map((c) => c.conversation?.id)
    .filter((id): id is string => Boolean(id));

  const unreadCounts = conversationIds.length
    ? await prisma.message.groupBy({
        by: ["conversationId"],
        where: {
          conversationId: { in: conversationIds },
          senderRole: "CLIENT",
          readAt: null,
        },
        _count: { _all: true },
      })
    : [];

  const unreadMap = new Map(unreadCounts.map((u) => [u.conversationId, u._count._all]));

  const rows = claims.map((c) => ({
    ...c,
    hasUnreadFromClient: c.conversation ? (unreadMap.get(c.conversation.id) ?? 0) > 0 : false,
    lastMessage: c.conversation?.messages[0] ?? null,
  }));

  return {
    rows,
    page: currentPage,
    pageSize: CLAIMS_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(filteredTotal / CLAIMS_PAGE_SIZE)),
    filteredTotal,
  };
}

export async function getAdminClaimsStats() {
  await requireAdmin();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startOf30d = new Date(now.getTime() - 30 * 86_400_000);

  const [counts, oldestOpen, closedThisMonth, closedPrevMonth, unreadMessages, firstResponseSamples] =
    await Promise.all([
      prisma.claim.groupBy({ by: ["status"], _count: true }),
      prisma.claim.findFirst({
        where: { status: "OPEN" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.claim.count({
        where: { status: "CLOSED", closedAt: { gte: startOfMonth } },
      }),
      prisma.claim.count({
        where: { status: "CLOSED", closedAt: { gte: startOfPrevMonth, lt: startOfMonth } },
      }),
      prisma.message.count({
        where: { senderRole: "CLIENT", readAt: null },
      }),
      // Échantillon des 30 derniers jours : délai entre 1er message CLIENT et 1er message ADMIN
      prisma.claim.findMany({
        where: { createdAt: { gte: startOf30d } },
        select: {
          conversation: {
            select: {
              messages: {
                select: { senderRole: true, createdAt: true },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      }),
    ]);

  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<
    string,
    number
  >;
  const total = counts.reduce((sum, c) => sum + c._count, 0);
  const opened = countMap.OPEN ?? 0;

  const oldestOpenDays = oldestOpen
    ? Math.max(0, Math.floor((now.getTime() - oldestOpen.createdAt.getTime()) / 86_400_000))
    : null;

  const growth =
    closedPrevMonth > 0 ? ((closedThisMonth - closedPrevMonth) / closedPrevMonth) * 100 : null;

  const responseTimesMinutes: number[] = [];
  for (const c of firstResponseSamples) {
    const msgs = c.conversation?.messages ?? [];
    const firstClient = msgs.find((m) => m.senderRole === "CLIENT");
    const firstAdmin = msgs.find((m) => m.senderRole === "ADMIN");
    if (firstClient && firstAdmin && firstAdmin.createdAt > firstClient.createdAt) {
      responseTimesMinutes.push(
        (firstAdmin.createdAt.getTime() - firstClient.createdAt.getTime()) / 60_000,
      );
    }
  }
  const avgFirstResponseMinutes = responseTimesMinutes.length
    ? Math.round(responseTimesMinutes.reduce((s, v) => s + v, 0) / responseTimesMinutes.length)
    : null;

  return {
    total,
    countMap,
    opened,
    closedThisMonth,
    unreadMessages,
    oldestOpenDays,
    growth,
    avgFirstResponseMinutes,
  };
}

export async function getAdminClaim(claimId: string) {
  await requireAdmin();

  return prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          email: true,
          createdAt: true,
        },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          createdAt: true,
          totalTTC: true,
          status: true,
          clientDiscountAmt: true,
          promoDiscount: true,
          items: {
            select: {
              id: true,
              lineTotal: true,
              isCompensation: true,
            },
          },
        },
      },
      orderItems: {
        include: {
          orderItem: {
            select: {
              id: true,
              productName: true,
              productRef: true,
              colorName: true,
              imagePath: true,
              saleType: true,
              packQty: true,
              size: true,
              sizesJson: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
              lineDiscountAmt: true,
              isCompensation: true,
              variantSnapshot: true,
            },
          },
        },
      },
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

/** Envoi d'un message admin. */
export async function sendAdminMessage(
  claimId: string,
  content: string,
  attachments?: { fileName: string; filePath: string; fileSize: number; mimeType: string }[],
) {
  const session = await requireAdmin();

  const body = content.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!body && !hasAttachments) return { success: false, error: "Message vide." };

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    select: { conversation: { select: { id: true } }, userId: true },
  });
  if (!claim?.conversation) return { success: false, error: "Demande introuvable." };

  const message = await addMessage({
    conversationId: claim.conversation.id,
    senderId: session.user.id,
    senderRole: "ADMIN",
    content: body || "📎 Pièce jointe",
    attachments,
  });

  emitChatEvent({
    type: "NEW_MESSAGE",
    conversationId: claim.conversation.id,
    userId: claim.userId,
    targetRole: "CLIENT",
    context: "claim",
    messageData: {
      id: message.id,
      content: message.content,
      senderRole: "ADMIN",
      senderName: message.sender.firstName ?? "Administrateur",
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

  // Décision présence-aware : mail immédiat, chronomètre 5 min, ou rien.
  // Reset auto du chronomètre s'il y a déjà un job PENDING sur la conv.
  void scheduleReplyNotification({
    conversationId: claim.conversation.id,
    messageId: message.id,
    userId: claim.userId,
    context: "claim",
    claimId,
  });

  revalidateTag("claims", "default");
  return { success: true, messageId: message.id };
}

/**
 * Suppression définitive d'une conversation. Refuse si status !== CLOSED.
 * Cascade : messages + pièces jointes (via onDelete: Cascade sur Message
 * → MessageAttachment) puis conversation puis claim.
 */
export async function deleteClaim(claimId: string) {
  await requireAdmin();

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    select: {
      status: true,
      userId: true,
      conversation: { select: { id: true } },
    },
  });
  if (!claim) return { success: false, error: "Demande introuvable." };
  if (claim.status !== "CLOSED") {
    return {
      success: false,
      error: "La conversation doit être clôturée avant d'être supprimée.",
    };
  }

  // 1) Récupérer les paths des fichiers physiques AVANT de supprimer la DB
  let filePathsToDelete: string[] = [];
  if (claim.conversation) {
    const attachments = await prisma.messageAttachment.findMany({
      where: { message: { conversationId: claim.conversation.id } },
      select: { filePath: true },
    });
    filePathsToDelete = attachments
      .map((a) => a.filePath.replace(/^\//, ""))
      .filter(Boolean);
  }

  // 2) Suppression DB en transaction
  await prisma.$transaction(async (tx) => {
    if (claim.conversation) {
      const msgs = await tx.message.findMany({
        where: { conversationId: claim.conversation.id },
        select: { id: true },
      });
      const msgIds = msgs.map((m) => m.id);
      if (msgIds.length > 0) {
        await tx.messageAttachment.deleteMany({ where: { messageId: { in: msgIds } } });
        await tx.message.deleteMany({ where: { id: { in: msgIds } } });
      }
      await tx.conversation.delete({ where: { id: claim.conversation.id } });
    }
    await tx.claim.delete({ where: { id: claimId } });
  });

  // 3) Suppression fichiers physiques (best-effort, ne bloque pas si échec)
  if (filePathsToDelete.length > 0) {
    try {
      await deleteFiles(filePathsToDelete);
      logger.info(`[deleteClaim] ${filePathsToDelete.length} fichier(s) supprimé(s) du disque`, {
        claimId,
      });
    } catch (err) {
      logger.warn("[deleteClaim] Nettoyage disque partiel", { error: err, claimId });
    }
  }

  // 4) Notifie le client via SSE — s'il est en train de lire cette conversation,
  //    son UI le redirige proprement vers la liste au lieu d'un 404.
  if (claim.conversation) {
    emitChatEvent({
      type: "CONVERSATION_DELETED",
      conversationId: claim.conversation.id,
      userId: claim.userId,
      targetRole: "CLIENT",
      context: "claim",
      claimData: { claimId, newStatus: "DELETED" },
    });
  }

  revalidateTag("claims", "default");
  return { success: true };
}

/** Clôture une conversation. */
export async function closeClaim(claimId: string) {
  await requireAdmin();

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    select: { status: true, userId: true, conversation: { select: { id: true } } },
  });
  if (!claim) return { success: false, error: "Demande introuvable." };
  if (claim.status === "CLOSED") return { success: true }; // idempotent

  await prisma.claim.update({
    where: { id: claimId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  emitChatEvent({
    type: "CLAIM_STATUS_CHANGED",
    conversationId: claim.conversation?.id ?? "",
    userId: claim.userId,
    targetRole: "CLIENT",
    context: "claim",
    claimData: { claimId, newStatus: "CLOSED" },
  });

  revalidateTag("claims", "default");
  return { success: true };
}

/**
 * Charge le contexte crédit d'un client pour l'afficher dans la fiche
 * service client admin : solde dispo + 5 derniers crédits accordés.
 */
export async function getClientCreditContext(userId: string) {
  await requireAdmin();

  const [available, recent] = await Promise.all([
    getAvailableCredit(userId),
    prisma.credit.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        amount: true,
        remainingAmount: true,
        reason: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    available,
    recent: recent.map((c) => ({
      id: c.id,
      amount: Number(c.amount),
      remainingAmount: Number(c.remainingAmount),
      reason: c.reason,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

/**
 * Raccourci « attribuer un avoir » depuis la fiche service client. L'admin
 * ouvre une demande, décide d'accorder un geste commercial, clique — l'avoir
 * atterrit dans le solde crédit du client, utilisable dès sa prochaine commande.
 */
export async function grantCreditForClient(input: {
  userId: string;
  amount: number;
  reason?: string;
  expiresAt?: string | null;
  claimReference?: string;
}) {
  const session = await requireAdmin();

  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false as const, error: "Le montant doit être supérieur à 0." };
  }
  if (amount > 10000) {
    return { success: false as const, error: "Montant trop élevé (max 10 000 €). Contactez le support technique si nécessaire." };
  }

  // Vérifie que le client existe dans le tenant courant (extension Prisma
  // scope automatiquement, mais on veut un message d'erreur explicite).
  const user = await prisma.user.findFirst({
    where: { id: input.userId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!user) return { success: false as const, error: "Client introuvable." };

  const reason =
    input.reason?.trim() ||
    (input.claimReference ? `Geste commercial – demande ${input.claimReference}` : "Geste commercial");

  const expiresAt =
    input.expiresAt && input.expiresAt.trim().length > 0 ? new Date(input.expiresAt) : undefined;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return { success: false as const, error: "Date d'expiration invalide." };
  }

  const credit = await createCredit({
    userId: user.id,
    amount,
    reason,
    expiresAt,
  });

  logger.info(
    `[Claims] Admin ${session.user.email} a accordé ${amount}€ d'avoir à ${user.email} (raison : ${reason})`,
    { creditId: credit.id, claimReference: input.claimReference },
  );

  const available = await getAvailableCredit(user.id);
  return { success: true as const, creditId: credit.id, available };
}

/** Marque tous les messages CLIENT comme lus (à l'ouverture de la page admin).
 *  Appelée depuis un Server Component au render — donc PAS de revalidateTag()
 *  ici (Next 16 interdit revalidate pendant render). Le compteur "Non lues"
 *  de la liste sera rafraîchi au prochain navigate/refresh, ce qui est OK. */
export async function markMessagesReadByAdmin(claimId: string) {
  await requireAdmin();

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    select: { userId: true, conversation: { select: { id: true } } },
  });
  if (!claim?.conversation) return { success: false };

  await prisma.message.updateMany({
    where: {
      conversationId: claim.conversation.id,
      senderRole: "CLIENT",
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  emitChatEvent({
    type: "MESSAGE_READ",
    conversationId: claim.conversation.id,
    userId: claim.userId,
    targetRole: "CLIENT",
    context: "claim",
  });

  return { success: true };
}
