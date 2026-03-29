"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyOrderStatusChange } from "@/lib/notifications";

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

  // Fire-and-forget: notify client by email (never blocks status update)
  notifyOrderStatusChange({ orderId, newStatus: status }).catch((err) =>
    console.error("[updateOrderStatus] Email notification error:", err)
  );

  revalidatePath(`/admin/commandes/${orderId}`);
  revalidatePath("/admin/commandes");
}
