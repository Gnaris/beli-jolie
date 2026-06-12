"use server";

/**
 * eFashion — File d'attente du ticket de shooting partagé.
 *
 * Côté eFashion, chaque création/refresh de produit crée un ticket de shooting
 * que leur staff doit valider manuellement. Pour éviter le spam de tickets,
 * cette file permet à l'utilisatrice de regrouper N produits dans un seul
 * envoi → 1 seul ticket de shooting créé côté eFashion.
 *
 * Flux :
 *   1. L'utilisatrice enregistre un produit ou clique "Rafraîchir" en cochant
 *      eFashion → ce module ajoute le productId à la file (mode PUBLISH ou
 *      REFRESH selon l'intention).
 *   2. La fenêtre flottante affiche la liste, permet de retirer des items.
 *   3. Au clic "Valider le shooting", on lance le batch (1 seul appel
 *      saveMelDraft + saveMelChoice pour tous, photos par produit, etc.).
 */

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { validateEfashionPublishable } from "@/lib/efashion-validate";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export type EfashionShootingBatchMode = "PUBLISH" | "REFRESH";

export interface EfashionShootingBatchItemView {
  id: string;
  productId: string;
  mode: EfashionShootingBatchMode;
  addedAt: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  // Pré-check de validation : si missing.length > 0, l'item bloquera la validation
  missing: string[];
  noEligibleVariants: boolean;
  productDeleted: boolean;
}

export interface EfashionShootingBatchState {
  items: EfashionShootingBatchItemView[];
  // L'utilisatrice peut valider seulement si tous les items sont OK
  hasBlockingIssue: boolean;
}

/**
 * Ajoute (ou rafraîchit) un produit dans la file d'attente.
 * - Si le produit existe déjà : on met à jour mode + addedAt (= "le plus récent gagne")
 * - Sinon : on crée la ligne
 */
export async function addToEfashionShootingBatch(
  productId: string,
  mode: EfashionShootingBatchMode,
): Promise<{ success: true } | { success: false; error: string }> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    return { success: false, error: "Produit introuvable." };
  }

  await prisma.efashionShootingBatchItem.upsert({
    where: { productId },
    create: { productId, mode },
    update: { mode, addedAt: new Date() },
  });

  revalidatePath("/admin", "layout");
  return { success: true };
}

/**
 * Ajoute plusieurs produits d'un coup à la file. Utilisé par la modale
 * « Publier brouillons » pour pousser N produits en une seule étape.
 * Renvoie les produits réellement ajoutés ; les ids inconnus sont ignorés.
 */
export async function bulkAddToEfashionShootingBatch(
  productIds: string[],
  mode: EfashionShootingBatchMode,
): Promise<{ success: true; addedCount: number; missingIds: string[] }> {
  await requireAdmin();

  if (productIds.length === 0) {
    return { success: true, addedCount: 0, missingIds: [] };
  }

  const existing = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((p) => p.id));
  const validIds = productIds.filter((id) => existingIds.has(id));
  const missingIds = productIds.filter((id) => !existingIds.has(id));

  await prisma.$transaction(
    validIds.map((productId) =>
      prisma.efashionShootingBatchItem.upsert({
        where: { productId },
        create: { productId, mode },
        update: { mode, addedAt: new Date() },
      }),
    ),
  );

  if (validIds.length > 0) revalidatePath("/admin", "layout");
  return { success: true, addedCount: validIds.length, missingIds };
}

/**
 * Retire un produit de la file (au clic croix dans la widget).
 */
export async function removeFromEfashionShootingBatch(
  productId: string,
): Promise<{ success: true }> {
  await requireAdmin();

  await prisma.efashionShootingBatchItem.deleteMany({ where: { productId } });
  revalidatePath("/admin", "layout");
  return { success: true };
}

/**
 * Liste les items de la file avec leur état de validation.
 * Les produits supprimés localement (orphelins) sont marqués `productDeleted`
 * et seront retirés silencieusement à la validation.
 */
export async function listEfashionShootingBatch(): Promise<EfashionShootingBatchState> {
  await requireAdmin();

  const items = await prisma.efashionShootingBatchItem.findMany({
    orderBy: { addedAt: "asc" },
    include: {
      product: {
        select: {
          id: true,
          reference: true,
          name: true,
          // 1ʳᵉ image de la 1ʳᵉ couleur, pour l'affichage dans la widget
          colors: {
            select: { id: true, isPrimary: true },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            take: 1,
          },
        },
      },
    },
  });

  // Charge les 1ʳᵉs images en une seule requête
  const firstColorIds = items
    .map((it) => it.product?.colors[0]?.id)
    .filter((id): id is string => typeof id === "string");
  const firstImages = firstColorIds.length
    ? await prisma.productColorImage.findMany({
        where: { colorId: { in: firstColorIds }, order: 0 },
        select: { colorId: true, path: true },
      })
    : [];
  const firstImageByColor = new Map(firstImages.map((i) => [i.colorId, i.path]));

  // Validation en parallèle pour chaque produit existant
  const validations = await Promise.all(
    items
      .filter((it) => it.product != null)
      .map((it) => validateEfashionPublishable(it.productId)),
  );
  const validationByProduct = new Map(validations.map((v) => [v.productId, v]));

  const views: EfashionShootingBatchItemView[] = items.map((it) => {
    const product = it.product;
    if (!product) {
      return {
        id: it.id,
        productId: it.productId,
        mode: it.mode as EfashionShootingBatchMode,
        addedAt: it.addedAt.toISOString(),
        reference: "—",
        productName: "(produit supprimé)",
        firstImage: null,
        missing: [],
        noEligibleVariants: false,
        productDeleted: true,
      };
    }
    const validation = validationByProduct.get(it.productId);
    const firstColorId = product.colors[0]?.id;
    return {
      id: it.id,
      productId: it.productId,
      mode: it.mode as EfashionShootingBatchMode,
      addedAt: it.addedAt.toISOString(),
      reference: product.reference,
      productName: product.name,
      firstImage: firstColorId ? (firstImageByColor.get(firstColorId) ?? null) : null,
      missing: validation?.missing ?? [],
      noEligibleVariants: validation?.noEligibleVariants ?? false,
      productDeleted: false,
    };
  });

  // Un item bloque la validation s'il a des mappings manquants OU pas de variantes UNIT.
  // Les items orphelins (productDeleted) ne bloquent pas — on les nettoie silencieusement.
  const hasBlockingIssue = views.some(
    (v) => !v.productDeleted && (v.missing.length > 0 || v.noEligibleVariants),
  );

  return { items: views, hasBlockingIssue };
}

/**
 * Lance l'envoi groupé à eFashion. Bloque tant qu'au moins un item a une
 * erreur de mapping. Les items orphelins sont retirés silencieusement avant
 * l'envoi.
 *
 * Le batch est dispatché en arrière-plan (fire-and-forget) ; cette action
 * retourne immédiatement après avoir validé l'état initial.
 */
export async function commitEfashionShootingBatch(): Promise<
  | { success: true; publishCount: number; refreshCount: number }
  | { success: false; error: string }
> {
  await requireAdmin();

  const state = await listEfashionShootingBatch();
  if (state.items.length === 0) {
    return { success: false, error: "La file d'attente est vide." };
  }
  if (state.hasBlockingIssue) {
    return {
      success: false,
      error: "Certains produits ont des mappings manquants — corrigez ou retirez-les d'abord.",
    };
  }

  // Nettoyage des orphelins
  const orphanProductIds = state.items
    .filter((it) => it.productDeleted)
    .map((it) => it.productId);
  if (orphanProductIds.length > 0) {
    await prisma.efashionShootingBatchItem.deleteMany({
      where: { productId: { in: orphanProductIds } },
    });
    logger.info("[eFashion Shooting Batch] Orphelins retirés silencieusement", {
      count: orphanProductIds.length,
    });
  }

  // Re-snapshot après cleanup. On capture mode pour dispatcher.
  // Pour mode PUBLISH : si entretemps le produit a été lié, on bascule vers update direct queue.
  // → Pour simplicité V1 : on traite le mode tel qu'il a été ajouté ; au moment du batch
  //   publish, si efashionReferenceBase existe déjà, le code interne fait l'update.
  const remaining = await prisma.efashionShootingBatchItem.findMany({
    select: { productId: true, mode: true },
  });

  const toPublish = remaining
    .filter((it) => it.mode === "PUBLISH")
    .map((it) => it.productId);
  const toRefresh = remaining
    .filter((it) => it.mode === "REFRESH")
    .map((it) => it.productId);

  // Crée une ligne MarketplaceRefreshJob par produit pour qu'ils apparaissent
  // dans le widget marketplace existant (en bas à droite) pendant que le batch
  // tourne. On démarre direct en IN_PROGRESS — l'utilisatrice voit le spinner
  // bleu eFashion sur chaque produit comme pour PFS/Ankorstore.
  // payload reprend les infos déjà calculées dans `state.items` (reference,
  // productName, firstImage) pour l'affichage immédiat.
  const viewByProduct = new Map(state.items.map((it) => [it.productId, it]));
  const jobIdByProduct = new Map<string, string>();
  for (const productId of [...toPublish, ...toRefresh]) {
    const view = viewByProduct.get(productId);
    const mode = toPublish.includes(productId) ? "PUBLISH" : "REFRESH";
    const job = await prisma.marketplaceRefreshJob.create({
      data: {
        productId,
        marketplace: "EFASHION",
        mode,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        payload: {
          reference: view?.reference ?? "?",
          productName: view?.productName ?? "Produit",
          firstImage: view?.firstImage ?? null,
          options: { local: false, pfs: false, ankorstore: false, efashion: true },
        },
      },
    });
    jobIdByProduct.set(productId, job.id);
  }

  // Vide la file shooting maintenant — la progression est désormais reflétée
  // par les MarketplaceRefreshJob, plus besoin de garder les items du shooting.
  await prisma.efashionShootingBatchItem.deleteMany({});

  // Fire-and-forget : batch en arrière-plan
  void (async () => {
    try {
      const { runEfashionShootingBatch } = await import("@/lib/efashion-shooting-batch-runner");
      await runEfashionShootingBatch({
        toPublish,
        toRefresh,
        jobIdByProduct: Object.fromEntries(jobIdByProduct),
      });
    } catch (err) {
      logger.error("[eFashion Shooting Batch] Run crashed", {
        error: err as Error,
        toPublish: toPublish.length,
        toRefresh: toRefresh.length,
      });
      // Marque tous les jobs en FAILED pour ne pas les laisser bloqués en IN_PROGRESS
      const message = err instanceof Error ? err.message : String(err);
      await prisma.marketplaceRefreshJob.updateMany({
        where: { id: { in: Array.from(jobIdByProduct.values()) } },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      });
    }
  })();

  revalidatePath("/admin", "layout");
  return {
    success: true,
    publishCount: toPublish.length,
    refreshCount: toRefresh.length,
  };
}
