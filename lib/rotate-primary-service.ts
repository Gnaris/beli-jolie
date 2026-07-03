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

// Verrou par produit : deux appels concurrents sur le même productId
// partagent la même promesse. Sans ce garde, chacun lit l'état, décide
// de tourner, puis lance les pushes marketplaces en parallèle — Ankorstore
// renvoie alors 403 « Status cannot be updated from [started] to [started] »
// sur les répliques (le POST /operations dédoublonne côté serveur mais le
// PATCH status=started échoue pour tous sauf le premier).
const inFlight = new Map<string, Promise<RotationResult>>();

/**
 * Vérifie et applique la rotation auto. Idempotent : appelable plusieurs
 * fois d'affilée sans effet de bord si rien n'a changé. Les appels
 * concurrents sur le même productId sont dédupliqués via un verrou en
 * mémoire (le processus Next étant unique via PM2, un Map suffit).
 */
export async function rotatePrimaryIfNeeded(
  productId: string,
): Promise<RotationResult> {
  const existing = inFlight.get(productId);
  if (existing) return existing;

  const promise = runRotation(productId).finally(() => {
    inFlight.delete(productId);
  });
  inFlight.set(productId, promise);
  return promise;
}

async function runRotation(productId: string): Promise<RotationResult> {
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
