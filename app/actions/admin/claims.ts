"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canTransition } from "@/lib/claims";
import { createCredit } from "@/lib/credits";
import { addMessage } from "@/lib/messaging";
import { notifyClientClaimUpdate } from "@/lib/notifications";
import { emitChatEvent } from "@/lib/chat-events";
import { logger } from "@/lib/logger";
import { revalidateTag } from "next/cache";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Acces non autorise.");
  return session;
}

export async function getAdminClaims(filter?: string) {
  await requireAdmin();

  const where: Record<string, unknown> = {};
  if (filter && filter !== "all") where.status = filter;

  const claims = await prisma.claim.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, company: true } },
      order: { select: { orderNumber: true } },
      _count: { select: { items: true, images: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return claims.map((c) => ({
    ...c,
    refundAmount: c.refundAmount ? Number(c.refundAmount) : null,
    creditAmount: c.creditAmount ? Number(c.creditAmount) : null,
  }));
}

export async function getAdminClaim(claimId: string) {
  await requireAdmin();

  return prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, company: true, email: true } },
      order: {
        select: { id: true, orderNumber: true, totalTTC: true, status: true },
      },
      items: {
        include: {
          orderItem: { select: { productName: true, productRef: true, colorName: true, imagePath: true, quantity: true, unitPrice: true } },
        },
      },
      images: true,
      returnInfo: true,
      reshipInfo: true,
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

export async function updateClaimStatus(claimId: string, newStatus: string, message?: string) {
  const session = await requireAdmin();

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { user: { select: { email: true, firstName: true } }, conversation: true },
  });

  if (!claim) return { success: false, error: "Reclamation introuvable." };

  if (!canTransition(claim.status, newStatus)) {
    return { success: false, error: `Transition ${claim.status} -> ${newStatus} non autorisee.` };
  }

  await prisma.claim.update({
    where: { id: claimId },
    data: { status: newStatus as never },
  });

  if (message?.trim() && claim.conversation) {
    await addMessage({
      conversationId: claim.conversation.id,
      senderId: session.user.id,
      senderRole: "ADMIN",
      content: message.trim(),
    });
  }

  notifyClientClaimUpdate({
    clientEmail: claim.user.email,
    clientName: claim.user.firstName,
    claimReference: claim.reference,
    newStatus,
    message,
    claimId,
  }).catch((err) =>
    logger.error("[admin/claims] Email client réclamation échoué", {
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  emitChatEvent({
    type: "CLAIM_STATUS_CHANGED",
    conversationId: claim.conversation?.id || "",
    userId: claim.userId,
    targetRole: "CLIENT",
    claimData: { claimId, newStatus },
  });

  revalidateTag("claims", "default");
  return { success: true };
}

export async function setClaimResolution(
  claimId: string,
  resolution: "NONE" | "REFUND" | "CREDIT" | "RESHIP",
  params: { amount?: number; message?: string }
) {
  await requireAdmin();

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { user: true, conversation: true },
  });

  if (!claim) return { success: false, error: "Reclamation introuvable." };

  const updateData: Record<string, unknown> = { resolution };

  if (resolution === "CREDIT" && params.amount) {
    updateData.creditAmount = params.amount;
    await createCredit({
      userId: claim.userId,
      amount: params.amount,
      claimId,
    });
  }

  if (resolution === "REFUND" && params.amount) {
    updateData.refundAmount = params.amount;
  }

  await prisma.claim.update({
    where: { id: claimId },
    data: updateData,
  });

  revalidateTag("claims", "default");
  return { success: true };
}

export async function updateAdminNote(claimId: string, note: string) {
  await requireAdmin();

  await prisma.claim.update({
    where: { id: claimId },
    data: { adminNote: note },
  });

  return { success: true };
}
