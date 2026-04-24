"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyOrderStatusChange } from "@/lib/notifications";
import { decrementStockForOrder, reinstateStockForOrder } from "@/lib/stock";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
}

export async function updateOrderStatus(orderId: string, status: string) {
  await requireAdmin();

  const validStatuses = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
  if (!validStatuses.includes(status)) throw new Error("Statut invalide.");

  await prisma.order.update({
    where: { id: orderId },
    data:  { status: status as never },
  });

  // Stock movements on status transitions
  if (status === "PROCESSING") {
    await decrementStockForOrder(orderId).catch((err) =>
      logger.error("[updateOrderStatus] Stock decrement error", { error: err instanceof Error ? err.message : String(err) })
    );
  }
  if (status === "CANCELLED") {
    await reinstateStockForOrder(orderId).catch((err) =>
      logger.error("[updateOrderStatus] Stock reinstate error", { error: err instanceof Error ? err.message : String(err) })
    );
  }

  // Notify client by email on every status change (PENDING est géré à la création).
  if (status !== "PENDING") {
    notifyOrderStatusChange({ orderId, newStatus: status }).catch((err) =>
      logger.error("[updateOrderStatus] Email notification error", { error: err instanceof Error ? err.message : String(err) })
    );
  }

  revalidatePath(`/admin/commandes/${orderId}`);
  revalidatePath("/admin/commandes");
}

// ─── Modification d'articles de commande ───

interface OrderItemModificationInput {
  orderItemId: string;
  newQuantity: number;
  reason: "OUT_OF_STOCK" | "CLIENT_REQUEST";
}

export async function modifyOrderItems(
  orderId: string,
  modifications: OrderItemModificationInput[]
): Promise<{ success: boolean; error?: string; creditTotal?: number }> {
  await requireAdmin();

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, itemModifications: true },
    });

    if (!order) return { success: false, error: "Commande introuvable." };

    if (modifications.length === 0) {
      return { success: false, error: "Aucune modification fournie." };
    }

    // Build a map of current items
    const itemMap = new Map(order.items.map((i) => [i.id, i]));

    // Validate all modifications first
    for (const mod of modifications) {
      const item = itemMap.get(mod.orderItemId);
      if (!item) return { success: false, error: `Article introuvable: ${mod.orderItemId}` };
      if (mod.newQuantity < 0) return { success: false, error: "La quantité ne peut pas être négative." };

      // Find the original quantity (before any previous modification)
      const existingMod = order.itemModifications.find(
        (m) => m.orderItemId === mod.orderItemId
      );
      const originalQty = existingMod ? existingMod.originalQuantity : item.quantity;
      if (mod.newQuantity >= originalQty) {
        return {
          success: false,
          error: `La nouvelle quantité doit être inférieure à la quantité originale (${originalQty}) pour "${item.productName}".`,
        };
      }
    }

    let totalCredit = 0;

    await prisma.$transaction(async (tx) => {
      for (const mod of modifications) {
        const item = itemMap.get(mod.orderItemId)!;
        const unitPrice = Number(item.unitPrice);

        // Get original quantity (before any prior modification)
        const existingMod = order.itemModifications.find(
          (m) => m.orderItemId === mod.orderItemId
        );
        const originalQty = existingMod ? existingMod.originalQuantity : item.quantity;

        const priceDiff = (originalQty - mod.newQuantity) * unitPrice;
        totalCredit += priceDiff;

        // Upsert modification record (one per item, overwrite if re-modified)
        if (existingMod) {
          await tx.orderItemModification.update({
            where: { id: existingMod.id },
            data: {
              newQuantity: mod.newQuantity,
              reason: mod.reason,
              priceDifference: priceDiff,
            },
          });
        } else {
          await tx.orderItemModification.create({
            data: {
              orderItemId: mod.orderItemId,
              orderId,
              originalQuantity: item.quantity,
              newQuantity: mod.newQuantity,
              reason: mod.reason,
              priceDifference: priceDiff,
            },
          });
        }

        // Update the order item
        const newLineTotal = mod.newQuantity * unitPrice;
        await tx.orderItem.update({
          where: { id: mod.orderItemId },
          data: {
            quantity: mod.newQuantity,
            lineTotal: newLineTotal,
          },
        });
      }

      // Recalculate order totals
      const updatedItems = await tx.orderItem.findMany({
        where: { orderId },
      });
      const subtotalHT = updatedItems.reduce((sum, i) => sum + Number(i.lineTotal), 0);
      const tvaAmount = subtotalHT * order.tvaRate;
      const totalTTC = subtotalHT + tvaAmount + Number(order.carrierPrice);

      await tx.order.update({
        where: { id: orderId },
        data: {
          subtotalHT,
          tvaAmount,
          totalTTC,
        },
      });
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath("/admin/commandes");

    return { success: true, creditTotal: totalCredit };
  } catch (err) {
    logger.error("[modifyOrderItems] Error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: "Erreur lors de la modification." };
  }
}

// ─── Rétablir un article modifié ───

export async function revertOrderItemModification(
  orderId: string,
  orderItemId: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    const mod = await prisma.orderItemModification.findFirst({
      where: { orderId, orderItemId },
    });
    if (!mod) return { success: false, error: "Modification introuvable." };

    const item = await prisma.orderItem.findUnique({ where: { id: orderItemId } });
    if (!item) return { success: false, error: "Article introuvable." };

    const unitPrice = Number(item.unitPrice);

    await prisma.$transaction(async (tx) => {
      // Restore original quantity
      await tx.orderItem.update({
        where: { id: orderItemId },
        data: {
          quantity: mod.originalQuantity,
          lineTotal: mod.originalQuantity * unitPrice,
        },
      });

      // Delete modification record
      await tx.orderItemModification.delete({ where: { id: mod.id } });

      // Recalculate order totals
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const updatedItems = await tx.orderItem.findMany({ where: { orderId } });
      const subtotalHT = updatedItems.reduce((sum, i) => sum + Number(i.lineTotal), 0);
      const tvaAmount = subtotalHT * order.tvaRate;
      const totalTTC = subtotalHT + tvaAmount + Number(order.carrierPrice);

      await tx.order.update({
        where: { id: orderId },
        data: { subtotalHT, tvaAmount, totalTTC },
      });
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath("/admin/commandes");
    return { success: true };
  } catch (err) {
    logger.error("[revertOrderItemModification] Error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: "Erreur lors du rétablissement." };
  }
}

// ─── Rétablir toutes les modifications d'une commande ───

export async function revertAllOrderItemModifications(
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    const mods = await prisma.orderItemModification.findMany({
      where: { orderId },
    });
    if (mods.length === 0) return { success: false, error: "Aucune modification à rétablir." };

    await prisma.$transaction(async (tx) => {
      // Restore each item
      for (const mod of mods) {
        const item = await tx.orderItem.findUnique({ where: { id: mod.orderItemId } });
        if (!item) continue;
        const unitPrice = Number(item.unitPrice);

        await tx.orderItem.update({
          where: { id: mod.orderItemId },
          data: {
            quantity: mod.originalQuantity,
            lineTotal: mod.originalQuantity * unitPrice,
          },
        });
      }

      // Delete all modification records
      await tx.orderItemModification.deleteMany({ where: { orderId } });

      // Recalculate order totals
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const updatedItems = await tx.orderItem.findMany({ where: { orderId } });
      const subtotalHT = updatedItems.reduce((sum, i) => sum + Number(i.lineTotal), 0);
      const tvaAmount = subtotalHT * order.tvaRate;
      const totalTTC = subtotalHT + tvaAmount + Number(order.carrierPrice);

      await tx.order.update({
        where: { id: orderId },
        data: { subtotalHT, tvaAmount, totalTTC },
      });
    });

    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath("/admin/commandes");
    return { success: true };
  } catch (err) {
    logger.error("[revertAllOrderItemModifications] Error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: "Erreur lors du rétablissement." };
  }
}
