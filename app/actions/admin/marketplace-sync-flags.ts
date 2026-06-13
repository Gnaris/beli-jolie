"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export type SyncFlagMarketplace = "pfs" | "ankorstore" | "efashion" | "faire";

/**
 * Remet à false un drapeau « Synchronisation nécessaire » sans rien envoyer
 * au marketplace. Déclenché par le bouton X discret sur le badge orange,
 * quand l'utilisatrice décide d'ignorer un changement local (par ex. une
 * modif de catégorie qu'elle ne veut pas refléter chez PFS).
 *
 * NB : c'est purement local, la fiche côté marketplace reste inchangée et
 * la prochaine vraie modification re-déclenchera le badge.
 */
export async function clearSyncRequiredFlag(
  productId: string,
  marketplace: SyncFlagMarketplace,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    const data =
      marketplace === "pfs"
        ? { pfsSyncRequired: false }
        : marketplace === "ankorstore"
          ? { ankorsSyncRequired: false }
          : marketplace === "efashion"
            ? { efashionSyncRequired: false }
            : { faireSyncRequired: false };

    await prisma.product.update({
      where: { id: productId },
      data,
    });

    revalidateTag("products", "default");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath("/admin/produits");

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}

/**
 * Déclenche directement la marketplace en mode resync depuis le badge orange
 * (clic sur le badge, sans passer par la modale de confirmation classique).
 * Utilisé pour l'action 1-clic « Synchroniser maintenant » du badge.
 *
 * Cette action n'orchestre pas elle-même la sync (on s'appuie sur la queue
 * existante côté client `MarketplaceRefreshContext`) — elle se contente de
 * confirmer côté serveur qu'on peut déclencher (produit lié, marketplace
 * activée). Le composant qui appelle décide ensuite d'enqueue.
 */
export async function canTriggerResync(
  productId: string,
  marketplace: SyncFlagMarketplace,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await requireAdmin();
  const p = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
    },
  });
  if (!p) return { ok: false, reason: "Produit introuvable." };
  if (marketplace === "pfs" && !p.pfsProductId) {
    return { ok: false, reason: "Ce produit n'est pas lié à Paris Fashion Shop." };
  }
  if (marketplace === "ankorstore" && !p.ankorsProductId) {
    return { ok: false, reason: "Ce produit n'est pas lié à Ankorstore." };
  }
  if (marketplace === "efashion" && !p.efashionReferenceBase) {
    return { ok: false, reason: "Ce produit n'est pas lié à eFashion." };
  }
  if (marketplace === "faire" && !p.faireProductId) {
    return { ok: false, reason: "Ce produit n'est pas lié à Faire." };
  }
  return { ok: true };
}
