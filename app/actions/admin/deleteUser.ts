"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

/**
 * Server Action — Suppression définitive d'un client depuis l'admin.
 *
 * Pas de `redirect()` ici : Next.js 16 déclenche un bug de manifest
 * (`InvariantError: The client reference manifest for route
 * "/admin/utilisateurs/[id]" does not exist`) quand une action redirige
 * depuis cette route dynamique → page blanche. La navigation
 * post-suppression est faite côté client via `router.push()`.
 */
export async function deleteUser(
  userId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "ADMIN") {
      return { success: false, error: "Accès non autorisé." };
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role === "ADMIN") {
      return { success: false, error: "Utilisateur introuvable." };
    }

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
    revalidatePath(`/admin/utilisateurs/${userId}`);
    revalidatePath("/admin");

    return { success: true };
  } catch (err) {
    logger.error("[deleteUser] Erreur inattendue", { error: err });
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Une erreur est survenue lors de la suppression du client.",
    };
  }
}
