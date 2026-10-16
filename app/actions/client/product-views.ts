"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Enregistre une vue produit pour l'utilisateur connecté.
 *
 * - Visiteur anonyme → ignoré.
 * - Rôle ADMIN → ignoré (les tests de la boutique ne doivent pas gonfler les
 *   stats que la cliente consulte).
 * - Déjà une vue aujourd'hui pour (user, produit) → ignoré silencieusement
 *   via `skipDuplicates` + l'index unique `(tenantId, userId, productId,
 *   viewedDate)`.
 *
 * Toujours fire-and-forget côté UI : si ça rate, on ne pénalise jamais le
 * parcours client.
 */
export async function trackProductView(
  productId: string,
): Promise<{ tracked: boolean }> {
  if (!productId || typeof productId !== "string") return { tracked: false };

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { tracked: false };
  if (session.user.role === "ADMIN") return { tracked: false };

  // Jour courant en UTC (00:00) — stocké dans `viewedDate @db.Date`.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // createMany + skipDuplicates : première vue du jour → insérée ;
  // vues suivantes → silencieusement ignorées (pas d'exception).
  const result = await prisma.productView.createMany({
    data: [
      {
        productId,
        userId: session.user.id,
        viewedDate: today,
      },
    ],
    skipDuplicates: true,
  });

  return { tracked: result.count > 0 };
}
