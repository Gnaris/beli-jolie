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
    const orderIds = (
      await tx.order.findMany({ where: { userId }, select: { id: true } })
    ).map((o) => o.id);

    const creditIds = (
      await tx.credit.findMany({ where: { userId }, select: { id: true } })
    ).map((c) => c.id);

    // Tables sans onDelete cascade qui pointent vers Order → à vider avant les commandes.
    if (orderIds.length > 0) {
      await tx.promotionUsage.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.creditUsage.deleteMany({ where: { orderId: { in: orderIds } } });
    }
    // Reste des PromotionUsage liés à l'utilisateur (sans commande — improbable mais safe).
    await tx.promotionUsage.deleteMany({ where: { userId } });

    if (creditIds.length > 0) {
      await tx.creditUsage.deleteMany({ where: { creditId: { in: creditIds } } });
    }

    // StockMovement.orderId est nullable et bascule en SET NULL automatiquement
    // lors du delete Order (default Prisma pour relation optionnelle).

    if (orderIds.length > 0) {
      await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    }

    if (creditIds.length > 0) {
      await tx.credit.deleteMany({ where: { id: { in: creditIds } } });
    }

    // Chat / SAV — sender pointe vers User sans cascade, à purger avant.
    await tx.message.deleteMany({ where: { senderId: userId } });
    await tx.conversation.deleteMany({ where: { userId } });
    await tx.claim.deleteMany({ where: { userId } });

    // Verrous d'inscription rattachés à cet email (RGPD : ne pas garder de trace).
    await tx.accountLockout.deleteMany({ where: { email: user.email } });

    // Cascade auto sur User : Cart+CartItem, ShippingAddress, Favorite.
    // SET NULL auto : ProductView.userId, MicrostoreOrder.userId, EmailSend.userId.
    await tx.user.delete({ where: { id: userId } });
  });

  revalidatePath("/admin/utilisateurs");
  redirect("/admin/utilisateurs");
}
