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

type ClaimAttachmentInput = { fileName: string; filePath: string; fileSize: number; mimeType: string };

interface CreateClaimInput {
  subject: string;
  message: string;
  attachments?: ClaimAttachmentInput[];
  // Wizard Service Client — depuis 2026-09-24. Undefined = ancien appel legacy
  // (traité comme OTHER, aucun orderItem).
  type?: "ORDER_RELATED" | "OTHER";
  orderId?: string;
  orderItems?: { orderItemId: string; quantity: number }[];
}

async function requireApprovedClient() {
  const session = await getServerSession(authOptions);
  if (!session) return null;
  // ADMIN passe pour tester son propre tunnel service client de bout en bout
  // (même pattern que app/actions/client/cart.ts::requireClient).
  if (session.user.role === "ADMIN") return session;
  if (session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
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

  const claimType = input.type ?? "OTHER";

  // Validation flux ORDER_RELATED : commande + au moins 1 ligne signalée avec
  // une quantité valide (>= 1 et <= quantité initialement commandée).
  let validatedOrderItems: { orderItemId: string; quantity: number }[] = [];
  if (claimType === "ORDER_RELATED") {
    if (!input.orderId) {
      return { success: false, error: "Commande manquante." };
    }
    const isAdmin = session.user.role === "ADMIN";
    const order = await prisma.order.findFirst({
      where: {
        id: input.orderId,
        ...(isAdmin ? {} : { userId: session.user.id }),
      },
      select: { id: true, items: { select: { id: true, quantity: true } } },
    });
    if (!order) return { success: false, error: "Commande introuvable." };

    const orderItemsMap = new Map(order.items.map((it) => [it.id, it.quantity]));
    const rawItems = (input.orderItems ?? []).filter((it) => it.quantity > 0);
    if (rawItems.length === 0) {
      return { success: false, error: "Sélectionnez au moins une quantité à signaler." };
    }
    for (const it of rawItems) {
      const orderedQty = orderItemsMap.get(it.orderItemId);
      if (orderedQty === undefined) {
        return { success: false, error: "Article introuvable dans la commande." };
      }
      if (it.quantity > orderedQty) {
        return { success: false, error: "Quantité signalée supérieure à la quantité commandée." };
      }
    }
    validatedOrderItems = rawItems;
  }

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
        type: claimType,
        orderId: claimType === "ORDER_RELATED" ? input.orderId : null,
        orderItems:
          validatedOrderItems.length > 0
            ? {
                create: validatedOrderItems.map((it) => ({
                  orderItemId: it.orderItemId,
                  quantity: it.quantity,
                })),
              }
            : undefined,
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

    // Contexte enrichi pour la notif admin sur les demandes liées à une commande :
    // numéro de commande + liste des articles signalés avec quantité, pour que
    // l'admin voit tout de suite le périmètre concret sans devoir cliquer.
    let orderNumber: string | undefined;
    let reportedItems: { productName: string; productRef: string; quantity: number }[] | undefined;
    if (claimType === "ORDER_RELATED" && validatedOrderItems.length > 0 && input.orderId) {
      const details = await prisma.order.findUnique({
        where: { id: input.orderId },
        select: {
          orderNumber: true,
          items: {
            where: { id: { in: validatedOrderItems.map((it) => it.orderItemId) } },
            select: { id: true, productName: true, productRef: true },
          },
        },
      });
      if (details) {
        orderNumber = details.orderNumber;
        const qtyByItem = new Map(validatedOrderItems.map((it) => [it.orderItemId, it.quantity]));
        reportedItems = details.items.map((it) => ({
          productName: it.productName,
          productRef: it.productRef,
          quantity: qtyByItem.get(it.id) ?? 0,
        }));
      }
    }

    notifyAdminNewClaim({
      clientName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
      clientCompany: user.company ?? "",
      claimReference: reference,
      subject,
      messagePreview: message,
      claimId: claim.id,
      orderNumber,
      reportedItems,
    }).catch((err) => logger.error("[createClaim] Email admin échoué", { error: err }));

    revalidateTag("claims", "default");
    return { success: true, claimId: claim.id };
  } catch (err) {
    logger.error("[createClaim] Création demande échouée", { error: err });
    return { success: false, error: "Erreur lors de l'envoi de la demande." };
  }
}

/**
 * Liste les commandes du client éligibles à une demande service client.
 * Exclut les commandes CANCELLED — pas d'objet à signaler sur une annulée.
 * ADMIN en mode preview : voit toutes les commandes du tenant (pour tester
 * le tunnel de bout en bout).
 */
export async function listOrdersForClaim() {
  const session = await requireApprovedClient();
  if (!session) return { success: false as const, error: "Accès non autorisé.", orders: [] };

  const isAdmin = session.user.role === "ADMIN";
  const orders = await prisma.order.findMany({
    where: {
      ...(isAdmin ? {} : { userId: session.user.id }),
      status: { in: ["PENDING", "SHIPPED"] },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      createdAt: true,
      totalTTC: true,
      items: { select: { quantity: true } },
    },
    orderBy: { createdAt: "desc" },
    take: isAdmin ? 20 : undefined,
  });

  return {
    success: true as const,
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status as "PENDING" | "SHIPPED",
      createdAt: o.createdAt.toISOString(),
      totalTTC: Number(o.totalTTC),
      totalArticles: o.items.reduce((s, it) => s + it.quantity, 0),
    })),
  };
}

/**
 * Récupère le détail d'une commande pour l'étape 3 du wizard : liste des
 * articles avec les quantités commandées, afin d'afficher un sélecteur
 * « Qté à signaler » (max = qté commandée). ADMIN en preview peut lire
 * n'importe quelle commande du tenant.
 */
export async function getOrderForClaim(orderId: string) {
  const session = await requireApprovedClient();
  if (!session) return { success: false as const, error: "Accès non autorisé." };

  const isAdmin = session.user.role === "ADMIN";
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      ...(isAdmin ? {} : { userId: session.user.id }),
    },
    select: {
      id: true,
      orderNumber: true,
      items: {
        orderBy: { createdAt: "asc" },
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
        },
      },
    },
  });
  if (!order) return { success: false as const, error: "Commande introuvable." };

  return {
    success: true as const,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      items: order.items,
    },
  };
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

/**
 * Le client clôture lui-même sa demande service client. Ne fonctionne que si
 * la demande lui appartient et qu'elle est encore ouverte. Ré-ouvrir se fait
 * automatiquement en renvoyant un message (cf. sendClientMessage).
 */
export async function closeMyClaim(claimId: string) {
  const session = await requireApprovedClient();
  if (!session) return { success: false, error: "Accès non autorisé." };

  const claim = await prisma.claim.findFirst({
    where: { id: claimId, userId: session.user.id },
    select: { id: true, status: true },
  });
  if (!claim) return { success: false, error: "Demande introuvable." };
  if (claim.status === "CLOSED") return { success: false, error: "Cette demande est déjà fermée." };

  await prisma.claim.update({
    where: { id: claimId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  revalidateTag("claims", "default");
  return { success: true };
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
