"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateClaimReference } from "@/lib/claims";
import { createConversation } from "@/lib/messaging";
import { notifyAdminNewClaim } from "@/lib/notifications";
import { revalidateTag } from "next/cache";

interface CreateClaimInput {
  type: "ORDER_CLAIM" | "GENERAL";
  orderId?: string;
  description: string;
  items?: { orderItemId: string; quantity: number; reason: string; reasonDetail?: string }[];
  imagePaths?: string[];
}

export async function createClaim(input: CreateClaimInput) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
    return { success: false, error: "Acces non autorise." };
  }

  if (!input.description.trim()) {
    return { success: false, error: "La description est obligatoire." };
  }

  if (input.type === "ORDER_CLAIM" && !input.orderId) {
    return { success: false, error: "La commande est obligatoire pour une reclamation liee." };
  }

  if (input.orderId) {
    const order = await prisma.order.findFirst({
      where: { id: input.orderId, userId: session.user.id },
    });
    if (!order) return { success: false, error: "Commande introuvable." };
  }

  try {
    const reference = await generateClaimReference();
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { firstName: true, lastName: true, company: true },
    });

    const claim = await prisma.claim.create({
      data: {
        reference,
        type: input.type,
        userId: session.user.id,
        orderId: input.orderId,
        description: input.description.trim(),
        items: input.items
          ? {
              create: input.items.map((i) => ({
                orderItemId: i.orderItemId,
                quantity: i.quantity,
                reason: i.reason as "DEFECTIVE" | "WRONG_ITEM" | "MISSING" | "DAMAGED" | "OTHER",
                reasonDetail: i.reasonDetail,
              })),
            }
          : undefined,
        images: input.imagePaths
          ? { create: input.imagePaths.map((p) => ({ imagePath: p })) }
          : undefined,
      },
    });

    await createConversation({
      type: "CLAIM",
      subject: `Reclamation ${reference}`,
      userId: session.user.id,
      claimId: claim.id,
      initialMessage: input.description.trim(),
      senderRole: "CLIENT",
      senderId: session.user.id,
    });

    notifyAdminNewClaim({
      clientName: `${user?.firstName} ${user?.lastName}`,
      clientCompany: user?.company || "",
      claimReference: reference,
      claimType: input.type,
      description: input.description.trim(),
      claimId: claim.id,
    }).catch(() => {});

    revalidateTag("claims", "default");
    return { success: true, claimId: claim.id };
  } catch {
    return { success: false, error: "Erreur lors de la creation de la reclamation." };
  }
}

export async function getClientClaims() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") return [];

  return prisma.claim.findMany({
    where: { userId: session.user.id },
    include: {
      order: { select: { orderNumber: true } },
      _count: { select: { items: true, images: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getClientClaim(claimId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") return null;

  return prisma.claim.findFirst({
    where: { id: claimId, userId: session.user.id },
    include: {
      order: { select: { orderNumber: true, id: true } },
      items: {
        include: { orderItem: { select: { productName: true, productRef: true, colorName: true, imagePath: true } } },
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

export async function confirmReturnShipped(claimId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") {
    return { success: false, error: "Acces non autorise." };
  }

  const claim = await prisma.claim.findFirst({
    where: { id: claimId, userId: session.user.id, status: "RETURN_PENDING" },
    include: { returnInfo: true },
  });

  if (!claim || !claim.returnInfo) {
    return { success: false, error: "Reclamation introuvable ou pas en attente de retour." };
  }

  await prisma.$transaction([
    prisma.claimReturn.update({
      where: { id: claim.returnInfo.id },
      data: { status: "SHIPPED" },
    }),
    prisma.claim.update({
      where: { id: claimId },
      data: { status: "RETURN_SHIPPED" },
    }),
  ]);

  revalidateTag("claims", "default");
  return { success: true };
}
