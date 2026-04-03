"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canTransition } from "@/lib/claims";
import { createCredit } from "@/lib/credits";
import { createStockMovement } from "@/lib/stock";
import { addMessage } from "@/lib/messaging";
import { notifyClientClaimUpdate } from "@/lib/notifications";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Acces non autorise.");
  return session;
}

export async function getAdminClaims(filter?: string) {
  await requireAdmin();

  const where: Record<string, unknown> = {};
  if (filter && filter !== "all") where.status = filter;

  return prisma.claim.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, company: true } },
      order: { select: { orderNumber: true } },
      _count: { select: { items: true, images: true } },
    },
    orderBy: { createdAt: "desc" },
  });
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
  }).catch(() => {});

  revalidateTag("claims", "default");
  return { success: true };
}

export async function setClaimResolution(
  claimId: string,
  resolution: "REFUND" | "CREDIT" | "RESHIP",
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

export async function requestReturn(
  claimId: string,
  method: "EASY_EXPRESS" | "CLIENT_SELF",
  adminNote?: string
) {
  await requireAdmin();

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { user: true, order: true },
  });
  if (!claim) return { success: false, error: "Reclamation introuvable." };

  if (method === "EASY_EXPRESS" && claim.order) {
    logger.info(`[SAV] Easy Express return label requested for claim ${claim.reference}`);
  }

  await prisma.$transaction([
    prisma.claimReturn.create({
      data: {
        claimId,
        method,
        status: method === "EASY_EXPRESS" ? "LABEL_GENERATED" : "PENDING",
        adminNote,
      },
    }),
    prisma.claim.update({
      where: { id: claimId },
      data: { status: "RETURN_PENDING" },
    }),
  ]);

  revalidateTag("claims", "default");
  return { success: true };
}

export async function confirmReturnReceived(claimId: string) {
  const session = await requireAdmin();

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { returnInfo: true, items: true },
  });

  if (!claim || claim.status !== "RETURN_SHIPPED") {
    return { success: false, error: "La reclamation n'est pas en statut retour expedie." };
  }

  // Reinstate stock for returned items
  for (const item of claim.items) {
    if (item.orderItemId) {
      const orderItem = await prisma.orderItem.findUnique({
        where: { id: item.orderItemId },
        select: { variantSnapshot: true },
      });

      if (orderItem?.variantSnapshot) {
        try {
          const snapshot = JSON.parse(orderItem.variantSnapshot);
          const variantId = snapshot.productColorId || snapshot.id;
          if (variantId) {
            await createStockMovement({
              productColorId: variantId,
              quantity: item.quantity,
              type: "RETURN",
              createdById: session.user.id,
            });
          }
        } catch { /* skip */ }
      }
    }
  }

  await prisma.$transaction([
    prisma.claimReturn.update({
      where: { claimId },
      data: { status: "RECEIVED" },
    }),
    prisma.claim.update({
      where: { id: claimId },
      data: { status: "RETURN_RECEIVED" },
    }),
  ]);

  revalidateTag("claims", "default");
  revalidateTag("products", "default");
  return { success: true };
}

export async function createReship(
  claimId: string,
  method: "EASY_EXPRESS" | "OTHER",
  trackingNumber?: string
) {
  await requireAdmin();

  await prisma.claimReship.create({
    data: {
      claimId,
      method,
      status: "PENDING",
      trackingNumber,
    },
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
