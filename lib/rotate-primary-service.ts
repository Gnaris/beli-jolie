// Service d'orchestration de la rotation automatique de la couleur principale.
//
// À appeler après CHAQUE mutation de stock d'une variante (updateVariantQuick,
// adjustStock, placeOrder, déductions marketplaces, import, formulaire complet
// n'est PAS branché — cf. memory 2026-06-30 : la cliente choisit elle-même
// dans le formulaire).
//
// Flow :
//   1) Lit le produit + variantes + IDs marketplace
//   2) Appelle decidePrimaryRotation() pour trancher
//   3) Si rotation → update Product.primaryColorId (idempotent via WHERE)
//   4) Enqueue 1 MarketplaceRefreshJob (mode REFRESH) par marketplace lié+activé
//      → la queue widget flottant orchestre, respecte le mutex Ankorstore, etc.
//   5) revalidateTag pour rafraîchir l'admin
//
// Marketplaces poussés : PFS, Ankorstore, eFashion, Faire. Microstore n'a pas
// de queue marketplace (pas de push serveur → syncRequired est posé par les
// mutations produit habituelles).
import "server-only";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { decidePrimaryRotation } from "@/lib/auto-rotate-primary";

export interface RotationResult {
  rotated: boolean;
  from?: string | null;
  to?: string;
  enqueuedJobs?: number;
}

/**
 * Vérifie si la couleur principale du produit doit basculer et applique la
 * rotation le cas échéant. Idempotent : si aucune rotation n'est nécessaire,
 * ne fait rien. Ne throw jamais — les erreurs sont loggées et le retour vaut
 * `{ rotated: false }` pour ne pas casser le flow appelant (mutation stock,
 * commande, etc.).
 *
 * @param productId - Product.id de la fiche à évaluer
 * @param opts.tenantId - Optionnel. Si fourni, wrap l'exécution dans
 *   tenantALS.run() pour les appels hors contexte HTTP (workers, webhooks).
 */
export async function rotatePrimaryIfNeeded(
  productId: string,
  opts: { tenantId?: string | null } = {},
): Promise<RotationResult> {
  const run = () => rotatePrimaryInner(productId);
  if (opts.tenantId) {
    return tenantALS.run(opts.tenantId, run);
  }
  return run();
}

async function rotatePrimaryInner(productId: string): Promise<RotationResult> {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        name: true,
        primaryColorId: true,
        pfsProductId: true,
        ankorsProductId: true,
        efashionReferenceBase: true,
        faireProductId: true,
        pfsEnabled: true,
        ankorsEnabled: true,
        efashionEnabled: true,
        faireEnabled: true,
        colors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: {
            colorId: true,
            stock: true,
            disabled: true,
          },
        },
      },
    });
    if (!product) return { rotated: false };

    const decision = decidePrimaryRotation({
      currentPrimaryColorId: product.primaryColorId,
      colors: product.colors,
    });
    if (!decision) return { rotated: false };

    // Update idempotent : le WHERE sur primaryColorId courant empêche une
    // double rotation si deux mutations concurrentes déclenchent le service
    // pour le même produit au même instant.
    const updated = await prisma.product.updateMany({
      where: { id: productId, primaryColorId: product.primaryColorId },
      data: { primaryColorId: decision.nextPrimaryColorId },
    });
    if (updated.count === 0) {
      // Un autre process a déjà roté entre notre lecture et notre update.
      return { rotated: false };
    }

    // Enqueue REFRESH marketplace pour chaque cible liée + activée. Reprend la
    // sérialisation du POST /api/admin/marketplace-queue (payload identique
    // pour l'affichage widget). Un job par marketplace.
    const basePayload = {
      reference: product.reference,
      productName: product.name,
      firstImage: null as string | null,
    };
    const jobs: Array<{
      marketplace: "PFS" | "ANKORSTORE" | "EFASHION" | "FAIRE";
      options: Record<string, boolean>;
    }> = [];
    if (product.pfsProductId && product.pfsEnabled) {
      jobs.push({ marketplace: "PFS", options: { pfs: true } });
    }
    if (product.ankorsProductId && product.ankorsEnabled) {
      jobs.push({ marketplace: "ANKORSTORE", options: { ankorstore: true } });
    }
    if (product.efashionReferenceBase && product.efashionEnabled) {
      jobs.push({ marketplace: "EFASHION", options: { efashion: true } });
    }
    if (product.faireProductId && product.faireEnabled) {
      jobs.push({ marketplace: "FAIRE", options: { faire: true } });
    }

    if (jobs.length > 0) {
      await prisma.$transaction(
        jobs.map((j) =>
          prisma.marketplaceRefreshJob.create({
            data: {
              productId,
              marketplace: j.marketplace,
              mode: "REFRESH",
              status: "QUEUED",
              payload: { ...basePayload, options: j.options },
            },
          }),
        ),
      );
    }

    revalidateTag("admin-products", "default");
    logger.info("[RotatePrimary] rotation appliquée", {
      productId,
      reference: product.reference,
      from: product.primaryColorId,
      to: decision.nextPrimaryColorId,
      enqueuedJobs: jobs.length,
    });

    return {
      rotated: true,
      from: product.primaryColorId,
      to: decision.nextPrimaryColorId,
      enqueuedJobs: jobs.length,
    };
  } catch (error) {
    logger.error("[RotatePrimary] échec silencieux", { productId, error });
    return { rotated: false };
  }
}
