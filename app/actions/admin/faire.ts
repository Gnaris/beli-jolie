"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getFaireTaxonomy, type FaireTaxonomyType } from "@/lib/faire-taxonomy";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

/**
 * Renvoie la taxonomie Faire (cache 24h, tag `faire-taxonomy`) pour le
 * sélecteur autocomplete côté UI catégories. Si l'API Faire n'est pas
 * configurée ou indisponible, retourne [] (l'UI bascule sur la saisie manuelle).
 */
export async function getFaireTaxonomyOptions(): Promise<FaireTaxonomyType[]> {
  await requireAdmin();
  try {
    return await getFaireTaxonomy();
  } catch (err) {
    logger.warn("[Faire] getFaireTaxonomyOptions failed", { error: String(err) });
    return [];
  }
}

/**
 * Efface le lien Faire d'un produit (sans rien toucher chez Faire).
 * Pattern miroir de `removeAnkorstoreMatch`. La fiche distante reste
 * en l'état — l'admin pourra re-publier ou re-lier plus tard.
 */
export async function removeFaireMatch(
  productId: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          faireProductId: null,
          faireLastSyncSnapshot: Prisma.DbNull,
          faireSyncRequired: false,
        },
      });
      await tx.productColor.updateMany({
        where: { productId },
        data: { faireVariantId: null },
      });
    });

    revalidatePath("/admin/produits");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidateTag("products", "default");

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Faire] removeFaireMatch failed", { productId, error: message });
    return { success: false, error: message };
  }
}
