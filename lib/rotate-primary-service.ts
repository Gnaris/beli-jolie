/**
 * Service d'orchestration de la rotation auto couleur principale.
 *
 * Vérifie si la couleur principale d'un produit doit basculer (cf.
 * `lib/auto-rotate-primary.ts`), applique la bascule en BDD si oui, puis
 * lance — en arrière-plan — les pushes vers les marketplaces où le produit
 * est publié (PFS / Ankorstore / eFashion).
 *
 * Conçu pour être appelé après une modification de stock :
 *  - admin : updateVariantQuick, bulkUpdateVariants, adjustStock
 *  - client : placeOrder
 *
 * Volontairement PAS appelé depuis `updateProduct` : dans le formulaire
 * complet, l'admin saisit elle-même `primaryColorId` (override explicite),
 * et la modale post-save gère le push marketplaces — éviter de double-pousser.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { decidePrimaryRotation } from "@/lib/auto-rotate-primary";

export interface RotationResult {
  rotated: boolean;
  oldPrimaryColorId: string | null;
  newPrimaryColorId: string | null;
}

/**
 * Vérifie et applique la rotation auto. Idempotent : appelable plusieurs
 * fois d'affilée sans effet de bord si rien n'a changé.
 */
export async function rotatePrimaryIfNeeded(
  productId: string,
): Promise<RotationResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      primaryColorId: true,
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      colors: {
        select: { colorId: true, stock: true, disabled: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!product) {
    return { rotated: false, oldPrimaryColorId: null, newPrimaryColorId: null };
  }

  const decision = decidePrimaryRotation(product.primaryColorId, product.colors);
  if (!decision.rotate) {
    return {
      rotated: false,
      oldPrimaryColorId: product.primaryColorId,
      newPrimaryColorId: product.primaryColorId,
    };
  }

  await prisma.product.update({
    where: { id: productId },
    data: { primaryColorId: decision.newPrimaryColorId },
  });

  logger.info("[auto-rotate-primary] Rotated primary color", {
    productId,
    from: product.primaryColorId,
    to: decision.newPrimaryColorId,
  });

  // Fire-and-forget : on lance les pushes sans bloquer l'appelant.
  void pushRotationToMarketplaces({
    productId,
    pfsProductId: product.pfsProductId,
    ankorsProductId: product.ankorsProductId,
    efashionReferenceBase: product.efashionReferenceBase,
  });

  return {
    rotated: true,
    oldPrimaryColorId: product.primaryColorId,
    newPrimaryColorId: decision.newPrimaryColorId,
  };
}

async function pushRotationToMarketplaces(params: {
  productId: string;
  pfsProductId: string | null;
  ankorsProductId: string | null;
  efashionReferenceBase: string | null;
}): Promise<void> {
  const { productId, pfsProductId, ankorsProductId, efashionReferenceBase } = params;

  if (pfsProductId) {
    try {
      const { pfsUpdateProductInPlace } = await import("@/lib/pfs-update");
      await pfsUpdateProductInPlace(productId, undefined, { skipRevalidation: true });
    } catch (err) {
      logger.error("[auto-rotate-primary] PFS push failed", { productId, error: err });
    }
  }

  if (ankorsProductId) {
    try {
      const { getCachedAnkorstoreEnabled } = await import("@/lib/cached-data");
      const enabled = await getCachedAnkorstoreEnabled();
      if (enabled) {
        const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
        await ankorstoreKickoffUpdate(productId, { skipRevalidation: true });
      }
    } catch (err) {
      logger.error("[auto-rotate-primary] Ankorstore push failed", { productId, error: err });
    }
  }

  if (efashionReferenceBase) {
    try {
      const { efashionUpdateProductInPlace } = await import("@/lib/efashion-update");
      await efashionUpdateProductInPlace(productId);
    } catch (err) {
      logger.error("[auto-rotate-primary] eFashion push failed", { productId, error: err });
    }
  }
}
