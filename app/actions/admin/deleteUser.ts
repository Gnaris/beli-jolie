"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function deleteUser(userId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role === "ADMIN") throw new Error("Utilisateur introuvable");

  await prisma.$transaction(async (tx) => {
    // Delete order items for all user orders
    const orderIds = (await tx.order.findMany({
      where: { userId },
      select: { id: true },
    })).map((o) => o.id);

    if (orderIds.length > 0) {
      await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { userId } });
    }

    // Delete user (cascades: Cart, CartItems, Favorites, ShippingAddresses)
    await tx.user.delete({ where: { id: userId } });
  });

  revalidatePath("/admin/utilisateurs");
  redirect("/admin/utilisateurs");
}
