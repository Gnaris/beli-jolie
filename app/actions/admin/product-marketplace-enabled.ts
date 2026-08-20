"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { removePfsMatch } from "@/app/actions/admin/pfs";
import { removeAnkorstoreMatch } from "@/app/actions/admin/ankorstore";
import { removeEfashionMatch } from "@/app/actions/admin/efashion";
import { removeFaireMatch } from "@/app/actions/admin/faire";
import { removeOrderchampMatch } from "@/app/actions/admin/orderchamp";
import type { MarketplaceKey } from "@/lib/marketplace-enabled";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

const FIELD_BY_MARKETPLACE: Record<
  MarketplaceKey,
  | "pfsEnabled"
  | "ankorsEnabled"
  | "efashionEnabled"
  | "faireEnabled"
  | "orderchampEnabled"
  | "microstoreEnabled"
> = {
  pfs: "pfsEnabled",
  ankorstore: "ankorsEnabled",
  efashion: "efashionEnabled",
  faire: "faireEnabled",
  orderchamp: "orderchampEnabled",
  microstore: "microstoreEnabled",
};

/**
 * Active/désactive un marketplace pour un produit.
 *
 * Quand on désactive un produit déjà lié à ce marketplace, la fiche
 * marketplace existante N'EST PAS supprimée automatiquement. Deux choix :
 *  - `unlink: false` (défaut, recommandé) : on laisse la fiche marketplace
 *    telle quelle. Seul le flux automatique est coupé.
 *  - `unlink: true` : on efface le lien côté site (appelle removeXxxMatch)
 *    pour que le produit puisse être re-publié depuis zéro plus tard. La
 *    fiche existante côté marketplace subsiste chez eux.
 */
export async function setProductMarketplaceEnabled(
  productId: string,
  marketplace: MarketplaceKey,
  enabled: boolean,
  opts?: { unlink?: boolean },
): Promise<{ success: boolean; error?: string; unlinked?: boolean }> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      orderchampProductId: true,
    },
  });
  if (!product) return { success: false, error: "Produit introuvable." };

  const field = FIELD_BY_MARKETPLACE[marketplace];

  try {
    await prisma.product.update({
      where: { id: productId },
      data: { [field]: enabled },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Enabled] update failed", {
      productId,
      marketplace,
      enabled,
      error: message,
    });
    return { success: false, error: message };
  }

  let unlinked = false;
  if (!enabled && opts?.unlink) {
    const linked = isLinked(marketplace, product);
    if (linked) {
      try {
        const res =
          marketplace === "pfs"
            ? await removePfsMatch(productId)
            : marketplace === "ankorstore"
              ? await removeAnkorstoreMatch(productId)
              : marketplace === "efashion"
                ? await removeEfashionMatch(productId)
                : marketplace === "faire"
                  ? await removeFaireMatch(productId)
                  : await removeOrderchampMatch(productId);
        if (res.success) {
          unlinked = true;
        } else {
          logger.warn("[Marketplace Enabled] unlink failed after disable", {
            productId,
            marketplace,
            error: res.error,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[Marketplace Enabled] unlink threw", {
          productId,
          marketplace,
          error: message,
        });
      }
    }
  }

  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  revalidateTag("products", "default");

  return { success: true, unlinked };
}

function isLinked(
  marketplace: MarketplaceKey,
  product: {
    pfsProductId: string | null;
    ankorsProductId: string | null;
    efashionReferenceBase: string | null;
    faireProductId: string | null;
    orderchampProductId: string | null;
  },
): boolean {
  if (marketplace === "pfs") return !!product.pfsProductId;
  if (marketplace === "ankorstore") return !!product.ankorsProductId;
  if (marketplace === "efashion") return !!product.efashionReferenceBase;
  if (marketplace === "faire") return !!product.faireProductId;
  return !!product.orderchampProductId;
}
