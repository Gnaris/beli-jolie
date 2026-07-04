"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyOrderStatusChange, notifyClientOrderModified } from "@/lib/notifications";
import { reinstateStockForOrder } from "@/lib/stock";
import { recomputeOrderTotals } from "@/lib/order-totals";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
}

// Transitions autorisées entre statuts de commande.
const VALID_ORDER_TRANSITIONS: Record<string, string[]> = {
  PENDING:   ["VALIDATED", "SHIPPED", "CANCELLED"],
  VALIDATED: ["PENDING", "SHIPPED", "CANCELLED"],
  SHIPPED:   ["PENDING"],
  CANCELLED: [],
};

export async function updateOrderStatus(orderId: string, status: string) {
  await requireAdmin();

  const validStatuses = ["PENDING", "VALIDATED", "SHIPPED", "CANCELLED"];
  if (!validStatuses.includes(status)) throw new Error("Statut invalide.");

  const previous = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      itemModifications: { select: { createdAt: true } },
      items: { where: { isCompensation: true }, select: { createdAt: true } },
    },
  });

  if (!previous) throw new Error("Commande introuvable.");

  if (previous.status !== status) {
    const allowed = VALID_ORDER_TRANSITIONS[previous.status] ?? [];
    if (!allowed.includes(status)) {
      throw new Error(
        `Transition impossible : « ${previous.status} » → « ${status} » n'est pas autorisé.`,
      );
    }
  }

  // Refuser SHIPPED si des modifications n'ont pas été confirmées
  if (status === "SHIPPED") {
    const changeTimestamps: number[] = [
      ...previous.itemModifications.map((m) => m.createdAt.getTime()),
      ...previous.items.map((i) => i.createdAt.getTime()),
    ];
    if (changeTimestamps.length > 0) {
      const lastChange = Math.max(...changeTimestamps);
      const notified = previous.clientNotifiedAt?.getTime() ?? 0;
      if (lastChange > notified) {
        throw new Error(
          "Confirmez d'abord les modifications de la commande (bouton « Confirmer les modifications » en bas de la fiche).",
        );
      }
    }
  }

  await prisma.order.update({
    where: { id: orderId },
    data:  { status: status as never },
  });

  if (status === "CANCELLED" && previous && previous.status !== "CANCELLED") {
    await reinstateStockForOrder(orderId).catch((err) =>
      logger.error("[updateOrderStatus] Stock reinstate error", { error: err })
    );
  }

  if (status !== "PENDING") {
    notifyOrderStatusChange({ orderId, newStatus: status }).catch((err) =>
      logger.error("[updateOrderStatus] Email notification error", { error: err })
    );
  }

  revalidatePath(`/admin/commandes/${orderId}`);
  revalidatePath("/admin/commandes");
}

// ═════════════════════════════════════════════════════════════════════
// Modification d'articles (quantité + prix)
// ═════════════════════════════════════════════════════════════════════

type ModReason = "OUT_OF_STOCK" | "CLIENT_REQUEST" | "COMMERCIAL_GESTURE";

interface OrderItemModificationInput {
  orderItemId: string;
  newQuantity: number;
  newUnitPrice?: number; // undefined = prix inchangé
  reason: ModReason;
}

export async function modifyOrderItems(
  orderId: string,
  modifications: OrderItemModificationInput[]
): Promise<{ success: boolean; error?: string; creditTotal?: number; newTotalTTC?: number }> {
  await requireAdmin();

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, itemModifications: true },
    });

    if (!order) return { success: false, error: "Commande introuvable." };

    // ── Verrouillage : commande expédiée = non modifiable ──
    if (order.status !== "PENDING" && order.status !== "VALIDATED") {
      return { success: false, error: "Commande verrouillée : seules les commandes « Nouveau » ou « Validé » peuvent être modifiées." };
    }

    if (modifications.length === 0) {
      return { success: false, error: "Aucune modification fournie." };
    }

    const itemMap = new Map(order.items.map((i) => [i.id, i]));

    // ── Validation ──
    for (const mod of modifications) {
      const item = itemMap.get(mod.orderItemId);
      if (!item) return { success: false, error: `Article introuvable: ${mod.orderItemId}` };
      if (mod.newQuantity < 0) return { success: false, error: "La quantité ne peut pas être négative." };
      if (mod.newUnitPrice !== undefined && mod.newUnitPrice < 0) {
        return { success: false, error: "Le prix ne peut pas être négatif." };
      }

      const existingMod = order.itemModifications.find(
        (m) => m.orderItemId === mod.orderItemId
      );
      const originalQty = existingMod ? existingMod.originalQuantity : item.quantity;

      // On refuse une modification qui ne change rien (ni qté ni prix)
      const currentPrice = Number(item.unitPrice);
      const priceChanges = mod.newUnitPrice !== undefined && mod.newUnitPrice !== currentPrice;
      const qtyChanges = mod.newQuantity !== originalQty;

      if (!priceChanges && !qtyChanges) {
        continue; // no-op silencieux
      }

      // La quantité ne doit jamais dépasser la quantité initiale
      if (mod.newQuantity > originalQty) {
        return {
          success: false,
          error: `La quantité (${mod.newQuantity}) ne peut pas dépasser la quantité initiale (${originalQty}) pour "${item.productName}".`,
        };
      }

      // Le prix ne doit jamais dépasser le prix initial (on ne peut que baisser)
      const origPrice = existingMod?.originalUnitPrice ? Number(existingMod.originalUnitPrice) : currentPrice;
      if (mod.newUnitPrice !== undefined && mod.newUnitPrice > origPrice) {
        return {
          success: false,
          error: `Le prix (${mod.newUnitPrice.toFixed(2)} €) ne peut pas dépasser le prix initial (${origPrice.toFixed(2)} €) pour "${item.productName}".`,
        };
      }
    }

    let totalCredit = 0;
    let newTotalTTC = 0;

    await prisma.$transaction(async (tx) => {
      for (const mod of modifications) {
        const item = itemMap.get(mod.orderItemId)!;
        const existingMod = order.itemModifications.find(
          (m) => m.orderItemId === mod.orderItemId
        );

        const originalQty = existingMod ? existingMod.originalQuantity : item.quantity;
        const originalPrice = existingMod?.originalUnitPrice
          ? Number(existingMod.originalUnitPrice)
          : Number(item.unitPrice);

        const finalPrice = mod.newUnitPrice ?? Number(item.unitPrice);
        const priceDiff = originalQty * originalPrice - mod.newQuantity * finalPrice;
        totalCredit += priceDiff;

        const priceChanged = finalPrice !== originalPrice;

        if (existingMod) {
          await tx.orderItemModification.update({
            where: { id: existingMod.id },
            data: {
              newQuantity: mod.newQuantity,
              newUnitPrice: priceChanged ? finalPrice : null,
              originalUnitPrice: priceChanged ? originalPrice : null,
              reason: mod.reason,
              priceDifference: priceDiff,
            },
          });
        } else {
          await tx.orderItemModification.create({
            data: {
              orderItemId: mod.orderItemId,
              orderId,
              originalQuantity: originalQty,
              newQuantity: mod.newQuantity,
              originalUnitPrice: priceChanged ? originalPrice : null,
              newUnitPrice: priceChanged ? finalPrice : null,
              reason: mod.reason,
              priceDifference: priceDiff,
            },
          });
        }

        await tx.orderItem.update({
          where: { id: mod.orderItemId },
          data: {
            quantity: mod.newQuantity,
            unitPrice: finalPrice,
            lineTotal: mod.newQuantity * finalPrice,
          },
        });
      }

      // Recalcul totaux
      const updatedItems = await tx.orderItem.findMany({ where: { orderId } });
      const totals = recomputeOrderTotals({
        items: updatedItems,
        tvaRate: order.tvaRate,
        carrierPrice: order.carrierPrice,
        clientDiscountType: order.clientDiscountType,
        clientDiscountValue: order.clientDiscountValue,
      });
      newTotalTTC = Number(totals.totalTTC);

      await tx.order.update({
        where: { id: orderId },
        data: {
          subtotalHT: totals.subtotalHT,
          tvaAmount: totals.tvaAmount,
          totalTTC: totals.totalTTC,
          clientDiscountAmt: totals.clientDiscountAmt,
        },
      });
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath("/admin/commandes");

    // Email non envoyé ici — le sera au clic « Confirmer les modifications »
    return { success: true, creditTotal: totalCredit, newTotalTTC };
  } catch (err) {
    logger.error("[modifyOrderItems] Error", { error: err });
    return { success: false, error: "Erreur lors de la modification." };
  }
}

// ═════════════════════════════════════════════════════════════════════
// Ajout d'un article en compensation
// ═════════════════════════════════════════════════════════════════════

interface AddCompensationInput {
  productColorId: string; // Variant ProductColor
  quantity: number;
  unitPrice: number; // Prix cliente modifiable
  reason: ModReason;
  sizesJson?: string; // JSON [{name, quantity}] pour tailles précises (optionnel)
}

export async function addCompensationItem(
  orderId: string,
  input: AddCompensationInput,
): Promise<{ success: boolean; error?: string; newTotalTTC?: number }> {
  await requireAdmin();

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) return { success: false, error: "Commande introuvable." };
    if (order.status !== "PENDING" && order.status !== "VALIDATED") {
      return { success: false, error: "Commande verrouillée : seules les commandes « Nouveau » ou « Validé » peuvent être modifiées." };
    }
    if (input.quantity <= 0) return { success: false, error: "La quantité doit être positive." };
    if (input.unitPrice < 0) return { success: false, error: "Le prix ne peut pas être négatif." };

    const variant = await prisma.productColor.findUnique({
      where: { id: input.productColorId },
      include: {
        product: {
          select: { name: true, reference: true, status: true },
        },
        color: { select: { name: true } },
        images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
      },
    });

    if (!variant || !variant.product) {
      return { success: false, error: "Produit introuvable." };
    }

    // Pas de contrôle bloquant à l'ajout : l'utilisatrice compose la commande librement,
    // le contrôle du plafond HT se fait au clic « Confirmer les modifications ».
    const addedLineHT = input.quantity * input.unitPrice;
    let newTotalTTC = 0;

    await prisma.$transaction(async (tx) => {
      // Merge : si un article ajouté existe déjà avec la MÊME variante
      // (même productColorId + même prix + mêmes tailles), on incrémente
      // la quantité au lieu de créer une nouvelle ligne.
      const existing = await tx.orderItem.findFirst({
        where: {
          orderId,
          isCompensation: true,
          productColorId: input.productColorId,
          unitPrice: input.unitPrice,
          sizesJson: input.sizesJson ?? null,
        },
      });

      if (existing) {
        const newQuantity = existing.quantity + input.quantity;
        await tx.orderItem.update({
          where: { id: existing.id },
          data: {
            quantity: newQuantity,
            lineTotal: newQuantity * input.unitPrice,
          },
        });
      } else {
        await tx.orderItem.create({
          data: {
            orderId,
            productName: variant.product.name,
            productRef: variant.product.reference,
            colorName: variant.color?.name ?? "Standard",
            saleType: variant.saleType,
            packQty: variant.packQuantity,
            sizesJson: input.sizesJson ?? null,
            unitPrice: input.unitPrice,
            quantity: input.quantity,
            lineTotal: addedLineHT,
            imagePath: variant.images[0]?.path ?? null,
            isCompensation: true,
            productColorId: input.productColorId,
          },
        });
      }

      const updatedItems = await tx.orderItem.findMany({ where: { orderId } });
      const totals = recomputeOrderTotals({
        items: updatedItems,
        tvaRate: order.tvaRate,
        carrierPrice: order.carrierPrice,
        clientDiscountType: order.clientDiscountType,
        clientDiscountValue: order.clientDiscountValue,
      });
      newTotalTTC = Number(totals.totalTTC);

      await tx.order.update({
        where: { id: orderId },
        data: {
          subtotalHT: totals.subtotalHT,
          tvaAmount: totals.tvaAmount,
          totalTTC: totals.totalTTC,
          clientDiscountAmt: totals.clientDiscountAmt,
        },
      });
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath("/admin/commandes");

    return { success: true, newTotalTTC };
  } catch (err) {
    logger.error("[addCompensationItem] Error", { error: err });
    return { success: false, error: "Erreur lors de l'ajout." };
  }
}

// ═════════════════════════════════════════════════════════════════════
// Confirmer les modifications d'une commande
// - Vérifie que le nouveau sous-total HT ne dépasse pas le HT payé
// - Envoie la notification email au client avec le récapitulatif
// - Met à jour clientNotifiedAt
// ═════════════════════════════════════════════════════════════════════

export async function confirmOrderModifications(
  orderId: string,
): Promise<{ success: boolean; error?: string; overshoot?: number }> {
  await requireAdmin();

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, itemModifications: true },
    });
    if (!order) return { success: false, error: "Commande introuvable." };
    if (order.status !== "PENDING" && order.status !== "VALIDATED") {
      return { success: false, error: "Commande verrouillée." };
    }

    const currentHT = Number(order.subtotalHT);
    const paidHT = order.paidSubtotalHT ? Number(order.paidSubtotalHT) : currentHT;

    if (currentHT > paidHT + 0.01) {
      return {
        success: false,
        error: `Confirmation refusée : le nouveau sous-total HT (${currentHT.toFixed(2).replace(".", ",")} €) dépasse le HT payé (${paidHT.toFixed(2).replace(".", ",")} €). Retirez ou ajustez des articles avant de confirmer.`,
        overshoot: currentHT - paidHT,
      };
    }

    // Construire le récap pour l'email : toutes les modifications + les ajouts
    const compensationItems = order.items.filter((i) => i.isCompensation);
    const modSummary = order.itemModifications.map((mod) => {
      const item = order.items.find((i) => i.id === mod.orderItemId);
      const originalPrice = mod.originalUnitPrice ? Number(mod.originalUnitPrice) : Number(item?.unitPrice ?? 0);
      return {
        productName: item?.productName ?? "",
        originalQuantity: mod.originalQuantity,
        newQuantity: mod.newQuantity,
        reason: mod.reason as "OUT_OF_STOCK" | "CLIENT_REQUEST" | "COMMERCIAL_GESTURE",
        creditAmount: mod.originalQuantity * originalPrice - mod.newQuantity * Number(item?.unitPrice ?? 0),
      };
    });

    // Ajouter les articles ajoutés au récap (creditAmount négatif = supplément livré)
    for (const c of compensationItems) {
      modSummary.push({
        productName: `${c.productName} (offert)`,
        originalQuantity: 0,
        newQuantity: c.quantity,
        reason: "COMMERCIAL_GESTURE",
        creditAmount: -Number(c.lineTotal),
      });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { clientNotifiedAt: new Date() },
    });

    if (modSummary.length > 0) {
      notifyClientOrderModified({ orderId, modifications: modSummary }).catch((err) =>
        logger.error("[confirmOrderModifications] Email client error", { error: err }),
      );
    }

    revalidatePath(`/admin/commandes/${orderId}`);
    return { success: true };
  } catch (err) {
    logger.error("[confirmOrderModifications] Error", { error: err });
    return { success: false, error: "Erreur lors de la confirmation." };
  }
}

// ═════════════════════════════════════════════════════════════════════
// Retirer un article ajouté en compensation
// ═════════════════════════════════════════════════════════════════════

export async function removeCompensationItem(
  orderId: string,
  orderItemId: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!order) return { success: false, error: "Commande introuvable." };
    if (order.status !== "PENDING" && order.status !== "VALIDATED") {
      return { success: false, error: "Commande verrouillée." };
    }

    const item = await prisma.orderItem.findUnique({ where: { id: orderItemId } });
    if (!item || item.orderId !== orderId) return { success: false, error: "Article introuvable." };
    if (!item.isCompensation) {
      return { success: false, error: "Seuls les articles ajoutés en compensation peuvent être retirés." };
    }

    await prisma.$transaction(async (tx) => {
      await tx.orderItem.delete({ where: { id: orderItemId } });

      const orderFresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const updatedItems = await tx.orderItem.findMany({ where: { orderId } });
      const totals = recomputeOrderTotals({
        items: updatedItems,
        tvaRate: orderFresh.tvaRate,
        carrierPrice: orderFresh.carrierPrice,
        clientDiscountType: orderFresh.clientDiscountType,
        clientDiscountValue: orderFresh.clientDiscountValue,
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          subtotalHT: totals.subtotalHT,
          tvaAmount: totals.tvaAmount,
          totalTTC: totals.totalTTC,
          clientDiscountAmt: totals.clientDiscountAmt,
        },
      });
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    return { success: true };
  } catch (err) {
    logger.error("[removeCompensationItem] Error", { error: err });
    return { success: false, error: "Erreur lors du retrait." };
  }
}

// ═════════════════════════════════════════════════════════════════════
// Rétablir une modification / toutes les modifications
// ═════════════════════════════════════════════════════════════════════

export async function revertOrderItemModification(
  orderId: string,
  orderItemId: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order) return { success: false, error: "Commande introuvable." };
    if (order.status !== "PENDING" && order.status !== "VALIDATED") return { success: false, error: "Commande verrouillée." };

    const mod = await prisma.orderItemModification.findFirst({
      where: { orderId, orderItemId },
    });
    if (!mod) return { success: false, error: "Modification introuvable." };

    const item = await prisma.orderItem.findUnique({ where: { id: orderItemId } });
    if (!item) return { success: false, error: "Article introuvable." };

    // Prix à restaurer : si originalUnitPrice existe, on l'utilise, sinon on garde le prix actuel
    const restoredPrice = mod.originalUnitPrice ? Number(mod.originalUnitPrice) : Number(item.unitPrice);

    await prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: orderItemId },
        data: {
          quantity: mod.originalQuantity,
          unitPrice: restoredPrice,
          lineTotal: mod.originalQuantity * restoredPrice,
        },
      });

      await tx.orderItemModification.delete({ where: { id: mod.id } });

      const orderFresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const updatedItems = await tx.orderItem.findMany({ where: { orderId } });
      const totals = recomputeOrderTotals({
        items: updatedItems,
        tvaRate: orderFresh.tvaRate,
        carrierPrice: orderFresh.carrierPrice,
        clientDiscountType: orderFresh.clientDiscountType,
        clientDiscountValue: orderFresh.clientDiscountValue,
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          subtotalHT: totals.subtotalHT,
          tvaAmount: totals.tvaAmount,
          totalTTC: totals.totalTTC,
          clientDiscountAmt: totals.clientDiscountAmt,
        },
      });
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath("/admin/commandes");
    return { success: true };
  } catch (err) {
    logger.error("[revertOrderItemModification] Error", { error: err });
    return { success: false, error: "Erreur lors du rétablissement." };
  }
}

export async function revertAllOrderItemModifications(
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order) return { success: false, error: "Commande introuvable." };
    if (order.status !== "PENDING" && order.status !== "VALIDATED") return { success: false, error: "Commande verrouillée." };

    const mods = await prisma.orderItemModification.findMany({ where: { orderId } });
    if (mods.length === 0) return { success: false, error: "Aucune modification à rétablir." };

    await prisma.$transaction(async (tx) => {
      for (const mod of mods) {
        const item = await tx.orderItem.findUnique({ where: { id: mod.orderItemId } });
        if (!item) continue;
        const restoredPrice = mod.originalUnitPrice ? Number(mod.originalUnitPrice) : Number(item.unitPrice);

        await tx.orderItem.update({
          where: { id: mod.orderItemId },
          data: {
            quantity: mod.originalQuantity,
            unitPrice: restoredPrice,
            lineTotal: mod.originalQuantity * restoredPrice,
          },
        });
      }

      await tx.orderItemModification.deleteMany({ where: { orderId } });

      const orderFresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const updatedItems = await tx.orderItem.findMany({ where: { orderId } });
      const totals = recomputeOrderTotals({
        items: updatedItems,
        tvaRate: orderFresh.tvaRate,
        carrierPrice: orderFresh.carrierPrice,
        clientDiscountType: orderFresh.clientDiscountType,
        clientDiscountValue: orderFresh.clientDiscountValue,
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          subtotalHT: totals.subtotalHT,
          tvaAmount: totals.tvaAmount,
          totalTTC: totals.totalTTC,
          clientDiscountAmt: totals.clientDiscountAmt,
        },
      });
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath("/admin/commandes");
    return { success: true };
  } catch (err) {
    logger.error("[revertAllOrderItemModifications] Error", { error: err });
    return { success: false, error: "Erreur lors du rétablissement." };
  }
}
