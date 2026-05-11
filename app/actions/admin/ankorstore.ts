"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  ankorstoreListAllProducts,
  ankorstoreGetProduct,
  type AnkorstoreProduct,
} from "@/lib/ankorstore-api";
import {
  runAutoMatch,
  type BjProductForMatch,
  type MatchReport,
  type VariantMatchPair,
} from "@/lib/ankorstore-match";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

/**
 * Charge tous les produits Ankorstore via l'API et les confronte aux produits
 * BJ qui n'ont pas encore d'`ankorsProductId`. Renvoie le rapport `MatchReport`.
 */
export async function runAnkorstoreAutoMatch(): Promise<MatchReport> {
  await requireAdmin();

  const [ankorstoreProducts, bjProductsRaw] = await Promise.all([
    ankorstoreListAllProducts({ pageSize: 100 }),
    prisma.product.findMany({
      where: { ankorsProductId: null, isIncomplete: false },
      select: {
        id: true,
        name: true,
        reference: true,
        colors: {
          select: { colorId: true, color: { select: { name: true } } },
        },
      },
    }),
  ]);

  const bjProducts: BjProductForMatch[] = bjProductsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    reference: p.reference,
    colors: p.colors
      .filter((pc) => pc.colorId && pc.color)
      .map((pc) => ({
        id: pc.colorId as string,
        name: pc.color!.name,
      })),
  }));

  return runAutoMatch(ankorstoreProducts, bjProducts);
}

/**
 * Lie un produit local à un produit Ankorstore existant. Remplit
 * `Product.ankorsProductId` et `ProductColor.ankorsVariantId` à partir
 * du mapping de variantes fourni.
 *
 * Le `ankorsLastSyncSnapshot` reste null : la prochaine publication
 * incrémentale fera donc une sync complète (comportement natif de
 * `ankorstoreUpdateProductInPlace` quand le snapshot est vide).
 */
export async function confirmAnkorstoreMatch(
  productId: string,
  ankorstoreProductId: string,
  variantMatches: { localColorId: string; ankorstoreVariantId: string }[],
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          ankorsProductId: ankorstoreProductId,
          ankorsLastSyncSnapshot: Prisma.DbNull,
        },
      });

      for (const m of variantMatches) {
        await tx.productColor.updateMany({
          where: { productId, colorId: m.localColorId },
          data: { ankorsVariantId: m.ankorstoreVariantId },
        });
      }
    });

    revalidatePath("/admin/produits");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath("/admin/ankorstore");
    revalidateTag("products", "default");

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] confirmAnkorstoreMatch failed", { productId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Efface le lien Ankorstore d'un produit (sans toucher à Ankorstore).
 */
export async function removeAnkorstoreMatch(
  productId: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          ankorsProductId: null,
          ankorsLastSyncSnapshot: Prisma.DbNull,
        },
      });
      await tx.productColor.updateMany({
        where: { productId },
        data: { ankorsVariantId: null },
      });
    });

    revalidatePath("/admin/produits");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath("/admin/ankorstore");
    revalidateTag("products", "default");

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] removeAnkorstoreMatch failed", { productId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Liaison manuelle : on récupère le produit Ankorstore par son ID, on calcule
 * automatiquement le mapping couleur (via `runAutoMatch` sur ce seul produit)
 * et on appelle `confirmAnkorstoreMatch`.
 */
export async function linkAnkorstoreProductManually(
  productId: string,
  ankorstoreProductId: string,
): Promise<{ success: boolean; error?: string; matched?: number; unmatched?: number }> {
  await requireAdmin();

  try {
    const [akProduct, bjProductRaw] = await Promise.all([
      ankorstoreGetProduct(ankorstoreProductId),
      prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          name: true,
          reference: true,
          colors: {
            select: { colorId: true, color: { select: { name: true } } },
          },
        },
      }),
    ]);

    if (!akProduct) {
      return { success: false, error: "Produit Ankorstore introuvable." };
    }
    if (!bjProductRaw) {
      return { success: false, error: "Produit local introuvable." };
    }

    const bjForMatch: BjProductForMatch = {
      id: bjProductRaw.id,
      name: bjProductRaw.name,
      reference: bjProductRaw.reference,
      colors: bjProductRaw.colors
        .filter((pc) => pc.colorId && pc.color)
        .map((pc) => ({
          id: pc.colorId as string,
          name: pc.color!.name,
        })),
    };

    const fakeRefAlignedProduct: AnkorstoreProduct = {
      ...akProduct,
      name: `${akProduct.name} - ${bjProductRaw.reference}`,
    };

    const report = runAutoMatch([fakeRefAlignedProduct], [bjForMatch]);
    const result = report.results[0];

    const variantMatches = (result.variantMatches ?? [])
      .filter((vm: VariantMatchPair) => vm.bjColorId !== null)
      .map((vm: VariantMatchPair) => ({
        localColorId: vm.bjColorId as string,
        ankorstoreVariantId: vm.ankorstoreVariant.id,
      }));

    const confirmRes = await confirmAnkorstoreMatch(
      productId,
      ankorstoreProductId,
      variantMatches,
    );
    if (!confirmRes.success) {
      return { success: false, error: confirmRes.error };
    }

    return {
      success: true,
      matched: variantMatches.length,
      unmatched: akProduct.variants.length - variantMatches.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] linkAnkorstoreProductManually failed", {
      productId,
      ankorstoreProductId,
      error: message,
    });
    return { success: false, error: message };
  }
}
