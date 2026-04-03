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

  // Fire-and-forget: notify client by email (never blocks status update)
  notifyOrderStatusChange({ orderId, newStatus: status }).catch((err) =>
    logger.error("[updateOrderStatus] Email notification error", { error: err instanceof Error ? err.message : String(err) })
  );

  revalidatePath(`/admin/commandes/${orderId}`);
  revalidatePath("/admin/commandes");
}
