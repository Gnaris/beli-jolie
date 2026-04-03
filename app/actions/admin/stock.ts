"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createStockMovement } from "@/lib/stock";
import { revalidateTag } from "next/cache";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
  return session;
}

export async function adjustStock(
  productColorId: string,
  quantity: number,
  reason: string
) {
  const session = await requireAdmin();

  if (!reason.trim()) {
    return { success: false, error: "La raison est obligatoire." };
  }

  if (quantity === 0) {
    return { success: false, error: "La quantité ne peut pas être 0." };
  }

  try {
    await createStockMovement({
      productColorId,
      quantity,
      type: quantity > 0 ? "MANUAL_IN" : "MANUAL_OUT",
      reason: reason.trim(),
      createdById: session.user.id,
    });

    revalidateTag("products", "default");
    return { success: true };
  } catch {
    return { success: false, error: "Erreur lors de l'ajustement du stock." };
  }
}

export async function getStockHistory(productColorId: string) {
  await requireAdmin();

  return prisma.stockMovement.findMany({
    where: { productColorId },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      order: { select: { orderNumber: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
