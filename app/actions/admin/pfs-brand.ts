"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

/**
 * Assigne manuellement une marque PFS à un produit déjà publié.
 * Utilisé depuis le badge PFS dans l'édition produit pour les vieux
 * produits dont la marque n'avait pas été stockée chez nous.
 *
 * NB : ça n'envoie rien à PFS — c'est juste pour renseigner la valeur
 * dans notre base. La marque PFS d'un produit publié n'est jamais
 * modifiée côté PFS.
 */
export async function setProductPfsBrand(
  productId: string,
  brand: { id: string; name: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    const id = brand.id.trim();
    const name = brand.name.trim();
    if (!id || !name) {
      return { success: false, error: "Sélectionnez une marque dans la liste." };
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, pfsProductId: true },
    });
    if (!product) return { success: false, error: "Produit introuvable." };
    if (!product.pfsProductId) {
      return {
        success: false,
        error: "Ce produit n'est pas encore publié sur Paris Fashion Shop.",
      };
    }

    await prisma.product.update({
      where: { id: productId },
      data: { pfsBrandId: id, pfsBrandName: name },
    });

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath("/admin/produits");
    revalidateTag("products", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
