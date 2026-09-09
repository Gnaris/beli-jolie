"use server";

/**
 * Action côté client pour piloter `User.abandonedCartOptOut` depuis
 * l'espace pro. Séparée du toggle newsletter global : la cliente peut
 * couper les relances panier sans se désinscrire des newsletters.
 */

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function setAbandonedCartOptOut(optOut: boolean): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Non authentifié.");
  const userId = session.user.id;

  await prisma.user.update({
    where: { id: userId },
    data: { abandonedCartOptOut: optOut },
  });

  if (optOut) {
    // Annule tous les jobs pending pour ce user (tenant scope via
    // l'extension Prisma qui pose tenantId depuis les headers du request).
    try {
      await prisma.abandonedCartJob.updateMany({
        where: { userId, status: "PENDING" },
        data: {
          status: "CANCELLED",
          nextStageAt: null,
          cancelReason: "OPT_OUT",
        },
      });
    } catch (err) {
      logger.error("[abandoned-cart-optout] cancel jobs failed", {
        userId,
        error: err as Error,
      });
    }
  }

  revalidatePath("/espace-pro");
}
